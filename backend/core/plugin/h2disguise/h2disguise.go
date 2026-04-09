// Package h2disguise is an AetherProxy outbound plugin that disguises proxy
// traffic as regular HTTP/2 browser traffic.  It injects a sing-box HTTP
// transport block with realistic browser headers, making the connection
// indistinguishable from normal HTTPS/H2 browsing to DPI systems.
package h2disguise

import (
	"encoding/json"

	parentplugin "github.com/aetherproxy/backend/core/plugin"
)

// Plugin is the exported symbol loaded by AetherProxy's plugin system.
var Plugin parentplugin.OutboundPlugin = &H2DisguisePlugin{enabled: false}

// userAgents maps preset names to realistic browser UA strings.
var userAgents = map[string]string{
	"chrome":  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
	"firefox": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
	"safari":  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
}

// skipTypes are outbound types that do not support TCP-layer transports.
var skipTypes = map[string]bool{
	"hysteria2": true,
	"hysteria":  true,
	"tuic":      true,
	"direct":    true,
	"block":     true,
	"dns":       true,
}

// H2DisguiseConfig holds the plugin configuration.
type H2DisguiseConfig struct {
	// FakeHost is sent as the HTTP/2 :authority and TLS SNI.
	// Example: "www.googleapis.com"
	FakeHost string `json:"fake_host"`
	// UserAgentPreset selects the browser UA string: "chrome", "firefox", or "safari".
	UserAgentPreset string `json:"user_agent_preset"`
	// ExtraHeaders are merged into the HTTP/2 request headers.
	ExtraHeaders map[string]string `json:"extra_headers"`
	// ForceApply overwrites an existing transport block if true.
	// Leave false to avoid clobbering manually configured transports.
	ForceApply bool `json:"force_apply"`
}

// H2DisguisePlugin implements parentplugin.OutboundPlugin.
type H2DisguisePlugin struct{ enabled bool }

func (p *H2DisguisePlugin) Name() string { return "h2disguise" }

func (p *H2DisguisePlugin) Description() string {
	return "Transforms outbound transport to HTTP/2 with browser-realistic headers to defeat DPI."
}

func (p *H2DisguisePlugin) DefaultConfig() json.RawMessage {
	cfg := H2DisguiseConfig{
		FakeHost:        "www.googleapis.com",
		UserAgentPreset: "chrome",
		ForceApply:      false,
	}
	b, _ := json.Marshal(cfg)
	return b
}

func (p *H2DisguisePlugin) Enabled() bool          { return p.enabled }
func (p *H2DisguisePlugin) SetEnabled(v bool)       { p.enabled = v }

// Apply injects an HTTP/2 transport block into the outbound JSON.
func (p *H2DisguisePlugin) Apply(outboundJSON json.RawMessage, cfgJSON json.RawMessage) (json.RawMessage, error) {
	if !p.enabled {
		return outboundJSON, nil
	}

	var cfg H2DisguiseConfig
	if err := json.Unmarshal(cfgJSON, &cfg); err != nil {
		return outboundJSON, nil
	}
	if cfg.FakeHost == "" {
		cfg.FakeHost = "www.googleapis.com"
	}
	if cfg.UserAgentPreset == "" {
		cfg.UserAgentPreset = "chrome"
	}

	var obj map[string]interface{}
	if err := json.Unmarshal(outboundJSON, &obj); err != nil {
		return outboundJSON, err
	}

	// Skip QUIC-based and non-proxy types.
	if t, _ := obj["type"].(string); skipTypes[t] {
		return outboundJSON, nil
	}

	// Idempotency: don't overwrite an existing transport unless ForceApply is set.
	if _, hasTransport := obj["transport"]; hasTransport && !cfg.ForceApply {
		return outboundJSON, nil
	}

	// Build the headers map.
	ua, ok := userAgents[cfg.UserAgentPreset]
	if !ok {
		ua = userAgents["chrome"]
	}
	headers := map[string]interface{}{
		"User-Agent": ua,
	}
	for k, v := range cfg.ExtraHeaders {
		headers[k] = v
	}

	obj["transport"] = map[string]interface{}{
		"type":    "http",
		"host":    []string{cfg.FakeHost},
		"headers": headers,
	}

	// Patch TLS SNI to match the fake host.
	if tlsObj, ok := obj["tls"].(map[string]interface{}); ok {
		tlsObj["server_name"] = cfg.FakeHost
		obj["tls"] = tlsObj
	}

	result, err := json.Marshal(obj)
	if err != nil {
		return outboundJSON, err
	}
	return result, nil
}
