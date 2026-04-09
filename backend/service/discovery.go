package service

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/aetherproxy/backend/config"
	"github.com/aetherproxy/backend/database"
	"github.com/aetherproxy/backend/database/model"
	"github.com/aetherproxy/backend/logger"
	"github.com/hashicorp/memberlist"
)

// maxManifestBodyBytes caps the response body read from the manifest endpoint.
const maxManifestBodyBytes = 1 << 16 // 64 KB

// bootstrapManifest is the signed JSON format for the bootstrap node list.
type bootstrapManifest struct {
	Version   int      `json:"version"`
	Nodes     []string `json:"nodes"` // host:port pairs
	Signature string   `json:"signature,omitempty"` // base64 Ed25519 sig over the canonical JSON (omit sig field)
}

// aetherNodeMeta is gossip metadata broadcast by each member.
type aetherNodeMeta struct {
	Name       string `json:"name"`
	Version    string `json:"version"`
	GossipPort int    `json:"gossipPort"`
}

// DiscoveryService manages the gossip-based decentralized node discovery layer.
// It wraps hashicorp/memberlist and persists discovered peers to the database.
type DiscoveryService struct {
	mu        sync.Mutex
	list      *memberlist.Memberlist
	isRunning bool
	stopCh    chan struct{}
}

var discoveryOnce sync.Once
var globalDiscovery *DiscoveryService

// GetDiscoveryService returns the singleton DiscoveryService.
func GetDiscoveryService() *DiscoveryService {
	discoveryOnce.Do(func() {
		globalDiscovery = &DiscoveryService{
			stopCh: make(chan struct{}),
		}
	})
	return globalDiscovery
}

// IsRunning reports whether the gossip cluster is currently active.
func (d *DiscoveryService) IsRunning() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.isRunning
}

// Start initialises and joins the memberlist gossip cluster.
// It is idempotent: a second call while already running is a no-op.
func (d *DiscoveryService) Start() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.isRunning {
		return nil
	}

	cfg := memberlist.DefaultLANConfig()
	cfg.BindPort = config.GetGossipPort()
	cfg.AdvertisePort = config.GetGossipPort()
	cfg.Name = buildNodeName()
	cfg.LogOutput = io.Discard // suppress memberlist internal logs (we use our own logger)

	// Attach metadata delegate so other nodes can learn about this node.
	meta := aetherNodeMeta{
		Name:       cfg.Name,
		Version:    config.GetVersion(),
		GossipPort: cfg.BindPort,
	}
	metaBytes, _ := json.Marshal(meta)
	cfg.Delegate = &nodeDelegate{meta: metaBytes}

	// Attach events delegate to update the database on membership changes.
	cfg.Events = &nodeEvents{svc: d}

	list, err := memberlist.Create(cfg)
	if err != nil {
		return fmt.Errorf("memberlist create: %w", err)
	}
	d.list = list
	d.isRunning = true
	d.stopCh = make(chan struct{})

	// Join bootstrap nodes asynchronously so Start() does not block.
	go d.joinBootstrap()

	// Periodically refresh the manifest and prune stale peers.
	go d.backgroundLoop()

	logger.Infof("DiscoveryService started on UDP port %d", cfg.BindPort)
	return nil
}

// Stop gracefully leaves the gossip cluster and cleans up resources.
func (d *DiscoveryService) Stop() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.isRunning {
		return
	}
	close(d.stopCh)
	if d.list != nil {
		_ = d.list.Leave(3 * time.Second)
		_ = d.list.Shutdown()
		d.list = nil
	}
	d.isRunning = false
	logger.Info("DiscoveryService stopped")
}

// GetPeers returns all currently alive/suspect peer nodes known to memberlist.
func (d *DiscoveryService) GetPeers() []*memberlist.Node {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.list == nil {
		return nil
	}
	return d.list.Members()
}

