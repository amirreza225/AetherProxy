package service

import (
	"context"
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/aetherproxy/backend/database"
	"github.com/aetherproxy/backend/database/model"
	"github.com/aetherproxy/backend/logger"
	"golang.org/x/crypto/ssh"
)

// NodeService manages remote VPS nodes.
type NodeService struct {
	mu      sync.Mutex
	stopChs map[uint]context.CancelFunc
}

var nodeServiceOnce sync.Once
var globalNodeService *NodeService

func GetNodeService() *NodeService {
	nodeServiceOnce.Do(func() {
		globalNodeService = &NodeService{
			stopChs: make(map[uint]context.CancelFunc),
		}
	})
	return globalNodeService
}

// GetAll returns all nodes.
func (s *NodeService) GetAll() ([]model.Node, error) {
	db := database.GetDB()
	var nodes []model.Node
	err := db.Find(&nodes).Error
	return nodes, err
}

// GetByID returns a single node.
func (s *NodeService) GetByID(id uint) (*model.Node, error) {
	db := database.GetDB()
	var node model.Node
	err := db.First(&node, id).Error
	if err != nil {
		return nil, err
	}
	return &node, nil
}

// Create adds a new node and starts its health-check goroutine.
func (s *NodeService) Create(node *model.Node) error {
	node.Status = "unknown"
	node.LastPing = 0
	if err := database.GetDB().Create(node).Error; err != nil {
		return err
	}
	s.startHealthCheck(node.Id)
	return nil
}

// Update persists changes to a node.
func (s *NodeService) Update(node *model.Node) error {
	return database.GetDB().Save(node).Error
}

// Delete removes a node and stops its health-check.
func (s *NodeService) Delete(id uint) error {
	s.stopHealthCheck(id)
	return database.GetDB().Delete(&model.Node{}, id).Error
}

// StartAllHealthChecks launches health-check goroutines for every stored node.
// Called once during app startup.
func (s *NodeService) StartAllHealthChecks() {
	nodes, err := s.GetAll()
	if err != nil {
		logger.Warning("NodeService: failed to load nodes:", err)
		return
	}
	for _, n := range nodes {
		s.startHealthCheck(n.Id)
	}
}

func (s *NodeService) startHealthCheck(id uint) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.stopChs[id]; exists {
		return // already running
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.stopChs[id] = cancel

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		// Run immediately on start
		s.pingNode(id)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.pingNode(id)
			}
		}
	}()
}

func (s *NodeService) stopHealthCheck(id uint) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if cancel, exists := s.stopChs[id]; exists {
		cancel()
		delete(s.stopChs, id)
	}
}

// pingNode performs a TCP-level probe and updates node.Status + node.LastPing.
func (s *NodeService) pingNode(id uint) {
	db := database.GetDB()
	var node model.Node
	if err := db.First(&node, id).Error; err != nil {
		return
	}

	addr := net.JoinHostPort(node.Host, fmt.Sprintf("%d", node.SshPort))
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	status := "offline"
	if err == nil {
		_ = conn.Close()
		status = "online"
	}

	db.Model(&node).Updates(map[string]interface{}{
		"status":    status,
		"last_ping": time.Now().Unix(),
	})
}

// DeployConfig SSHes into the node and writes the given sing-box JSON config,
// then restarts the sing-box service.
func (s *NodeService) DeployConfig(nodeID uint, configJSON []byte) error {
	node, err := s.GetByID(nodeID)
	if err != nil {
		return fmt.Errorf("node %d not found: %w", nodeID, err)
	}

	sshClient, err := s.sshDial(node)
	if err != nil {
		return fmt.Errorf("SSH dial failed: %w", err)
	}
	defer func() { _ = sshClient.Close() }()

	// Write config file
	configPath := "/etc/sing-box/config.json"
	if err := s.sshWriteFile(sshClient, configPath, configJSON); err != nil {
		return fmt.Errorf("write config: %w", err)
	}

	// Restart sing-box service
	if err := s.sshRun(sshClient, "systemctl restart sing-box"); err != nil {
		return fmt.Errorf("restart sing-box: %w", err)
	}

	return nil
}

