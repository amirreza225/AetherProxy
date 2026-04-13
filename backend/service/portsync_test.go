package service

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aetherproxy/backend/database"
	"github.com/aetherproxy/backend/database/model"
	"github.com/aetherproxy/backend/logger"
	"github.com/op/go-logging"
	"golang.org/x/crypto/ssh"
)

var portSyncTestLoggerOnce sync.Once

type fakeFirewallBackend struct {
	capOK            bool
	capNote          string
	localRules       []managedUFWRule
	allowLocalErrors []error
	allowLocalCalls  int
}

func (f *fakeFirewallBackend) localCapabilityState() (bool, string) {
	if f.capNote == "" {
		f.capNote = "ready"
	}
	return f.capOK, f.capNote
}

func (f *fakeFirewallBackend) listManagedLocalRules() ([]managedUFWRule, error) {
	out := make([]managedUFWRule, len(f.localRules))
	copy(out, f.localRules)
	return out, nil
}

func (f *fakeFirewallBackend) allowLocal(rule portRule) error {
	f.allowLocalCalls++
	if len(f.allowLocalErrors) > 0 {
		err := f.allowLocalErrors[0]
		f.allowLocalErrors = f.allowLocalErrors[1:]
		if err != nil {
			return err
		}
	}
	f.localRules = append(f.localRules, managedUFWRule{Number: 1000 + f.allowLocalCalls, Rule: rule})
	return nil
}

func (f *fakeFirewallBackend) deleteLocal(number int) error {
	for i := range f.localRules {
		if f.localRules[i].Number == number {
			f.localRules = append(f.localRules[:i], f.localRules[i+1:]...)
			break
		}
	}
	return nil
}

func (f *fakeFirewallBackend) listManagedRemoteRules(_ *ssh.Client) ([]managedUFWRule, error) {
	return nil, nil
}

func (f *fakeFirewallBackend) allowRemote(_ *ssh.Client, _ portRule) error {
	return nil
}

func (f *fakeFirewallBackend) deleteRemote(_ *ssh.Client, _ int) error {
	return nil
}

func setupPortSyncDB(t *testing.T) {
	t.Helper()
	portSyncTestLoggerOnce.Do(func() {
		logger.InitLogger(logging.ERROR)
	})
	t.Setenv("AETHER_DB_DSN", "")
	t.Setenv("AETHER_GOSSIP_BOOTSTRAP", "")
	t.Setenv("AETHER_GOSSIP_MANIFEST_URL", "")
	t.Setenv("AETHER_GOSSIP_PORT", "7946")
	setDiscoveryRunningForTest(t, false)
	dbPath := filepath.Join(t.TempDir(), "portsync_test.db")
	if err := database.OpenDB(dbPath); err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := database.Migrate(); err != nil {
		t.Fatalf("migrate db: %v", err)
	}
}

func setDiscoveryRunningForTest(t *testing.T, running bool) {
	t.Helper()
	d := GetDiscoveryService()
	d.mu.Lock()
	prev := d.isRunning
	d.isRunning = running
	d.mu.Unlock()
	t.Cleanup(func() {
		d.mu.Lock()
		d.isRunning = prev
		d.mu.Unlock()
	})
}

func TestRuleFromComment(t *testing.T) {
	rule, ok := ruleFromComment("aetherproxy:tcp:443")
	if !ok {
		t.Fatal("expected valid managed comment")
	}
	if rule.Port != 443 || rule.Proto != "tcp" {
		t.Fatalf("unexpected rule parsed: %+v", rule)
	}

	if _, ok := ruleFromComment("manual:tcp:443"); ok {
		t.Fatal("expected non-managed comment to be ignored")
	}
	if _, ok := ruleFromComment("aetherproxy:icmp:8"); ok {
		t.Fatal("expected unsupported protocol to be rejected")
	}
}

