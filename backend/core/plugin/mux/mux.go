// Package mux is an AetherProxy outbound plugin that injects a sing-box
// multiplex (smux) transport block into outbounds.
//
// Multiplexing bundles many proxy sessions over a single connection and adds
// optional padding, making long-lived connection patterns indistinguishable
// from regular browsing traffic and reducing the per-connection setup overhead.
//
// Only one of mux or a transport plugin (h2disguise/wscdn/grpcobfs) should be
// enabled at a time; they both modify the outbound's transport-layer behaviour.
package mux

import (
	"encoding/json"

	parentplugin "github.com/aetherproxy/backend/core/plugin"
)

// Plugin is the exported symbol loaded by AetherProxy's plugin system.
var Plugin parentplugin.OutboundPlugin = &MuxPlugin{enabled: false}

// skipTypes are outbound types that do not benefit from TCP multiplexing.
var skipTypes = map[string]bool{
	"hysteria2": true,
	"hysteria":  true,
	"tuic":      true,
	"direct":    true,
	"block":     true,
	"dns":       true,
	"wireguard": true,
}

// MuxConfig holds the plugin configuration.
type MuxConfig struct {
	// Protocol selects the multiplexer: "smux" (default), "yamux", or "h2mux".
	Protocol string `json:"protocol"`
	// MaxConnections is the maximum number of underlying connections.
	// 0 means sing-box default (typically 4).
	MaxConnections int `json:"max_connections"`
	// MinStreams is the minimum number of streams per connection before opening
	// a new one.  0 = sing-box default.
	MinStreams int `json:"min_streams"`
	// MaxStreams is the maximum number of simultaneous streams per connection.
	// 0 = sing-box default.
	MaxStreams int `json:"max_streams"`
	// Padding enables random-length padding frames to defeat traffic analysis.
	Padding bool `json:"padding"`
	// BrutalEnabled enables TCP Brutal congestion control inside the mux.
	BrutalEnabled bool `json:"brutal_enabled"`
	// BrutalUpMbps is the upload speed for TCP Brutal (Mbps).
	BrutalUpMbps int `json:"brutal_up_mbps"`
	// BrutalDownMbps is the download speed for TCP Brutal (Mbps).
	BrutalDownMbps int `json:"brutal_down_mbps"`
}

// MuxPlugin implements parentplugin.OutboundPlugin.
type MuxPlugin struct{ enabled bool }

func (p *MuxPlugin) Name() string { return "mux" }

func (p *MuxPlugin) Description() string {
	return "Injects sing-box multiplex (smux/yamux/h2mux) transport with optional padding to defeat traffic-timing analysis."
}

func (p *MuxPlugin) DefaultConfig() json.RawMessage {
	cfg := MuxConfig{
		Protocol:       "smux",
		MaxConnections: 4,
		MinStreams:      4,
		MaxStreams:      0,
		Padding:        true,
		BrutalEnabled:  false,
		BrutalUpMbps:   100,
		BrutalDownMbps: 100,
	}
	b, _ := json.Marshal(cfg)
	return b
}

func (p *MuxPlugin) Enabled() bool     { return p.enabled }
func (p *MuxPlugin) SetEnabled(v bool) { p.enabled = v }

// Apply injects a multiplex block into the outbound JSON.
func (p *MuxPlugin) Apply(outboundJSON json.RawMessage, cfgJSON json.RawMessage) (json.RawMessage, error) {
	if !p.enabled {
		return outboundJSON, nil
	}

	var cfg MuxConfig
	if err := json.Unmarshal(cfgJSON, &cfg); err != nil {
		return outboundJSON, nil
	}
	if cfg.Protocol == "" {
		cfg.Protocol = "smux"
	}

	var obj map[string]interface{}
	if err := json.Unmarshal(outboundJSON, &obj); err != nil {
		return outboundJSON, err
	}

	// Skip QUIC/UDP-based and non-proxy types.
	if t, _ := obj["type"].(string); skipTypes[t] {
		return outboundJSON, nil
	}

	muxBlock := map[string]interface{}{
		"enabled":  true,
		"protocol": cfg.Protocol,
		"padding":  cfg.Padding,
	}
	if cfg.MaxConnections > 0 {
		muxBlock["max_connections"] = cfg.MaxConnections
	}
	if cfg.MinStreams > 0 {
		muxBlock["min_streams"] = cfg.MinStreams
	}
	if cfg.MaxStreams > 0 {
		muxBlock["max_streams"] = cfg.MaxStreams
	}
	if cfg.BrutalEnabled {
		muxBlock["brutal"] = map[string]interface{}{
			"enabled":   true,
			"up_mbps":   cfg.BrutalUpMbps,
			"down_mbps": cfg.BrutalDownMbps,
		}
	}

	obj["multiplex"] = muxBlock

	result, err := json.Marshal(obj)
	if err != nil {
		return outboundJSON, err
	}
	return result, nil
}
