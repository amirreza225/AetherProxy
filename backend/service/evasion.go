package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aetherproxy/backend/config"
	"github.com/aetherproxy/backend/database"
	"github.com/aetherproxy/backend/database/model"
	"github.com/aetherproxy/backend/logger"
)

// EvasionWatcher scrapes external censorship-monitoring sources and
// automatically adjusts subscription priority when blocks are detected.
type EvasionWatcher struct {
	mu        sync.Mutex
	stopCh    chan struct{}
	isRunning bool
}

var evasionWatcherOnce sync.Once
var globalEvasionWatcher *EvasionWatcher

// GetEvasionWatcher returns the singleton EvasionWatcher.
func GetEvasionWatcher() *EvasionWatcher {
	evasionWatcherOnce.Do(func() {
		globalEvasionWatcher = &EvasionWatcher{
			stopCh: make(chan struct{}),
		}
	})
	return globalEvasionWatcher
}

// Start launches the background scraper, telemetry evaluation, and synthetic
// test goroutines. All three loops have ±10 % jitter on their intervals.
func (w *EvasionWatcher) Start() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.isRunning {
		return
	}
	w.isRunning = true
	w.stopCh = make(chan struct{})
	go w.scrapeLoop()
	go w.telemetryLoop()
	go w.syntheticTestLoop()
	logger.Info("EvasionWatcher started")
}

// Stop shuts down all EvasionWatcher goroutines.
func (w *EvasionWatcher) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.isRunning {
		return
	}
	close(w.stopCh)
	w.isRunning = false
}

// jitterDuration returns base ± fraction*base.
func jitterDuration(base time.Duration, fraction float64) time.Duration {
	delta := float64(base) * fraction
	return base + time.Duration((rand.Float64()*2-1)*delta)
}

// scrapeLoop scrapes configured URLs every ~10 minutes with ±10 % jitter.
func (w *EvasionWatcher) scrapeLoop() {
	w.scrape()
	for {
		select {
		case <-w.stopCh:
			return
		case <-time.After(jitterDuration(10*time.Minute, 0.1)):
			w.scrape()
		}
	}
}

// telemetryLoop evaluates client telemetry every ~5 minutes with ±10 % jitter.
// Waits 1 minute before the first evaluation to allow data to accumulate.
func (w *EvasionWatcher) telemetryLoop() {
	select {
	case <-w.stopCh:
		return
	case <-time.After(1 * time.Minute):
	}
	for {
		w.evaluateTelemetry()
		select {
		case <-w.stopCh:
			return
		case <-time.After(jitterDuration(5*time.Minute, 0.1)):
		}
	}
}

// syntheticTestLoop probes inbound TCP ports every ~30 minutes with ±10 % jitter.
// Waits 5 minutes before the first run.
func (w *EvasionWatcher) syntheticTestLoop() {
	select {
	case <-w.stopCh:
		return
	case <-time.After(5 * time.Minute):
	}
	for {
		w.syntheticTest()
		select {
		case <-w.stopCh:
			return
		case <-time.After(jitterDuration(30*time.Minute, 0.1)):
		}
	}
}

const (
	// maxResponseBodyBytes caps the response body read from external scraper endpoints.
	maxResponseBodyBytes = 1 << 20 // 1 MB
)

func (w *EvasionWatcher) scrape() {
	urls := config.GetEvasionAPIURLs()
	if len(urls) == 0 {
		// No source configured; skip silently.
		return
	}

	for _, apiURL := range urls {
		logger.Info("EvasionWatcher: scraping censorship data from", apiURL)
		events := w.fetchData(apiURL)
		if len(events) == 0 {
			continue
		}

		db := database.GetDB()
		for i := range events {
			events[i].DateTime = time.Now().Unix()
			if isRealityBlock(events[i]) {
				next := nextEvasionProtocol("vless-reality")
				events[i].AutoAction = autoActionLabel(next)
				logger.Warningf("EvasionWatcher: Reality/VLESS block detected from %s – switching to %s", apiURL, next)
				w.executeAutoAction(next)
			} else if isHysteria2Block(events[i]) {
				next := nextEvasionProtocol("hysteria2")
				events[i].AutoAction = autoActionLabel(next)
				logger.Warningf("EvasionWatcher: Hysteria2 block detected from %s – switching to %s", apiURL, next)
				w.executeAutoAction(next)
			} else if isTuicBlock(events[i]) {
				next := nextEvasionProtocol("tuic")
				events[i].AutoAction = autoActionLabel(next)
				if next == "" {
					logger.Warningf("EvasionWatcher: TUIC block detected from %s – reverting to default ordering", apiURL)
				} else {
					logger.Warningf("EvasionWatcher: TUIC block detected from %s – switching to %s", apiURL, next)
				}
				w.executeAutoAction(next)
			}
			if err := db.Create(&events[i]).Error; err != nil {
				logger.Warning("EvasionWatcher: failed to save event:", err)
			}
		}
	}
}

