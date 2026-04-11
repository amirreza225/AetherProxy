package service

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aetherproxy/backend/config"
	"github.com/aetherproxy/backend/database"
	"github.com/aetherproxy/backend/database/model"
	"github.com/aetherproxy/backend/logger"
	"golang.org/x/crypto/ssh"
)

const (
	portSyncScopeLocal      = "local"
	portSyncScopeNode       = "node"
	portSyncCommentPrefix   = "aetherproxy"
	portSyncMaxLastErrorLen = 1000
)

type portRule struct {
	Port  int
	Proto string
}

func (r portRule) key() string {
	return fmt.Sprintf("%s:%d", r.Proto, r.Port)
}

func (r portRule) comment() string {
	return fmt.Sprintf("%s:%s:%d", portSyncCommentPrefix, r.Proto, r.Port)
}

type managedUFWRule struct {
	Number int
	Rule   portRule
}

// PortSyncStatus is an operational snapshot for inbound firewall reconciliation.
type PortSyncStatus struct {
	Enabled             bool                 `json:"enabled"`
	LocalEnabled        bool                 `json:"localEnabled"`
	RemoteEnabled       bool                 `json:"remoteEnabled"`
	RetrySeconds        int                  `json:"retrySeconds"`
	UFWBinary           string               `json:"ufwBinary"`
	LocalCapabilityOK   bool                 `json:"localCapabilityOk"`
	LocalCapabilityNote string               `json:"localCapabilityNote"`
	PendingTasks        int64                `json:"pendingTasks"`
	PendingLocal        int64                `json:"pendingLocal"`
	PendingNode         int64                `json:"pendingNode"`
	NextRunAt           int64                `json:"nextRunAt"`
	Tasks               []model.PortSyncTask `json:"tasks"`
}

// PortSyncService reconciles inbound ports with managed UFW rules.
type PortSyncService struct{}

var portSyncOnce sync.Once
var globalPortSyncService *PortSyncService

func GetPortSyncService() *PortSyncService {
	portSyncOnce.Do(func() {
		globalPortSyncService = &PortSyncService{}
	})
	return globalPortSyncService
}

// GetStatus returns queue and capability state for PortSync operations.
func (s *PortSyncService) GetStatus(limit int) (*PortSyncStatus, error) {
	if limit <= 0 {
		limit = 30
	}
	if limit > 200 {
		limit = 200
	}

	db := database.GetDB()
	status := &PortSyncStatus{
		Enabled:       config.GetPortSyncEnabled(),
		LocalEnabled:  config.GetPortSyncLocalEnabled(),
		RemoteEnabled: config.GetPortSyncRemoteEnabled(),
		RetrySeconds:  config.GetPortSyncRetrySeconds(),
		UFWBinary:     config.GetPortSyncUFWBinary(),
	}
	status.LocalCapabilityOK, status.LocalCapabilityNote = s.localCapabilityState()

	if err := db.Model(&model.PortSyncTask{}).Count(&status.PendingTasks).Error; err != nil {
		return nil, err
	}
	if err := db.Model(&model.PortSyncTask{}).Where("scope = ?", portSyncScopeLocal).Count(&status.PendingLocal).Error; err != nil {
		return nil, err
	}
	if err := db.Model(&model.PortSyncTask{}).Where("scope = ?", portSyncScopeNode).Count(&status.PendingNode).Error; err != nil {
		return nil, err
	}

	var nextTask model.PortSyncTask
	if err := db.Order("next_run_at asc").First(&nextTask).Error; err == nil {
		status.NextRunAt = nextTask.NextRunAt
	} else if !database.IsNotFound(err) {
		return nil, err
	}

	if err := db.Order("next_run_at asc").Limit(limit).Find(&status.Tasks).Error; err != nil {
		return nil, err
	}

	return status, nil
}

// TriggerImmediateSync starts an async full reconciliation run.
func (s *PortSyncService) TriggerImmediateSync(reason string) {
	if !config.GetPortSyncEnabled() {
		return
	}
	go s.syncAllTargets(reason)
}

// TriggerNodeImmediateSync starts an async reconciliation run for one remote node.
func (s *PortSyncService) TriggerNodeImmediateSync(nodeID uint, reason string) {
	if !config.GetPortSyncEnabled() || !config.GetPortSyncRemoteEnabled() {
		return
	}
	go s.syncOneNode(nodeID, reason)
}