// GetStoredPeers returns all peer nodes persisted in the database.
func (d *DiscoveryService) GetStoredPeers() ([]model.PeerNode, error) {
	db := database.GetDB()
	var peers []model.PeerNode
	err := db.Order("last_seen desc").Find(&peers).Error
	return peers, err
}

// JoinPeer manually adds a peer address (host:port) to the cluster.
func (d *DiscoveryService) JoinPeer(addr string) error {
	d.mu.Lock()
	list := d.list
	d.mu.Unlock()
	if list == nil {
		return fmt.Errorf("discovery not running")
	}
	n, err := list.Join([]string{addr})
	if err != nil {
		return err
	}
	logger.Infof("DiscoveryService: joined %d nodes via %s", n, addr)
	return nil
}

// joinBootstrap attempts to connect to all configured bootstrap peers.
func (d *DiscoveryService) joinBootstrap() {
	peers := d.resolveBootstrap()
	if len(peers) == 0 {
		logger.Info("DiscoveryService: no bootstrap peers configured")
		return
	}
	d.mu.Lock()
	list := d.list
	d.mu.Unlock()
	if list == nil {
		return
	}
	n, err := list.Join(peers)
	if err != nil {
		logger.Warningf("DiscoveryService: bootstrap join error: %v", err)
	} else {
		logger.Infof("DiscoveryService: bootstrapped with %d node(s)", n)
	}
}

// resolveBootstrap merges bootstrap peers from the embedded manifest,
// the env-var override, and the remotely-fetched signed manifest.
func (d *DiscoveryService) resolveBootstrap() []string {
	seen := make(map[string]struct{})
	var peers []string

	addPeers := func(list []string) {
		for _, p := range list {
			if _, ok := seen[p]; !ok {
				seen[p] = struct{}{}
				peers = append(peers, p)
			}
		}
	}

	// 1. Env-var overrides (highest priority)
	addPeers(config.GetGossipBootstrap())

	// 2. Remote signed manifest
	if url := config.GetGossipManifestURL(); url != "" {
		if nodes, err := d.fetchSignedManifest(url); err == nil {
			addPeers(nodes)
		} else {
			logger.Warningf("DiscoveryService: manifest fetch error: %v", err)
		}
	}

	return peers
}

// fetchSignedManifest downloads and verifies the bootstrap manifest from url.
// The manifest JSON must be signed with the Ed25519 key in config.BootstrapManifestPubKey.
func (d *DiscoveryService) fetchSignedManifest(url string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "AetherProxy/"+config.GetVersion()+" DiscoveryService")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxManifestBodyBytes))
	if err != nil {
		return nil, err
	}

	var manifest bootstrapManifest
	if err := json.Unmarshal(body, &manifest); err != nil {
		return nil, fmt.Errorf("manifest parse: %w", err)
	}

	// Verify signature when a public key is configured.
	if pubKeyB64 := config.BootstrapManifestPubKey; pubKeyB64 != "" {
		if err := verifyManifest(body, manifest.Signature, pubKeyB64); err != nil {
			return nil, fmt.Errorf("manifest signature invalid: %w", err)
		}
	}

	return manifest.Nodes, nil
}

// verifyManifest checks the Ed25519 signature on the raw manifest JSON.
// The signature is computed over the canonical JSON with the "signature" field absent.
func verifyManifest(rawJSON []byte, sigB64 string, pubKeyB64 string) error {
	if sigB64 == "" {
		return fmt.Errorf("missing signature in manifest")
	}

	pubKeyBytes, err := base64.StdEncoding.DecodeString(pubKeyB64)
	if err != nil {
		return fmt.Errorf("decode public key: %w", err)
	}
	if len(pubKeyBytes) != ed25519.PublicKeySize {
		return fmt.Errorf("public key length %d, want %d", len(pubKeyBytes), ed25519.PublicKeySize)
	}

	sig, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil {
		return fmt.Errorf("decode signature: %w", err)
	}

	// Remove the signature field and re-marshal to get the signed payload.
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(rawJSON, &obj); err != nil {
		return err
	}
	delete(obj, "signature")
	payload, err := json.Marshal(obj)
	if err != nil {
		return err
	}

	pubKey := ed25519.PublicKey(pubKeyBytes)
	if !ed25519.Verify(pubKey, payload, sig) {
		return fmt.Errorf("signature verification failed")
	}
	return nil
}

