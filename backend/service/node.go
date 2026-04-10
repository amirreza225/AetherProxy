package service

import (
	"context"
	"fmt"
	"net"
	"os"
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

	cfg := &ssh.ClientConfig{
		User:            "root",
		Auth:            auth,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), //nolint:gosec // operator-managed nodes
		Timeout:         10 * time.Second,
	}
	addr := net.JoinHostPort(node.Host, fmt.Sprintf("%d", node.SshPort))
	return ssh.Dial("tcp", addr, cfg)
}

func (s *NodeService) sshRun(client *ssh.Client, cmd string) error {
	sess, err := client.NewSession()
	if err != nil {
		return err
	}
	defer func() { _ = sess.Close() }()
	return sess.Run(cmd)
}

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

	// Use scp protocol to transfer the file
	go func() {
		defer func() { _ = stdin.Close() }()
		_, _ = fmt.Fprintf(stdin, "C0644 %d config.json\n", len(data))
		_, _ = stdin.Write(data)
		_, _ = fmt.Fprintf(stdin, "\x00")
	}()

	dir := remotePath[:len(remotePath)-len("/config.json")]
	return sess.Run(fmt.Sprintf("mkdir -p %s && scp -t %s", dir, dir))
}
