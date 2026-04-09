package api

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aetherproxy/backend/config"
	"github.com/aetherproxy/backend/logger"
	"github.com/aetherproxy/backend/service"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/gin-gonic/gin"
)

type StatsWSHandler struct {
	service.StatsService
	service.ServerService
}

type liveStats struct {
	Onlines       interface{}       `json:"onlines"`
	Status        interface{}       `json:"status"`
	EvasionAlerts []evasionAlertDTO `json:"evasionAlerts,omitempty"`
}

type evasionAlertDTO struct {
	DateTime   int64  `json:"dateTime"`
	Source     string `json:"source"`
	Protocol   string `json:"protocol"`
	AutoAction string `json:"autoAction"`
	Detail     string `json:"detail"`
}

// RegisterWSRoutes adds the WebSocket endpoint to the given router group.
// The group should already be protected by JWT middleware.
func RegisterWSRoutes(g *gin.RouterGroup) {
	h := &StatsWSHandler{}
	g.GET("/ws/stats", h.ServeStats)
}

// ServeStats streams live stats every 2 seconds over a WebSocket connection.
// The client must supply a valid JWT via the Authorization header or aether_token cookie.
// Each message includes online counts, system status, and any new evasion alerts
// detected since the previous message (for real-time admin panel notifications).
func (h *StatsWSHandler) ServeStats(c *gin.Context) {
	if !IsLogin(c) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	conn, err := websocket.Accept(c.Writer, c.Request, &websocket.AcceptOptions{
		InsecureSkipVerify: false,
		OriginPatterns:     wsOriginPatterns(),
	})
	if err != nil {
		logger.Warning("ws/stats: accept error:", err)
		return
	}
	defer conn.CloseNow()

	ctx := conn.CloseRead(c.Request.Context())

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	// Track the last evasion event timestamp we have sent so we only push new ones.
	lastEvasionTS := time.Now().Unix()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			onlines, err := h.StatsService.GetOnlines()
			if err != nil {
				logger.Warning("ws/stats: GetOnlines:", err)
				continue
			}
			status := h.ServerService.GetStatus("")

			// Collect new evasion events since the last tick.
			newAlerts := getNewEvasionAlerts(lastEvasionTS)
			if len(newAlerts) > 0 {
				lastEvasionTS = time.Now().Unix()
			}

			payload := liveStats{
				Onlines:       onlines,
				Status:        status,
				EvasionAlerts: newAlerts,
			}

			raw, _ := json.Marshal(payload)
			if err := wsjson.Write(ctx, conn, json.RawMessage(raw)); err != nil {
				return
			}
		}
	}
}

func wsOriginPatterns() []string {
	adminOrigin := strings.TrimSpace(config.GetAdminOrigin())
	if adminOrigin == "" {
		return nil
	}

	patterns := make([]string, 0, 3)
	patterns = append(patterns, adminOrigin)

	if u, err := url.Parse(adminOrigin); err == nil && u.Host != "" {
		patterns = append(patterns, u.Host)
		if u.Scheme != "" {
			patterns = append(patterns, u.Scheme+"://"+u.Host)
		}
	}

	return patterns
}

// getNewEvasionAlerts returns evasion events stored after sinceTS.
func getNewEvasionAlerts(sinceTS int64) []evasionAlertDTO {
	events, err := service.GetEvasionEventsSince(sinceTS)
	if err != nil || len(events) == 0 {
		return nil
	}
	result := make([]evasionAlertDTO, 0, len(events))
	for _, e := range events {
		result = append(result, evasionAlertDTO{
			DateTime:   e.DateTime,
			Source:     e.Source,
			Protocol:   e.Protocol,
			AutoAction: e.AutoAction,
			Detail:     e.Detail,
		})
	}
	return result
}