func TestParseManagedUFWRules(t *testing.T) {
	status := `Status: active

[ 1] 22/tcp                     ALLOW IN    Anywhere
[ 2] 443/tcp                    ALLOW IN    Anywhere                   # aetherproxy:tcp:443
[ 3] 443/tcp (v6)               ALLOW IN    Anywhere (v6)              # aetherproxy:tcp:443
[ 4] 8443/udp                   ALLOW IN    Anywhere                   # aetherproxy:udp:8443`

	rules := parseManagedUFWRules(status)
	if len(rules) != 3 {
		t.Fatalf("expected 3 managed rules, got %d", len(rules))
	}
	if rules[0].Number != 2 || rules[0].Rule.key() != "tcp:443" {
		t.Fatalf("unexpected first rule: %+v", rules[0])
	}
	if rules[2].Number != 4 || rules[2].Rule.key() != "udp:8443" {
		t.Fatalf("unexpected last rule: %+v", rules[2])
	}
}

func TestInferInboundProtocols(t *testing.T) {
	if got := inferInboundProtocols("hysteria2", map[string]interface{}{}); len(got) != 1 || got[0] != "udp" {
		t.Fatalf("expected udp for hysteria2, got %#v", got)
	}
	if got := inferInboundProtocols("vless", map[string]interface{}{}); len(got) != 1 || got[0] != "tcp" {
		t.Fatalf("expected tcp for vless, got %#v", got)
	}
	got := inferInboundProtocols("vless", map[string]interface{}{"network": "tcp,udp"})
	if len(got) != 2 || got[0] != "tcp" || got[1] != "udp" {
		t.Fatalf("expected network override to tcp+udp, got %#v", got)
	}
}

func TestDiffRules(t *testing.T) {
	existing := []managedUFWRule{
		{Number: 2, Rule: portRule{Port: 443, Proto: "tcp"}},
		{Number: 5, Rule: portRule{Port: 8443, Proto: "udp"}},
	}
	desired := []portRule{
		{Port: 443, Proto: "tcp"},
		{Port: 9000, Proto: "tcp"},
	}

	toDelete, toAdd := diffRules(existing, desired)
	if len(toDelete) != 1 || toDelete[0].Number != 5 {
		t.Fatalf("unexpected delete list: %#v", toDelete)
	}
	if toDelete[0].Rule.key() != "udp:8443" {
		t.Fatalf("unexpected delete rule metadata: %#v", toDelete)
	}
	if len(toAdd) != 1 || toAdd[0].key() != "tcp:9000" {
		t.Fatalf("unexpected add list: %#v", toAdd)
	}
}

func TestPortSyncRetryLifecycle(t *testing.T) {	setupPortSyncDB(t)
	t.Setenv("AETHER_PORT_SYNC_ENABLED", "true")
	t.Setenv("AETHER_PORT_SYNC_LOCAL_ENABLED", "true")
	t.Setenv("AETHER_PORT_SYNC_REMOTE_ENABLED", "false")
	t.Setenv("AETHER_PORT_SYNC_RETRY_SECONDS", "1")

	db := database.GetDB()
	if err := db.Create(&model.Inbound{
		Type:    "vless",
		Tag:     "retry-life-in",
		Options: json.RawMessage(`{"listen":"0.0.0.0","listen_port":443}`),
	}).Error; err != nil {
		t.Fatalf("seed inbound: %v", err)
	}

	fw := &fakeFirewallBackend{
		capOK:            true,
		capNote:          "ready",
		allowLocalErrors: []error{errors.New("simulated allow failure")},
	}
	svc := &PortSyncService{firewall: fw}
	svc.upsertFailedTask(portSyncScopeLocal, 0, "seed", errors.New("initial failure"))

	var task model.PortSyncTask
	if err := db.First(&task).Error; err != nil {
		t.Fatalf("load seeded task: %v", err)
	}
	if task.Attempts != 1 || task.Status != portSyncTaskPending {
		t.Fatalf("unexpected initial task state: attempts=%d status=%s", task.Attempts, task.Status)
	}

	if err := db.Model(&task).Update("next_run_at", time.Now().Unix()-1).Error; err != nil {
		t.Fatalf("mark task due: %v", err)
	}
	if err := svc.ProcessDueTasks(10); err != nil {
		t.Fatalf("process due tasks (failure pass): %v", err)
	}

	if err := db.First(&task).Error; err != nil {
		t.Fatalf("task should remain queued after failure: %v", err)
	}
	if task.Attempts != 2 {
		t.Fatalf("expected attempts=2 after first retry failure, got %d", task.Attempts)
	}
	if task.Status != portSyncTaskPending {
		t.Fatalf("expected pending status after failure, got %s", task.Status)
	}
	if !strings.Contains(task.LastError, "simulated allow failure") {
		t.Fatalf("expected failure reason to be persisted, got %q", task.LastError)
	}
	if fw.allowLocalCalls != 1 {
		t.Fatalf("expected one allowLocal call, got %d", fw.allowLocalCalls)
	}

	if err := db.Model(&task).Update("next_run_at", time.Now().Unix()-1).Error; err != nil {
		t.Fatalf("mark task due for success retry: %v", err)
	}
	if err := svc.ProcessDueTasks(10); err != nil {
		t.Fatalf("process due tasks (success pass): %v", err)
	}

	var count int64
	if err := db.Model(&model.PortSyncTask{}).Count(&count).Error; err != nil {
		t.Fatalf("count tasks: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected task queue to be empty after successful retry, got %d", count)
	}
	if fw.allowLocalCalls != 2 {
		t.Fatalf("expected second allowLocal call on successful retry, got %d", fw.allowLocalCalls)
	}
}