func (s *PortSyncService) syncAllTargets(reason string) {
	desired, err := s.collectDesiredRules()
	if err != nil {
		logger.Warning("PortSync: failed to compute desired rules:", err)
		return
	}
	logger.Infof("PortSync: reconcile start reason=%q desired_rules=%d", reason, len(desired))

	if config.GetPortSyncLocalEnabled() {
		if err := s.reconcileLocal(desired); err != nil {
			logger.Warning("PortSync: local reconcile failed:", err)
			s.upsertFailedTask(portSyncScopeLocal, 0, reason, err)
		}
	} else {
		logger.Info("PortSync: local reconciliation disabled by config")
	}

	if !config.GetPortSyncRemoteEnabled() {
		logger.Infof("PortSync: reconcile done reason=%q nodes=%d failed_nodes=%d", reason, 0, 0)
		return
	}

	nodes, err := GetNodeService().GetAll()
	if err != nil {
		logger.Warning("PortSync: list nodes failed:", err)
		return
	}
	nodeTotal := 0
	nodeFailed := 0
	for _, node := range nodes {
		nodeTotal++
		if err := s.reconcileNode(node.Id, desired); err != nil {
			nodeFailed++
			logger.Warningf("PortSync: node %d reconcile failed: %v", node.Id, err)
			s.upsertFailedTask(portSyncScopeNode, node.Id, reason, err)
		}
	}
	logger.Infof("PortSync: reconcile done reason=%q nodes=%d failed_nodes=%d", reason, nodeTotal, nodeFailed)
}

func (s *PortSyncService) syncOneNode(nodeID uint, reason string) {
	desired, err := s.collectDesiredRules()
	if err != nil {
		logger.Warning("PortSync: failed to compute desired rules:", err)
		return
	}
	logger.Infof("PortSync: node reconcile start node=%d reason=%q desired_rules=%d", nodeID, reason, len(desired))
	if err := s.reconcileNode(nodeID, desired); err != nil {
		logger.Warningf("PortSync: node %d reconcile failed: %v", nodeID, err)
		s.upsertFailedTask(portSyncScopeNode, nodeID, reason, err)
		return
	}
	logger.Infof("PortSync: node reconcile done node=%d reason=%q", nodeID, reason)
}

// ProcessDueTasks retries pending failed reconciliation tasks.
func (s *PortSyncService) ProcessDueTasks(limit int) error {
	if !config.GetPortSyncEnabled() {
		return nil
	}
	if limit <= 0 {
		limit = 20
	}

	now := time.Now().Unix()
	db := database.GetDB()
	var tasks []model.PortSyncTask
	err := db.Where("next_run_at <= ?", now).Order("next_run_at asc").Limit(limit).Find(&tasks).Error
	if err != nil {
		return err
	}
	if len(tasks) == 0 {
		return nil
	}
	logger.Infof("PortSync: processing retry batch size=%d", len(tasks))

	desired, err := s.collectDesiredRules()
	if err != nil {
		for _, task := range tasks {
			s.updateTaskFailure(&task, "recompute", err)
		}
		return err
	}

	for i := range tasks {
		task := tasks[i]
		var runErr error
		switch task.Scope {
		case portSyncScopeLocal:
			if !config.GetPortSyncLocalEnabled() {
				runErr = nil
			} else {
				runErr = s.reconcileLocal(desired)
			}
		case portSyncScopeNode:
			if !config.GetPortSyncRemoteEnabled() {
				runErr = nil
			} else {
				runErr = s.reconcileNode(task.NodeId, desired)
				if database.IsNotFound(runErr) {
					runErr = nil
				}
			}
		default:
			runErr = fmt.Errorf("unknown task scope: %s", task.Scope)
		}

		if runErr == nil {
			if err := db.Delete(&task).Error; err != nil {
				logger.Warningf("PortSync: failed to delete completed task %d: %v", task.Id, err)
			}
			continue
		}
		s.updateTaskFailure(&task, task.Reason, runErr)
	}

	return nil
}

