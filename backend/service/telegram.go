package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/aetherproxy/backend/config"
	"github.com/aetherproxy/backend/logger"
)

// TelegramNotifier sends out-of-band evasion alerts and subscription update
// notifications to a configured Telegram channel.  It uses the Telegram Bot
// HTTP API directly so no extra dependency is required.
type TelegramNotifier struct {
	mu        sync.Mutex
	lastNotify map[string]time.Time // rate-limit guard: topic → last sent time
}

var (
	telegramNotifierOnce sync.Once
	globalTelegramNotifier *TelegramNotifier
)

// GetTelegramNotifier returns the singleton TelegramNotifier.
func GetTelegramNotifier() *TelegramNotifier {
	telegramNotifierOnce.Do(func() {
		globalTelegramNotifier = &TelegramNotifier{
			lastNotify: make(map[string]time.Time),
		}
	})
	return globalTelegramNotifier
}

// configured reports whether a bot token and channel ID are set.
func (n *TelegramNotifier) configured() bool {
	return config.GetTelegramBotToken() != "" && config.GetTelegramChannelID() != ""
}

// rateLimited returns true and skips sending if the same topic was sent within
// the last 10 minutes (prevents spam during rapid protocol cycling).
func (n *TelegramNotifier) rateLimited(topic string) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	if last, ok := n.lastNotify[topic]; ok && time.Since(last) < 10*time.Minute {
		return true
	}
	n.lastNotify[topic] = time.Now()
	return false
}

// sendMessage posts a plain-text message to the configured Telegram chat.
func (n *TelegramNotifier) sendMessage(text string) {
	if !n.configured() {
		return
	}
	token := config.GetTelegramBotToken()
	chatID := config.GetTelegramChannelID()
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", token)

	payload := map[string]interface{}{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return
	}

	ctx := &http.Client{Timeout: 10 * time.Second}
	resp, err := ctx.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		logger.Warning("TelegramNotifier: sendMessage failed:", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		logger.Warningf("TelegramNotifier: sendMessage got HTTP %d", resp.StatusCode)
	}
}

// NotifyEvasionSwitch notifies the Telegram channel when the EvasionWatcher
// switches the preferred proxy protocol.  newProto is the newly promoted
// protocol, or "" if the preference was cleared (reverting to defaults).
func (n *TelegramNotifier) NotifyEvasionSwitch(newProto string) {
	if !n.configured() {
		return
	}
	topic := "evasion-switch:" + newProto
	if n.rateLimited(topic) {
		return
	}

	var msg string
	if newProto == "" {
		msg = "🟢 <b>AetherProxy</b>: Evasion preference cleared – subscriptions have reverted to default protocol ordering."
	} else {
		msg = fmt.Sprintf("🔴 <b>AetherProxy</b>: Censorship event detected.\n\n"+
			"Subscription links have been re-ordered to prioritise <b>%s</b>.\n\n"+
			"Clients will receive the updated order on their next subscription fetch.",
			newProto)
	}

	go n.sendMessage(msg)
}

// BroadcastSubscriptionUpdate notifies the Telegram channel that subscription
// content has been updated for the given client names.
func (n *TelegramNotifier) BroadcastSubscriptionUpdate(clientNames []string) {
	if !n.configured() || len(clientNames) == 0 {
		return
	}
	if n.rateLimited("sub-update") {
		return
	}

	msg := fmt.Sprintf("🔄 <b>AetherProxy</b>: Subscription updated for %d client(s).\n"+
		"Clients should refresh their subscriptions to receive the latest configuration.",
		len(clientNames))
	go n.sendMessage(msg)
}