// nextEvasionProtocol returns the next protocol to promote when failingProtocol
// is being blocked. Returns "" to revert to default ordering.
func nextEvasionProtocol(failingProtocol string) string {
	lower := strings.ToLower(failingProtocol)
	switch {
	case strings.Contains(lower, "vless") || strings.Contains(lower, "reality"):
		return "hysteria2"
	case strings.Contains(lower, "hysteria2"):
		return "tuic"
	default:
		return "" // revert to default / clear preference
	}
}

// autoActionLabel converts a protocol name into the AutoAction field string.
func autoActionLabel(proto string) string {
	if proto == "" {
		return "reset_to_default"
	}
	return "promote_" + strings.ReplaceAll(proto, "-", "_")
}

// evasionPreferenceTTL is the maximum age of a stored evasion preference.
// After this duration it is treated as expired and ignored until the
// watcher sets a new one or the admin explicitly resets it.
const evasionPreferenceTTL = 24 * time.Hour

// evasionPreferenceSettingKey is the DB key for the auto-promoted protocol name.
const evasionPreferenceSettingKey = "evasionPreferredProtocol"

// evasionPreferenceTSKey is the DB key for the Unix timestamp at which the
// preference was last set, used to enforce the 24-hour TTL.
const evasionPreferenceTSKey = "evasionPreferredProtocolTS"

// executeAutoAction stores the preferred protocol in the settings table so
// that the subscription generator can re-order links by preference.
// preferredProtocol may be "" to clear the preference and revert to defaults.
func (w *EvasionWatcher) executeAutoAction(preferredProtocol string) {
	var ss SettingService
	if err := ss.saveSetting(evasionPreferenceSettingKey, preferredProtocol); err != nil {
		logger.Warning("EvasionWatcher: failed to persist preferred protocol:", err)
		return
	}
	// Persist the timestamp so callers can enforce the TTL.
	ts := time.Now().Unix()
	if err := ss.saveSetting(evasionPreferenceTSKey, fmt.Sprintf("%d", ts)); err != nil {
		logger.Warning("EvasionWatcher: failed to persist preference timestamp:", err)
	}
	if preferredProtocol == "" {
		logger.Info("EvasionWatcher: protocol preference cleared (reverting to default ordering)")
	} else {
		logger.Infof("EvasionWatcher: preferred protocol set to %q – clients will receive updated subscription on next fetch", preferredProtocol)
	}
	// Bump LastUpdate so subscribed clients know to re-fetch.
	LastUpdate = ts

	// Notify Telegram channel if configured.
	GetTelegramNotifier().NotifyEvasionSwitch(preferredProtocol)
}

// GetEvasionPreferredProtocol returns the current auto-promoted protocol
// (e.g. "hysteria2") or an empty string when no preference has been set or
// when the stored preference is older than evasionPreferenceTTL (24 h).
func GetEvasionPreferredProtocol() string {
	var ss SettingService
	val, err := ss.getString(evasionPreferenceSettingKey)
	if err != nil || val == "" {
		return ""
	}
	// Enforce TTL: ignore preferences that are too old.
	tsStr, err := ss.getString(evasionPreferenceTSKey)
	if err != nil || tsStr == "" {
		// No timestamp recorded – treat as expired to be safe.
		return ""
	}
	ts, err := strconv.ParseInt(tsStr, 10, 64)
	if err != nil {
		// Unparseable timestamp – expire the preference rather than acting on stale data.
		return ""
	}
	if time.Since(time.Unix(ts, 0)) > evasionPreferenceTTL {
		return ""
	}
	return val
}

// ResetEvasionPreference clears the stored protocol preference and its
// timestamp so that subscriptions revert to their default ordering.
func ResetEvasionPreference() error {
	var ss SettingService
	if err := ss.saveSetting(evasionPreferenceSettingKey, ""); err != nil {
		return err
	}
	if err := ss.saveSetting(evasionPreferenceTSKey, ""); err != nil {
		return err
	}
	LastUpdate = time.Now().Unix()
	logger.Info("EvasionWatcher: protocol preference cleared by admin")
	return nil
}

