package service

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/aetherproxy/backend/config"
	"golang.org/x/crypto/ssh"
)

type firewallBackend interface {
	localCapabilityState() (bool, string)
	listManagedLocalRules() ([]managedUFWRule, error)
	allowLocal(portRule) error
	deleteLocal(number int) error
	listManagedRemoteRules(client *ssh.Client) ([]managedUFWRule, error)
	allowRemote(client *ssh.Client, rule portRule) error
	deleteRemote(client *ssh.Client, number int) error
}

type ufwFirewallBackend struct{}

func newUFWFirewallBackend() firewallBackend {
	return &ufwFirewallBackend{}
}

func (b *ufwFirewallBackend) localCapabilityState() (bool, string) {
	if _, err := exec.LookPath(config.GetPortSyncUFWBinary()); err != nil {
		return false, "ufw binary not found"
	}
	if os.Geteuid() != 0 {
		return false, "process is not running as root"
	}
	if isLikelyContainerized() && !config.GetDockerHostnetEnabled() {
		return false, "containerized without host networking (set AETHER_DOCKER_HOSTNET=1)"
	}
	return true, "ready"
}

func (b *ufwFirewallBackend) listManagedLocalRules() ([]managedUFWRule, error) {
	out, err := b.runLocalUFW("status", "numbered")
	if err != nil {
		return nil, fmt.Errorf("ufw status: %w (%s)", err, strings.TrimSpace(out))
	}
	if err := ensureUFWActive(out); err != nil {
		return nil, err
	}
	return parseManagedUFWRules(out), nil
}

func (b *ufwFirewallBackend) allowLocal(r portRule) error {
	out, err := b.runLocalUFW("--force", "allow", fmt.Sprintf("%d/%s", r.Port, r.Proto), "comment", r.comment())
	if err != nil {
		return fmt.Errorf("allow %s: %w (%s)", r.key(), err, strings.TrimSpace(out))
	}
	return nil
}

func (b *ufwFirewallBackend) deleteLocal(number int) error {
	out, err := b.runLocalUFW("--force", "delete", strconv.Itoa(number))
	if err != nil {
		return fmt.Errorf("delete rule #%d: %w (%s)", number, err, strings.TrimSpace(out))
	}
	return nil
}

func (b *ufwFirewallBackend) listManagedRemoteRules(client *ssh.Client) ([]managedUFWRule, error) {
	cmd := fmt.Sprintf("%s status numbered", shellQuote(config.GetPortSyncUFWBinary()))
	out, err := runSSHCommandOutput(client, cmd)
	if err != nil {
		return nil, fmt.Errorf("remote ufw status: %w (%s)", err, strings.TrimSpace(out))
	}
	if err := ensureUFWActive(out); err != nil {
		return nil, err
	}
	return parseManagedUFWRules(out), nil
}

func (b *ufwFirewallBackend) allowRemote(client *ssh.Client, r portRule) error {
	cmd := fmt.Sprintf("%s --force allow %d/%s comment %s",
		shellQuote(config.GetPortSyncUFWBinary()),
		r.Port,
		r.Proto,
		shellQuote(r.comment()),
	)
	out, err := runSSHCommandOutput(client, cmd)
	if err != nil {
		return fmt.Errorf("allow remote %s: %w (%s)", r.key(), err, strings.TrimSpace(out))
	}
	return nil
}

func (b *ufwFirewallBackend) deleteRemote(client *ssh.Client, number int) error {
	cmd := fmt.Sprintf("%s --force delete %d", shellQuote(config.GetPortSyncUFWBinary()), number)
	out, err := runSSHCommandOutput(client, cmd)
	if err != nil {
		return fmt.Errorf("delete remote rule #%d: %w (%s)", number, err, strings.TrimSpace(out))
	}
	return nil
}

func (b *ufwFirewallBackend) runLocalUFW(args ...string) (string, error) {
	cmd := exec.Command(config.GetPortSyncUFWBinary(), args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

func runSSHCommandOutput(client *ssh.Client, cmd string) (string, error) {
	sess, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer func() { _ = sess.Close() }()
	out, err := sess.CombinedOutput(cmd)
	return string(out), err
}

func isLikelyContainerized() bool {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	content, err := os.ReadFile("/proc/1/cgroup")
	if err != nil {
		return false
	}
	text := strings.ToLower(string(content))
	markers := []string{"docker", "containerd", "kubepods", "libpod"}
	for _, m := range markers {
		if strings.Contains(text, m) {
			return true
		}
	}
	return false
}
