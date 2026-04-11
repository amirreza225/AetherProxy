package api

import (
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// checkLoginRateLimit enforces a per-IP rate limit for login attempts.
// It allows up to loginMaxAttempts within loginWindowDur before blocking.
// Blocked IPs are automatically unblocked after loginBlockDur.
// Returns true when the request is allowed, false (and writes a 429) when rejected.
const (
	loginMaxAttempts = 10
	loginWindowDur   = 5 * time.Minute
	loginBlockDur    = 15 * time.Minute
)

type loginEntry struct {
	count     int
	windowEnd time.Time
	blockedAt time.Time
	blocked   bool
}

var (
	loginLimiterMu sync.Mutex
	loginLimiter   = make(map[string]*loginEntry)
)

func checkLoginRateLimit(c *gin.Context) bool {
	ip := extractIP(c.ClientIP())

	loginLimiterMu.Lock()
	e, ok := loginLimiter[ip]
	if !ok {
		e = &loginEntry{}
		loginLimiter[ip] = e
	}

	now := time.Now()

	// Unblock after the block duration has expired.
	if e.blocked && now.After(e.blockedAt.Add(loginBlockDur)) {
		e.blocked = false
		e.count = 0
		e.windowEnd = now.Add(loginWindowDur)
	}

	if e.blocked {
		remaining := e.blockedAt.Add(loginBlockDur).Sub(now).Truncate(time.Second)
		msg := "too many login attempts, try again in " + remaining.String()
		loginLimiterMu.Unlock()
		c.JSON(http.StatusTooManyRequests, gin.H{"error": msg})
		return false
	}

	// Reset the window if it has expired.
	if now.After(e.windowEnd) {
		e.count = 0
		e.windowEnd = now.Add(loginWindowDur)
	}

	e.count++
	if e.count > loginMaxAttempts {
		e.blocked = true
		e.blockedAt = now
		loginLimiterMu.Unlock()
		c.JSON(http.StatusTooManyRequests, gin.H{
			"error": "too many login attempts, try again in " + loginBlockDur.String(),
		})
		return false
	}
	loginLimiterMu.Unlock()
	return true
}

// extractIP strips the port from a host:port string, returning only the IP.
func extractIP(addr string) string {
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}