func (s *PortSyncService) localCapabilityState() (bool, string) {
	if !config.GetPortSyncLocalEnabled() {
		return false, "local sync disabled"
	}
	if _, err := exec.LookPath(config.GetPortSyncUFWBinary()); err != nil {
		return false, "ufw binary not found"
	}
	if os.Geteuid() != 0 {
		return false, "process is not running as root"
	}
	return true, "ready"
}

func (s *PortSyncService) updateTaskFailure(task *model.PortSyncTask, reason string, cause error) {
	db := database.GetDB()
	now := time.Now().Unix()
	task.Reason = reason
	task.Attempts++
	task.LastError = truncateString(cause.Error(), portSyncMaxLastErrorLen)
	task.NextRunAt = now + int64(s.retryDelaySeconds(task.Attempts))
	task.UpdatedAt = now
	if err := db.Save(task).Error; err != nil {
		logger.Warningf("PortSync: failed to update task %d: %v", task.Id, err)
	}
}

func (s *PortSyncService) upsertFailedTask(scope string, nodeID uint, reason string, cause error) {
	db := database.GetDB()
	now := time.Now().Unix()

	var task model.PortSyncTask
	err := db.Where("scope = ? AND node_id = ?", scope, nodeID).First(&task).Error
	if err != nil {
		if !database.IsNotFound(err) {
			logger.Warning("PortSync: load task failed:", err)
			return
		}
		task = model.PortSyncTask{
			Scope:     scope,
			NodeId:    nodeID,
			Reason:    reason,
			Attempts:  1,
			LastError: truncateString(cause.Error(), portSyncMaxLastErrorLen),
			NextRunAt: now + int64(s.retryDelaySeconds(1)),
			CreatedAt: now,
			UpdatedAt: now,
		}
		if createErr := db.Create(&task).Error; createErr != nil {
			logger.Warning("PortSync: create task failed:", createErr)
		}
		return
	}

	task.Reason = reason
	task.Attempts++
	task.LastError = truncateString(cause.Error(), portSyncMaxLastErrorLen)
	task.NextRunAt = now + int64(s.retryDelaySeconds(task.Attempts))
	task.UpdatedAt = now
	if saveErr := db.Save(&task).Error; saveErr != nil {
		logger.Warning("PortSync: update task failed:", saveErr)
	}
}

func (s *PortSyncService) retryDelaySeconds(attempts int) int {
	base := config.GetPortSyncRetrySeconds()
	if attempts <= 1 {
		return base
	}
	multiplier := 1 << minInt(attempts-1, 5)
	delay := base * multiplier
	if delay > 1800 {
		return 1800
	}
	return delay
}

func (s *PortSyncService) collectDesiredRules() ([]portRule, error) {
	inbounds := []model.Inbound{}
	err := database.GetDB().Model(model.Inbound{}).Find(&inbounds).Error
	if err != nil {
		return nil, err
	}

	uniq := make(map[string]portRule)
	for _, inbound := range inbounds {
		if len(inbound.Options) == 0 {
			continue
		}
		var opts map[string]interface{}
		if err := json.Unmarshal(inbound.Options, &opts); err != nil {
			logger.Warningf("PortSync: skip inbound %s due to invalid options: %v", inbound.Tag, err)
			continue
		}
		if !shouldExposeListen(opts) {
			continue
		}
		port, ok := extractListenPort(opts)
		if !ok {
			logger.Warningf("PortSync: skip inbound %s due to missing/invalid listen_port", inbound.Tag)
			continue
		}
		for _, proto := range inferInboundProtocols(inbound.Type, opts) {
			r := portRule{Port: port, Proto: proto}
			uniq[r.key()] = r
		}
	}

	rules := make([]portRule, 0, len(uniq))
	for _, r := range uniq {
		rules = append(rules, r)
	}
	sort.Slice(rules, func(i, j int) bool {
		if rules[i].Proto == rules[j].Proto {
			return rules[i].Port < rules[j].Port
		}
		return rules[i].Proto < rules[j].Proto
	})
	return rules, nil
}