// isRealityBlock returns true when the event suggests a Reality/VLESS block.
func isRealityBlock(e model.EvasionEvent) bool {
	l := strings.ToLower(e.Protocol)
	return strings.Contains(l, "reality") || strings.Contains(l, "vless")
}

// isHysteria2Block returns true when the event suggests a Hysteria2 block.
func isHysteria2Block(e model.EvasionEvent) bool {
	l := strings.ToLower(e.Protocol)
	return strings.Contains(l, "hysteria2") || strings.Contains(l, "hysteria 2")
}

// isTuicBlock returns true when the event suggests a TUIC block.
func isTuicBlock(e model.EvasionEvent) bool {
	return strings.Contains(strings.ToLower(e.Protocol), "tuic")
}

// fetchData retrieves structured blocking events from the configured API URL.
// Falls back gracefully if the endpoint is unreachable.
func (w *EvasionWatcher) fetchData(apiURL string) []model.EvasionEvent {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "AetherProxy/1.0 EvasionWatcher")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		logger.Warning("EvasionWatcher: fetch failed:", err)
		return nil
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		logger.Warning("EvasionWatcher: unexpected status:", resp.StatusCode)
		return nil
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBodyBytes))
	if err != nil {
		return nil
	}

	var payload struct {
		Events []struct {
			Protocol string `json:"protocol"`
			Port     int    `json:"port"`
			Domain   string `json:"domain"`
			Detail   string `json:"detail"`
		} `json:"events"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		logger.Warning("EvasionWatcher: parse failed:", err)
		return nil
	}

	events := make([]model.EvasionEvent, 0, len(payload.Events))
	for _, e := range payload.Events {
		events = append(events, model.EvasionEvent{
			Source:   apiURL,
			Protocol: e.Protocol,
			Port:     e.Port,
			Domain:   e.Domain,
			Detail:   e.Detail,
		})
	}
	return events
}

// ── Client Telemetry ──────────────────────────────────────────────────────────

// RecordTelemetry inserts a new ClientTelemetry row into the database.
func RecordTelemetry(t model.ClientTelemetry) error {
	return database.GetDB().Create(&t).Error
}

// TelemetryStats holds aggregated per-protocol health metrics.
type TelemetryStats struct {
	Protocol    string  `json:"protocol"`
	Total       int     `json:"total"`
	Successes   int     `json:"successes"`
	Failures    int     `json:"failures"`
	SuccessRate float64 `json:"successRate"`
	AvgLatency  float64 `json:"avgLatency"`
}

// GetTelemetryStats returns aggregated per-protocol success/failure rates over
// the last hour, useful for display on the dashboard.
func GetTelemetryStats() ([]TelemetryStats, error) {
	cutoff := time.Now().Add(-1 * time.Hour).Unix()
	db := database.GetDB()

	// Use a dialect-agnostic expression for the conditional sum.
	var stats []TelemetryStats
	err := db.Raw(`
		SELECT protocol,
		       COUNT(*) AS total,
		       SUM(CASE WHEN success = 1 OR success = true THEN 1 ELSE 0 END) AS successes,
		       SUM(CASE WHEN success = 0 OR success = false THEN 1 ELSE 0 END) AS failures,
		       AVG(latency_ms) AS avg_latency
		FROM client_telemetries
		WHERE date_time > ?
		GROUP BY protocol
		ORDER BY total DESC`, cutoff).Scan(&stats).Error
	if err != nil {
		return nil, err
	}
	for i := range stats {
		if stats[i].Total > 0 {
			stats[i].SuccessRate = float64(stats[i].Successes) / float64(stats[i].Total)
		}
	}
	return stats, nil
}

// evaluateTelemetry checks client-reported and synthetic telemetry from the
// last 5 minutes. If any protocol has ≥ minTelemetrySamples reports and its
// failure rate exceeds telemetryFailureThreshold it triggers a protocol switch.
func (w *EvasionWatcher) evaluateTelemetry() {
	const minTelemetrySamples = 5
	const telemetryFailureThreshold = 0.30

	cutoff := time.Now().Add(-5 * time.Minute).Unix()
	db := database.GetDB()

	type row struct {
		Protocol string
		Total    int
		Failures int
	}
	var rows []row
	err := db.Raw(`
		SELECT protocol,
		       COUNT(*) AS total,
		       SUM(CASE WHEN success = 0 OR success = false THEN 1 ELSE 0 END) AS failures
		FROM client_telemetries
		WHERE date_time > ?
		GROUP BY protocol`, cutoff).Scan(&rows).Error
	if err != nil {
		logger.Warning("EvasionWatcher: telemetry evaluation query failed:", err)
		return
	}

	current := GetEvasionPreferredProtocol()

	for _, r := range rows {
		if r.Total < minTelemetrySamples {
			continue
		}
		failRate := float64(r.Failures) / float64(r.Total)
		if failRate <= telemetryFailureThreshold {
			continue
		}
		next := nextEvasionProtocol(r.Protocol)
		if next == current {
			// Already at the right promotion level.
			continue
		}
		logger.Infof("EvasionWatcher: telemetry %.0f%% failure for %s (n=%d) – switching to %q",
			failRate*100, r.Protocol, r.Total, next)

		// Record an evasion event for this telemetry-driven switch.
		event := model.EvasionEvent{
			DateTime:   time.Now().Unix(),
			Source:     "client-telemetry",
			Protocol:   r.Protocol,
			Detail:     fmt.Sprintf("%.0f%% failure rate over last 5 minutes (n=%d)", failRate*100, r.Total),
			AutoAction: autoActionLabel(next),
		}
		if err := db.Create(&event).Error; err != nil {
			logger.Warning("EvasionWatcher: failed to save telemetry event:", err)
		}

		w.executeAutoAction(next)
		// Only change once per evaluation cycle.
		break
	}
}

// syntheticTest probes the local listen port of each TCP-based inbound to
// verify it is reachable. QUIC-based inbounds (hysteria2, tuic) are skipped
// because they use UDP and cannot be probed with a plain TCP dial.
// Results are recorded as ClientTelemetry rows with Source="synthetic".
func (w *EvasionWatcher) syntheticTest() {
	db := database.GetDB()
	var inbounds []model.Inbound
	if err := db.Find(&inbounds).Error; err != nil {
		logger.Warning("EvasionWatcher synthetic test: failed to fetch inbounds:", err)
		return
	}

	// UDP-based protocols cannot be tested with a TCP dial.
	quicTypes := map[string]bool{"hysteria2": true, "hysteria": true, "tuic": true}

	count := 0
	for _, inb := range inbounds {
		if quicTypes[inb.Type] {
			continue
		}
		if inb.Options == nil {
			continue
		}
		var opts map[string]interface{}
		if err := json.Unmarshal(inb.Options, &opts); err != nil {
			continue
		}
		portVal, ok := opts["listen_port"]
		if !ok {
			continue
		}
		var port int
		switch v := portVal.(type) {
		case float64:
			port = int(v)
		case int:
			port = v
		default:
			continue
		}
		if port <= 0 || port > 65535 {
			continue
		}

		start := time.Now()
		addr := fmt.Sprintf("127.0.0.1:%d", port)
		conn, dialErr := net.DialTimeout("tcp", addr, 3*time.Second)
		latency := int(time.Since(start).Milliseconds())
		success := dialErr == nil
		if conn != nil {
			_ = conn.Close()
		}

		telemetry := model.ClientTelemetry{
			DateTime:  time.Now().Unix(),
			Protocol:  inb.Type,
			Success:   success,
			LatencyMs: latency,
			Throttled: false,
			ClientIP:  "127.0.0.1",
			Source:    "synthetic",
		}
		if err := db.Create(&telemetry).Error; err != nil {
			logger.Warning("EvasionWatcher: failed to record synthetic telemetry:", err)
		}
		count++
	}
	if count > 0 {
		logger.Infof("EvasionWatcher: synthetic test completed for %d TCP inbound(s)", count)
	}
}

// GetRecentEvents returns the most recent evasion events.
func GetRecentEvasionEvents(limit int) ([]model.EvasionEvent, error) {
	db := database.GetDB()
	var events []model.EvasionEvent
	err := db.Order("date_time desc").Limit(limit).Find(&events).Error
	return events, err
}

// GetEvasionEventsSince returns evasion events with DateTime > sinceTS.
// Used by the WebSocket handler to stream new alerts to the admin panel in real time.
func GetEvasionEventsSince(sinceTS int64) ([]model.EvasionEvent, error) {
	db := database.GetDB()
	var events []model.EvasionEvent
	err := db.Where("date_time > ?", sinceTS).Order("date_time asc").Find(&events).Error
	return events, err
}

