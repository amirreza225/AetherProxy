// Package wscdn is an AetherProxy outbound plugin that routes proxy traffic
// through a Cloudflare Workers CDN relay using a WebSocket transport.
//
// The plugin rewrites the outbound's server to the configured CDN hostname and
// injects a WS transport block.  The Cloudflare Worker at that hostname relays
// the WebSocket connection to the actual origin proxy server, making the traffic
// appear as ordinary WebSocket traffic to a Cloudflare edge node — similar to
// the meek transport used in Tor but integrated natively with sing-box.
//
// Deploy the companion relay worker from deploy/cloudflare-worker/ to your
// Cloudflare account before enabling this plugin.
package wscdn

import (
	"encoding/json"

	parentplugin "github.com/aetherproxy/backend/core/plugin"
)

// Plugin is the exported symbol loaded by AetherProxy's plugin system.
var Plugin parentplugin.OutboundPlugin = &WSCDNPlugin{enabled: false}

// skipTypes are outbound types that do not support TCP-layer transports.
var skipTypes = map[string]bool{
	"hysteria2": true,
	"hysteria":  true,
	"tuic":      true,
	"direct":    true,
	"block":     true,
	"dns":       true,
}

// WSCDNConfig holds the plugin configuration.
type WSCDNConfig struct {
	// CDNHost is the Cloudflare Workers hostname that relays the connection.
	// Example: "relay.example.workers.dev"
	CDNHost string `json:"cdn_host"`
	// WSPath is the WebSocket upgrade path on the CDN worker.
	// Example: "/ws"
	WSPath string `json:"ws_path"`
	// EarlyDataMax enables WebSocket 0-RTT early data up to this many bytes.
	// Set to 0 to disable (default).
	EarlyDataMax int `json:"early_data_max"`
	// ForceApply overwrites an existing transport block if true.
	ForceApply bool `json:"force_apply"`
}

// WSCDNPlugin implements parentplugin.OutboundPlugin.
type WSCDNPlugin struct{ enabled bool }

func (p *WSCDNPlugin) Name() string { return "wscdn" }

func (p *WSCDNPlugin) Description() string {
	return "Routes outbound over WebSocket through a Cloudflare CDN relay (meek-style). Requires the companion CF Worker from deploy/cloudflare-worker/."
}

func (p *WSCDNPlugin) DefaultConfig() json.RawMessage {
	cfg := WSCDNConfig{
		CDNHost:      "",
		WSPath:       "/ws",
		EarlyDataMax: 0,
		ForceApply:   false,
	}
	b, _ := json.Marshal(cfg)
	return b
}

func (p *WSCDNPlugin) Enabled() bool    { return p.enabled }
func (p *WSCDNPlugin) SetEnabled(v bool) { p.enabled = v }

// Apply rewrites the outbound to dial the CDN host over WebSocket.
//
// The stored DB record retains the original origin server address; this plugin
// overwrites obj["server"] at runtime only so the sing-box instance dials the
// CDN edge.  The admin UI will therefore show the original origin address.
func (p *WSCDNPlugin) Apply(outboundJSON json.RawMessage, cfgJSON json.RawMessage) (json.RawMessage, error) {
	if !p.enabled {
		return outboundJSON, nil
	}

	var cfg WSCDNConfig
	if err := json.Unmarshal(cfgJSON, &cfg); err != nil {
		return outboundJSON, nil
	}
	// CDNHost must be configured; otherwise there is nothing to relay through.
	if cfg.CDNHost == "" {
		return outboundJSON, nil
	}
	if cfg.WSPath == "" {
		cfg.WSPath = "/ws"
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

	// Build WS transport.
	wsTransport := map[string]interface{}{
		"type": "ws",
		"path": cfg.WSPath,
		"headers": map[string]interface{}{
			"Host": cfg.CDNHost,
		},
	}
	if cfg.EarlyDataMax > 0 {
		wsTransport["max_early_data"] = cfg.EarlyDataMax
		wsTransport["early_data_header_name"] = "Sec-WebSocket-Protocol"
	}
	obj["transport"] = wsTransport

	// Rewrite server so sing-box dials the CDN edge instead of the origin.
	obj["server"] = cfg.CDNHost

	// Patch TLS SNI to match the CDN hostname.
	if tlsObj, ok := obj["tls"].(map[string]interface{}); ok {
		tlsObj["server_name"] = cfg.CDNHost
		obj["tls"] = tlsObj
	}

	result, err := json.Marshal(obj)
	if err != nil {
		return outboundJSON, err
	}
	return result, nil
}