// backgroundLoop periodically refreshes the manifest and prunes dead peers.
func (d *DiscoveryService) backgroundLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-d.stopCh:
			return
		case <-ticker.C:
			d.pruneStalePeers()
			d.joinBootstrap()
		}
	}
}

// pruneStalePeers marks database peers as "dead" if not seen for >10 minutes.
func (d *DiscoveryService) pruneStalePeers() {
	cutoff := time.Now().Add(-10 * time.Minute).Unix()
	db := database.GetDB()
	db.Model(&model.PeerNode{}).
		Where("last_seen < ? AND status != ?", cutoff, "dead").
		Update("status", "dead")
}

// upsertPeer writes or updates a peer node record in the database.
func (d *DiscoveryService) upsertPeer(n *memberlist.Node, status string) {
	meta := parseNodeMeta(n)
	now := time.Now().Unix()
	db := database.GetDB()

	var peer model.PeerNode
	result := db.Where("address = ?", n.Addr.String()).First(&peer)
	if result.Error != nil {
		// Create new record.
		peer = model.PeerNode{
			Name:       meta.Name,
			Address:    n.Addr.String(),
			GossipPort: meta.GossipPort,
			Version:    meta.Version,
			Status:     status,
			LastSeen:   now,
		}
		db.Create(&peer)
	} else {
		db.Model(&peer).Updates(map[string]interface{}{
			"name":        meta.Name,
			"gossip_port": meta.GossipPort,
			"version":     meta.Version,
			"status":      status,
			"last_seen":   now,
		})
	}
}

// parseNodeMeta extracts AetherProxy metadata from a memberlist.Node.
func parseNodeMeta(n *memberlist.Node) aetherNodeMeta {
	var meta aetherNodeMeta
	if len(n.Meta) > 0 {
		_ = json.Unmarshal(n.Meta, &meta)
	}
	if meta.Name == "" {
		meta.Name = n.Name
	}
	if meta.GossipPort == 0 {
		meta.GossipPort = int(n.Port)
	}
	return meta
}

// buildNodeName returns a human-readable name for this node.
func buildNodeName() string {
	return fmt.Sprintf("aether-%s", config.GetVersion())
}

// ── memberlist delegates ───────────────────────────────────────────────────────

// nodeDelegate implements memberlist.Delegate.
// It broadcasts this node's metadata to the cluster.
type nodeDelegate struct {
	meta []byte
}

func (d *nodeDelegate) NodeMeta(limit int) []byte {
	if len(d.meta) > limit {
		return d.meta[:limit]
	}
	return d.meta
}

func (d *nodeDelegate) NotifyMsg([]byte)                           {}
func (d *nodeDelegate) GetBroadcasts(overhead, limit int) [][]byte { return nil }
func (d *nodeDelegate) LocalState(join bool) []byte                { return nil }
func (d *nodeDelegate) MergeRemoteState(buf []byte, join bool)     {}

// nodeEvents implements memberlist.EventDelegate.
// It persists peer state changes to the database.
type nodeEvents struct {
	svc *DiscoveryService
}

func (e *nodeEvents) NotifyJoin(n *memberlist.Node) {
	logger.Infof("DiscoveryService: peer joined: %s (%s)", n.Name, n.Addr)
	e.svc.upsertPeer(n, "alive")
}

func (e *nodeEvents) NotifyLeave(n *memberlist.Node) {
	logger.Infof("DiscoveryService: peer left: %s (%s)", n.Name, n.Addr)
	e.svc.upsertPeer(n, "left")
}

func (e *nodeEvents) NotifyUpdate(n *memberlist.Node) {
	e.svc.upsertPeer(n, "alive")
}
