package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
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

// Start launches the background scraper loop (10-minute interval).
func (w *EvasionWatcher) Start() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.isRunning {
		return
	}
	w.isRunning = true
	w.stopCh = make(chan struct{})
	go w.loop()
	logger.Info("EvasionWatcher started")
}

// Stop shuts down the scraper goroutine.
func (w *EvasionWatcher) Stop() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.isRunning {
		return
	}
	close(w.stopCh)
	w.isRunning = false
}

func (w *EvasionWatcher) loop() {
	// Scrape immediately on startup, then every 10 minutes.
	w.scrape()
	ticker := time.NewTicker(10 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-w.stopCh:
			return
		case <-ticker.C:
			w.scrape()
		}
	}
}

const (
	// maxResponseBodyBytes caps the response body read from external scraper endpoints.
	maxResponseBodyBytes = 1 << 20 // 1 MB
)

func (w *EvasionWatcher) scrape() {
	apiURL := config.GetEvasionAPIURL()
	if apiURL == "" {
		// No source configured; skip silently.
		return
	}

	logger.Info("EvasionWatcher: scraping censorship data from", apiURL)

	events := w.fetchData(apiURL)
	if len(events) == 0 {
		return
	}

	db := database.GetDB()
	for i := range events {
		events[i].DateTime = time.Now().Unix()
		// Determine auto-action
		if isRealityBlock(events[i]) {
			events[i].AutoAction = "promote_hysteria2"
			logger.Warning("EvasionWatcher: Reality/VLESS block detected – promoting Hysteria2 in subscription order")
			// Execute the auto-action: persist preferred protocol so that
			// subscription generators order links accordingly.
			w.executeAutoAction("hysteria2")
		}
		if err := db.Create(&events[i]).Error; err != nil {
			logger.Warning("EvasionWatcher: failed to save event:", err)
		}
	}
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
// action is the protocol name to boost (e.g. "hysteria2").
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
	logger.Infof("EvasionWatcher: preferred protocol set to %q – clients will receive updated subscription on next fetch", preferredProtocol)
	// Bump LastUpdate so subscribed clients know to re-fetch.
	LastUpdate = ts
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
	if err != nil || time.Since(time.Unix(ts, 0)) > evasionPreferenceTTL {
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
	return strings.Contains(strings.ToLower(e.Protocol), "reality") ||
		strings.Contains(strings.ToLower(e.Protocol), "vless")
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