// sshDial opens an SSH connection to the given node, implementing Trust-On-First-Use
// (TOFU) host key verification.  On the first connection the server's public key is
// stored in node.SshKnownKey; subsequent connections reject any key mismatch.
func (s *NodeService) sshDial(node *model.Node) (*ssh.Client, error) {
	auth := []ssh.AuthMethod{}
	if node.SshKeyPath != "" {
		key, err := os.ReadFile(node.SshKeyPath)
		if err != nil {
			return nil, fmt.Errorf("read SSH key %s: %w", node.SshKeyPath, err)
		}
		signer, err := ssh.ParsePrivateKey(key)
		if err != nil {
			return nil, fmt.Errorf("parse SSH key: %w", err)
		}
		auth = append(auth, ssh.PublicKeys(signer))
	}

	hostKeyCallback := s.buildHostKeyCallback(node)

	cfg := &ssh.ClientConfig{
		User:            "root",
		Auth:            auth,
		HostKeyCallback: hostKeyCallback,
		Timeout:         10 * time.Second,
	}
	addr := net.JoinHostPort(node.Host, fmt.Sprintf("%d", node.SshPort))
	return ssh.Dial("tcp", addr, cfg)
}

// buildHostKeyCallback returns a host-key callback that implements TOFU.
func (s *NodeService) buildHostKeyCallback(node *model.Node) ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		// Use the standard OpenSSH SHA-256 fingerprint format ("SHA256:<base64>").
		fp := ssh.FingerprintSHA256(key)

		db := database.GetDB()
		// First connection: trust and store the key.
		if node.SshKnownKey == "" {
			logger.Infof("NodeService: TOFU – storing host key for %s: %s %s", hostname, key.Type(), fp)
			stored := key.Type() + " " + fp
			if err := db.Model(node).Update("ssh_known_key", stored).Error; err != nil {
				logger.Warning("NodeService: failed to persist host key:", err)
			}
			node.SshKnownKey = stored
			return nil
		}

		// Subsequent connections: verify the stored key.
		parts := strings.SplitN(node.SshKnownKey, " ", 2)
		if len(parts) != 2 {
			// Stored key is malformed – fall through and trust.
			return nil
		}
		storedFP := parts[1]
		if storedFP != fp {
			return fmt.Errorf("SSH host key mismatch for %s: expected %s, got %s – possible MITM attack", hostname, storedFP, fp)
		}
		return nil
	}
}

func (s *NodeService) sshRun(client *ssh.Client, cmd string) error {
	sess, err := client.NewSession()
	if err != nil {
		return err
	}
	defer func() { _ = sess.Close() }()
	return sess.Run(cmd)
}

// sshWriteFile transfers data to remotePath on the SSH server.
// It uses a simple `cat >` pipe which works on any POSIX host without
// requiring the scp binary to be present on the remote side.
func (s *NodeService) sshWriteFile(client *ssh.Client, remotePath string, data []byte) error {
	sess, err := client.NewSession()
	if err != nil {
		return err
	}
	defer func() { _ = sess.Close() }()

	stdin, err := sess.StdinPipe()
	if err != nil {
		return err
	}

	// Extract the parent directory from the remote path.
	dir := remotePath
	if idx := strings.LastIndex(remotePath, "/"); idx >= 0 {
		dir = remotePath[:idx]
	}

	// Start the remote command before writing to stdin.
	cmd := fmt.Sprintf("mkdir -p '%s' && cat > '%s'", dir, remotePath)
	if err := sess.Start(cmd); err != nil {
		_ = stdin.Close()
		return err
	}

	if _, err := stdin.Write(data); err != nil {
		_ = stdin.Close()
		return err
	}
	_ = stdin.Close()
	return sess.Wait()
}