func TestUpsertFailedTaskDedupSameError(t *testing.T) {
	setupPortSyncDB(t)
	svc := &PortSyncService{firewall: &fakeFirewallBackend{capOK: true}}

	svc.upsertFailedTask(portSyncScopeLocal, 0, "first", errors.New("same error"))

	db := database.GetDB()
	var task model.PortSyncTask
	if err := db.First(&task).Error; err != nil {
		t.Fatalf("load first task: %v", err)
	}
	firstAttempts := task.Attempts
	firstNextRunAt := task.NextRunAt

	svc.upsertFailedTask(portSyncScopeLocal, 0, "second", errors.New("same error"))

	if err := db.First(&task).Error; err != nil {
		t.Fatalf("load updated task: %v", err)
	}
	if task.Attempts != firstAttempts {
		t.Fatalf("expected attempts to stay %d for duplicate queued error, got %d", firstAttempts, task.Attempts)
	}
	if task.NextRunAt != firstNextRunAt {
		t.Fatalf("expected next_run_at to remain %d, got %d", firstNextRunAt, task.NextRunAt)
	}
	if task.Reason != "second" {
		t.Fatalf("expected reason to update to second, got %q", task.Reason)
	}
	if task.Status != portSyncTaskPending {
		t.Fatalf("expected pending status, got %s", task.Status)
	}
}

func TestCollectDesiredRulesDeduplicatesPorts(t *testing.T) {
	setupPortSyncDB(t)
	db := database.GetDB()

	inbounds := []model.Inbound{
		{
			Type:    "vless",
			Tag:     "dedup-a",
			Options: json.RawMessage(`{"listen_port":443}`),
		},
		{
			Type:    "vless",
			Tag:     "dedup-b",
			Options: json.RawMessage(`{"listen_port":"443"}`),
		},
		{
			Type:    "hysteria2",
			Tag:     "dedup-c",
			Options: json.RawMessage(`{"listen_port":443}`),
		},
	}
	if err := db.Create(&inbounds).Error; err != nil {
		t.Fatalf("seed inbounds: %v", err)
	}

	rules, err := (&PortSyncService{}).collectDesiredRules()
	if err != nil {
		t.Fatalf("collect desired rules: %v", err)
	}

	if len(rules) != 2 {
		t.Fatalf("expected 2 deduplicated rules (tcp+udp on 443), got %d: %#v", len(rules), rules)
	}

	keys := map[string]bool{}
	for _, r := range rules {
		keys[r.key()] = true
	}
	if !keys["tcp:443"] || !keys["udp:443"] {
		t.Fatalf("expected tcp:443 and udp:443, got keys=%#v", keys)
	}
}

func TestCollectDesiredRulesIncludesGossipWhenDiscoveryRunning(t *testing.T) {
	setupPortSyncDB(t)
	setDiscoveryRunningForTest(t, true)
	t.Setenv("AETHER_GOSSIP_PORT", "7946")

	rules, err := (&PortSyncService{}).collectDesiredRules()
	if err != nil {
		t.Fatalf("collect desired rules: %v", err)
	}

	keys := map[string]bool{}
	for _, r := range rules {
		keys[r.key()] = true
	}
	if !keys["tcp:7946"] || !keys["udp:7946"] {
		t.Fatalf("expected gossip rules tcp:7946 and udp:7946, got keys=%#v", keys)
	}
}

