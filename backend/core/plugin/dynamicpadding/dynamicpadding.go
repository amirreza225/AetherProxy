// Package dynamicpadding is an AetherProxy outbound plugin that injects
// sing-box multiplex padding and randomises HTTP-upgrade early-data sizes to
// defeat traffic-analysis attacks that rely on constant packet sizes.
//
// For supported outbound types the plugin:
//   - Enables multiplex with padding=true if a multiplex block is not already
//     present (idempotent: never overwrites an existing multiplex block).
//   - Sets a random min_early_data value on httpupgrade transports when the
//     field is currently 0 or absent.
//
// QUIC-based outbounds (hysteria2, tuic, hysteria) are skipped because they
// have their own built-in padding mechanisms and do not use TCP multiplex.
package dynamicpadding

import (
	"encoding/json"
	"math/rand"

	parentplugin "github.com/aetherproxy/backend/core/plugin"
)

// Plugin is the exported symbol loaded by AetherProxy's plugin system.
var Plugin parentplugin.OutboundPlugin = &DynamicPaddingPlugin{enabled: false}

// DynamicPaddingConfig holds the plugin configuration.
type DynamicPaddingConfig struct {
	// MinPadding is the minimum random early-data size injected on
	// httpupgrade transports (bytes).
	MinPadding int `json:"min_padding"`
	// MaxPadding is the maximum random early-data size (bytes).
	MaxPadding int `json:"max_padding"`
	// EnabledProtocols lists the outbound types that this plugin applies to.
	// Defaults to vmess, vless, trojan.
	EnabledProtocols []string `json:"enabled_protocols"`
}

var defaultEnabledProtocols = []string{"vmess", "vless", "trojan"}

// skipTypes are outbound types that must be left untouched.
var skipTypes = map[string]bool{
	"hysteria2": true,
	"hysteria":  true,
	"tuic":      true,
	"direct":    true,
	"block":     true,
	"dns":       true,
}

// DynamicPaddingPlugin implements parentplugin.OutboundPlugin.
type DynamicPaddingPlugin struct{ enabled bool }

func (p *DynamicPaddingPlugin) Name() string { return "dynamicpadding" }

func (p *DynamicPaddingPlugin) Description() string {
	return "Injects sing-box multiplex padding and randomises HTTP-upgrade early-data sizes to defeat traffic-analysis based on fixed packet lengths."
}

func (p *DynamicPaddingPlugin) DefaultConfig() json.RawMessage {
	cfg := DynamicPaddingConfig{
		MinPadding:       64,
		MaxPadding:       1024,
		EnabledProtocols: defaultEnabledProtocols,
	}
	b, _ := json.Marshal(cfg)
	return b
}

func (p *DynamicPaddingPlugin) Enabled() bool     { return p.enabled }
func (p *DynamicPaddingPlugin) SetEnabled(v bool) { p.enabled = v }

// Apply injects multiplex padding and/or randomises HTTP-upgrade early-data.
func (p *DynamicPaddingPlugin) Apply(outboundJSON json.RawMessage, cfgJSON json.RawMessage) (json.RawMessage, error) {
	if !p.enabled {
		return outboundJSON, nil
	}

	var cfg DynamicPaddingConfig
	if err := json.Unmarshal(cfgJSON, &cfg); err != nil {
		return outboundJSON, nil
	}

	if cfg.MinPadding <= 0 {
		cfg.MinPadding = 64
	}
	if cfg.MaxPadding <= cfg.MinPadding {
		cfg.MaxPadding = cfg.MinPadding + 960
	}

	enabledSet := make(map[string]bool)
	protocols := cfg.EnabledProtocols
	if len(protocols) == 0 {
		protocols = defaultEnabledProtocols
	}
	for _, proto := range protocols {
		enabledSet[proto] = true
	}

	var obj map[string]interface{}
	if err := json.Unmarshal(outboundJSON, &obj); err != nil {
		return outboundJSON, err
	}

	outType, _ := obj["type"].(string)
	if skipTypes[outType] || !enabledSet[outType] {
		return outboundJSON, nil
	}

	// ── Multiplex padding ─────────────────────────────────────────────────────

	if _, hasMux := obj["multiplex"]; !hasMux {
		obj["multiplex"] = map[string]interface{}{
			"enabled": true,
			"padding": true,
		}
	} else if mux, ok := obj["multiplex"].(map[string]interface{}); ok {
		// Only inject padding; leave other user-set fields intact.
		if _, hasPad := mux["padding"]; !hasPad {
			mux["padding"] = true
			obj["multiplex"] = mux
		}
	}

	// ── HTTP-upgrade early data ───────────────────────────────────────────────

	if transport, ok := obj["transport"].(map[string]interface{}); ok {
		if ttype, _ := transport["type"].(string); ttype == "httpupgrade" {
			if earlyData, _ := transport["min_early_data"].(float64); earlyData == 0 {
				randSize := cfg.MinPadding + rand.Intn(cfg.MaxPadding-cfg.MinPadding+1)
				transport["min_early_data"] = randSize
				obj["transport"] = transport
			}
		}
	}

	result, err := json.Marshal(obj)
	if err != nil {
		return outboundJSON, err
	}
	return result, nil
}