func (s *PortSyncService) reconcileLocal(desired []portRule) error {
	existing, err := s.listManagedLocalRules()
	if err != nil {
		return err
	}
	toDelete, toAdd := diffRules(existing, desired)
	logger.Infof("PortSync: scope=local op=reconcile desired=%d existing=%d delete=%d add=%d", len(desired), len(existing), len(toDelete), len(toAdd))

	for _, del := range toDelete {
		logger.Infof("PortSync: scope=local op=delete proto=%s port=%d rule_number=%d", del.Rule.Proto, del.Rule.Port, del.Number)
		if out, err := runLocalUFW("--force", "delete", strconv.Itoa(del.Number)); err != nil {
			return fmt.Errorf("delete rule #%d: %w (%s)", del.Number, err, strings.TrimSpace(out))
		}
	}
	for _, r := range toAdd {
		logger.Infof("PortSync: scope=local op=allow proto=%s port=%d", r.Proto, r.Port)
		if out, err := runLocalUFW("--force", "allow", fmt.Sprintf("%d/%s", r.Port, r.Proto), "comment", r.comment()); err != nil {
			return fmt.Errorf("allow %s: %w (%s)", r.key(), err, strings.TrimSpace(out))
		}
	}
	return nil
}

func (s *PortSyncService) reconcileNode(nodeID uint, desired []portRule) error {
	nodeSvc := GetNodeService()
	node, err := nodeSvc.GetByID(nodeID)
	if err != nil {
		return err
	}
	client, err := nodeSvc.sshDial(node)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()

	existing, err := s.listManagedRemoteRules(client)
	if err != nil {
		return err
	}
	toDelete, toAdd := diffRules(existing, desired)
	logger.Infof("PortSync: scope=node node=%d op=reconcile desired=%d existing=%d delete=%d add=%d", nodeID, len(desired), len(existing), len(toDelete), len(toAdd))

	for _, del := range toDelete {
		logger.Infof("PortSync: scope=node node=%d op=delete proto=%s port=%d rule_number=%d", nodeID, del.Rule.Proto, del.Rule.Port, del.Number)
		cmd := fmt.Sprintf("%s --force delete %d", shellQuote(config.GetPortSyncUFWBinary()), del.Number)
		if out, err := runSSHCommandOutput(client, cmd); err != nil {
			return fmt.Errorf("delete remote rule #%d: %w (%s)", del.Number, err, strings.TrimSpace(out))
		}
	}
	for _, r := range toAdd {
		logger.Infof("PortSync: scope=node node=%d op=allow proto=%s port=%d", nodeID, r.Proto, r.Port)
		cmd := fmt.Sprintf("%s --force allow %d/%s comment %s",
			shellQuote(config.GetPortSyncUFWBinary()),
			r.Port,
			r.Proto,
			shellQuote(r.comment()),
		)
		if out, err := runSSHCommandOutput(client, cmd); err != nil {
			return fmt.Errorf("allow remote %s: %w (%s)", r.key(), err, strings.TrimSpace(out))
		}
	}
	return nil
}

func (s *PortSyncService) listManagedLocalRules() ([]managedUFWRule, error) {
	out, err := runLocalUFW("status", "numbered")
	if err != nil {
		return nil, fmt.Errorf("ufw status: %w (%s)", err, strings.TrimSpace(out))
	}
	if err := ensureUFWActive(out); err != nil {
		return nil, err
	}
	return parseManagedUFWRules(out), nil
}

func (s *PortSyncService) listManagedRemoteRules(client *ssh.Client) ([]managedUFWRule, error) {
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

func runLocalUFW(args ...string) (string, error) {
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

func diffRules(existing []managedUFWRule, desired []portRule) ([]managedUFWRule, []portRule) {
	existingByKey := make(map[string]struct{})
	desiredByKey := make(map[string]portRule)

	toDelete := make([]managedUFWRule, 0)
	for _, ex := range existing {
		existingByKey[ex.Rule.key()] = struct{}{}
	}
	for _, d := range desired {
		desiredByKey[d.key()] = d
	}

	for _, ex := range existing {
		if _, ok := desiredByKey[ex.Rule.key()]; !ok {
			toDelete = append(toDelete, ex)
		}
	}
	toAdd := make([]portRule, 0)
	for _, d := range desired {
		if _, ok := existingByKey[d.key()]; !ok {
			toAdd = append(toAdd, d)
		}
	}

	sort.Slice(toDelete, func(i, j int) bool { return toDelete[i].Number > toDelete[j].Number })
	return toDelete, toAdd
}

func parseManagedUFWRules(output string) []managedUFWRule {
	lines := strings.Split(output, "\n")
	rules := make([]managedUFWRule, 0)
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "[") {
			continue
		}
		closeIdx := strings.Index(trimmed, "]")
		if closeIdx < 0 {
			continue
		}
		numberPart := strings.TrimSpace(strings.TrimPrefix(trimmed[:closeIdx+1], "["))
		numberPart = strings.TrimSuffix(numberPart, "]")
		num, err := strconv.Atoi(strings.TrimSpace(numberPart))
		if err != nil {
			continue
		}

		commentIdx := strings.Index(trimmed, "#")
		if commentIdx < 0 {
			continue
		}
		comment := strings.TrimSpace(trimmed[commentIdx+1:])
		rule, ok := ruleFromComment(comment)
		if !ok {
			continue
		}
		rules = append(rules, managedUFWRule{Number: num, Rule: rule})
	}
	return rules
}