// fakeFirewallBackendUFWInactive simulates a firewall that runs ufw status
// but returns "ufw is inactive".
type fakeFirewallBackendUFWInactive struct{}

func (f *fakeFirewallBackendUFWInactive) localCapabilityState() (bool, string) {
	return true, "ready"
}

func (f *fakeFirewallBackendUFWInactive) listManagedLocalRules() ([]managedUFWRule, error) {
	return nil, errUFWInactive
}

func (f *fakeFirewallBackendUFWInactive) allowLocal(_ portRule) error   { return nil }
func (f *fakeFirewallBackendUFWInactive) deleteLocal(_ int) error       { return nil }
func (f *fakeFirewallBackendUFWInactive) listManagedRemoteRules(_ *ssh.Client) ([]managedUFWRule, error) {
	return nil, errUFWInactive
}
func (f *fakeFirewallBackendUFWInactive) allowRemote(_ *ssh.Client, _ portRule) error  { return nil }
func (f *fakeFirewallBackendUFWInactive) deleteRemote(_ *ssh.Client, _ int) error      { return nil }

func TestPortSyncUFWInactiveNoRetryTask(t *testing.T) {
	setupPortSyncDB(t)
	t.Setenv("AETHER_PORT_SYNC_ENABLED", "true")
	t.Setenv("AETHER_PORT_SYNC_LOCAL_ENABLED", "true")
	t.Setenv("AETHER_PORT_SYNC_REMOTE_ENABLED", "false")
	t.Setenv("AETHER_PORT_SYNC_RETRY_SECONDS", "1")

	svc := &PortSyncService{firewall: &fakeFirewallBackendUFWInactive{}}
	svc.syncAllTargets("startup")

	db := database.GetDB()
	var count int64
	if err := db.Model(&model.PortSyncTask{}).Count(&count).Error; err != nil {
		t.Fatalf("count tasks: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected no retry task for ufw-inactive (permanent error), got %d", count)
	}
}

func TestPortSyncCapabilityErrorNoRetryTask(t *testing.T) {
	setupPortSyncDB(t)
	t.Setenv("AETHER_PORT_SYNC_ENABLED", "true")
	t.Setenv("AETHER_PORT_SYNC_LOCAL_ENABLED", "true")
	t.Setenv("AETHER_PORT_SYNC_REMOTE_ENABLED", "false")
	t.Setenv("AETHER_PORT_SYNC_RETRY_SECONDS", "1")

	svc := &PortSyncService{firewall: &fakeFirewallBackend{capOK: false, capNote: "ufw binary not found"}}
	svc.syncAllTargets("startup")

	db := database.GetDB()
	var count int64
	if err := db.Model(&model.PortSyncTask{}).Count(&count).Error; err != nil {
		t.Fatalf("count tasks: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected no retry task for capability failure (permanent error), got %d", count)
	}
}

func TestPortSyncProcessDueTasks_PermanentErrorDeletesTask(t *testing.T) {
	setupPortSyncDB(t)
	t.Setenv("AETHER_PORT_SYNC_ENABLED", "true")
	t.Setenv("AETHER_PORT_SYNC_LOCAL_ENABLED", "true")
	t.Setenv("AETHER_PORT_SYNC_REMOTE_ENABLED", "false")
	t.Setenv("AETHER_PORT_SYNC_RETRY_SECONDS", "1")

	svc := &PortSyncService{firewall: &fakeFirewallBackendUFWInactive{}}

	// Seed an existing retry task (simulating a task created before this fix).
	svc.upsertFailedTask(portSyncScopeLocal, 0, "startup", errors.New("ufw is inactive"))

	db := database.GetDB()
	var task model.PortSyncTask
	if err := db.First(&task).Error; err != nil {
		t.Fatalf("load seeded task: %v", err)
	}
	// Mark it as due.
	if err := db.Model(&task).Update("next_run_at", time.Now().Unix()-1).Error; err != nil {
		t.Fatalf("mark task due: %v", err)
	}

	if err := svc.ProcessDueTasks(10); err != nil {
		t.Fatalf("ProcessDueTasks: %v", err)
	}

	var count int64
	if err := db.Model(&model.PortSyncTask{}).Count(&count).Error; err != nil {
		t.Fatalf("count tasks: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected task to be deleted after permanent error, got %d tasks remaining", count)
	}
}
