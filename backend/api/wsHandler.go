package api

import (
	"encoding/json"
	"net/http"
	"time"

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
	Onlines interface{} `json:"onlines"`
	Status  interface{} `json:"status"`
}

// RegisterWSRoutes adds the WebSocket endpoint to the given router group.
// The group should already be protected by JWT middleware.
func RegisterWSRoutes(g *gin.RouterGroup) {
	h := &StatsWSHandler{}
	g.GET("/ws/stats", h.ServeStats)
}

// ServeStats streams live stats every 2 seconds over a WebSocket connection.
// The client must supply a valid JWT via the Authorization header or aether_token cookie.
func (h *StatsWSHandler) ServeStats(c *gin.Context) {
	if !IsLogin(c) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	conn, err := websocket.Accept(c.Writer, c.Request, &websocket.AcceptOptions{
		InsecureSkipVerify: false,
	})
	if err != nil {
		logger.Warning("ws/stats: accept error:", err)
		return
	}
	defer conn.CloseNow()

	ctx := conn.CloseRead(c.Request.Context())

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

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

			payload := liveStats{
				Onlines: onlines,
				Status:  status,
			}

			raw, _ := json.Marshal(payload)
			if err := wsjson.Write(ctx, conn, json.RawMessage(raw)); err != nil {
				return
			}
		}
	}
}