func ruleFromComment(comment string) (portRule, bool) {
	parts := strings.Split(comment, ":")
	if len(parts) != 3 {
		return portRule{}, false
	}
	if parts[0] != portSyncCommentPrefix {
		return portRule{}, false
	}
	proto := strings.ToLower(parts[1])
	if proto != "tcp" && proto != "udp" {
		return portRule{}, false
	}
	port, err := strconv.Atoi(parts[2])
	if err != nil || port < 1 || port > 65535 {
		return portRule{}, false
	}
	return portRule{Port: port, Proto: proto}, true
}

func ensureUFWActive(output string) error {
	if strings.Contains(strings.ToLower(output), "status: inactive") {
		return fmt.Errorf("ufw is inactive")
	}
	return nil
}

func shouldExposeListen(opts map[string]interface{}) bool {
	listenVal, ok := opts["listen"]
	if !ok {
		return true
	}
	listen, ok := listenVal.(string)
	if !ok {
		return true
	}
	listen = strings.TrimSpace(strings.ToLower(listen))
	if listen == "" {
		return true
	}
	switch listen {
	case "127.0.0.1", "localhost", "::1":
		return false
	}
	return !strings.HasPrefix(listen, "unix://")
}

func extractListenPort(opts map[string]interface{}) (int, bool) {
	val, ok := opts["listen_port"]
	if !ok {
		return 0, false
	}
	switch t := val.(type) {
	case float64:
		p := int(t)
		if p >= 1 && p <= 65535 {
			return p, true
		}
	case int:
		if t >= 1 && t <= 65535 {
			return t, true
		}
	case int64:
		if t >= 1 && t <= 65535 {
			return int(t), true
		}
	case json.Number:
		v, err := t.Int64()
		if err == nil && v >= 1 && v <= 65535 {
			return int(v), true
		}
	case string:
		v, err := strconv.Atoi(strings.TrimSpace(t))
		if err == nil && v >= 1 && v <= 65535 {
			return v, true
		}
	}
	return 0, false
}

func inferInboundProtocols(inboundType string, opts map[string]interface{}) []string {
	if networkRaw, ok := opts["network"]; ok {
		if network, ok := networkRaw.(string); ok {
			parsed := parseNetworkProtocols(network)
			if len(parsed) > 0 {
				return parsed
			}
		}
	}

	switch strings.ToLower(strings.TrimSpace(inboundType)) {
	case "hysteria", "hysteria2", "tuic", "wireguard":
		return []string{"udp"}
	case "mixed", "socks", "shadowsocks", "tun", "tproxy":
		return []string{"tcp", "udp"}
	default:
		return []string{"tcp"}
	}
}

func parseNetworkProtocols(network string) []string {
	parts := strings.Split(strings.ToLower(network), ",")
	hasTCP := false
	hasUDP := false
	for _, part := range parts {
		p := strings.TrimSpace(part)
		switch p {
		case "tcp":
			hasTCP = true
		case "udp":
			hasUDP = true
		case "tcpudp", "tcp+udp", "udp+tcp":
			hasTCP = true
			hasUDP = true
		}
	}
	if !hasTCP && !hasUDP {
		return nil
	}
	if hasTCP && hasUDP {
		return []string{"tcp", "udp"}
	}
	if hasTCP {
		return []string{"tcp"}
	}
	return []string{"udp"}
}

func truncateString(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	return s[:max]
}

func shellQuote(s string) string {
	if s == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'"
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}
