package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

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
// Currently uses a simple JSON probe endpoint; replace/extend with real
// Javid Network Watch API when available.
func (w *EvasionWatcher) scrape() {
	logger.Info("EvasionWatcher: scraping censorship data")

	events := w.fetchJavidData()
	if len(events) == 0 {
		return
	}

	db := database.GetDB()
	for i := range events {
		events[i].DateTime = time.Now().Unix()
		// Determine auto-action
		if isRealityBlock(events[i]) {
			events[i].AutoAction = "promote_hysteria2"
			logger.Info("EvasionWatcher: Reality block detected – promoting Hysteria2")
		}
		if err := db.Create(&events[i]).Error; err != nil {
			logger.Warning("EvasionWatcher: failed to save event:", err)
		}
	}
}

// isRealityBlock returns true when the event suggests a Reality/VLESS block.
func isRealityBlock(e model.EvasionEvent) bool {
	return strings.Contains(strings.ToLower(e.Protocol), "reality") ||
		strings.Contains(strings.ToLower(e.Protocol), "vless")
}

// fetchJavidData attempts to retrieve structured blocking data.
// Falls back gracefully if the endpoint is unreachable.
func (w *EvasionWatcher) fetchJavidData() []model.EvasionEvent {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Use public endpoint when available; self-hosted endpoint otherwise.
	url := "https://javidnetworkwatch.com/api/events.json"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "AetherProxy/1.0 EvasionWatcher")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		logger.Warning("EvasionWatcher: fetch failed:", err)
		return nil
	}
	defer resp.Body.Close()

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
			Source:   "javidnetworkwatch.com",
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
