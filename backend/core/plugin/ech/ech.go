// Package ech is an AetherProxy outbound plugin that enables Encrypted Client
// Hello (ECH) on TLS outbounds.  ECH hides the true SNI from network observers
// by encrypting it inside a TLS extension, preventing SNI-based censorship.
//
// This plugin injects ECH configuration into the outbound's tls block.
// It requires sing-box to be built with ECH support (standard in v1.13+).
package ech

import (
	"encoding/json"

	parentplugin "github.com/aetherproxy/backend/core/plugin"
)

// Plugin is the exported symbol loaded by AetherProxy's plugin system.
var Plugin parentplugin.OutboundPlugin = &ECHPlugin{enabled: false}

// skipTypes are outbound types that do not use a TLS layer.
var skipTypes = map[string]bool{
	"direct": true,
	"block":  true,
	"dns":    true,
	"socks":  true,
}

// ECHConfig holds the plugin configuration.
type ECHConfig struct {
	// ECHPublicName is the outer (public) SNI advertised in the ClientHello before
	// ECH encryption takes effect.  Typically a CDN domain like "cloudflare.com".
	ECHPublicName string `json:"ech_public_name"`
	// DisableECH forces ECH off while keeping the plugin registered (useful for
	// testing without removing the plugin).
	DisableECH bool `json:"disable_ech"`
}

// ECHPlugin implements parentplugin.OutboundPlugin.
type ECHPlugin struct{ enabled bool }

func (p *ECHPlugin) Name() string { return "ech" }

func (p *ECHPlugin) Description() string {
	return "Enables Encrypted Client Hello (ECH) on TLS outbounds, hiding the real SNI from DPI/censors."
}

func (p *ECHPlugin) DefaultConfig() json.RawMessage {
	cfg := ECHConfig{
		ECHPublicName: "cloudflare.com",
		DisableECH:    false,
	}
	b, _ := json.Marshal(cfg)
	return b
}

func (p *ECHPlugin) Enabled() bool     { return p.enabled }
func (p *ECHPlugin) SetEnabled(v bool) { p.enabled = v }

// Apply injects ECH settings into the outbound's tls block.
func (p *ECHPlugin) Apply(outboundJSON json.RawMessage, cfgJSON json.RawMessage) (json.RawMessage, error) {
	if !p.enabled {
		return outboundJSON, nil
	}

	var cfg ECHConfig
	if err := json.Unmarshal(cfgJSON, &cfg); err != nil {
		return outboundJSON, nil
	}
	if cfg.DisableECH {
		return outboundJSON, nil
	}

	var obj map[string]interface{}
	if err := json.Unmarshal(outboundJSON, &obj); err != nil {
		return outboundJSON, err
	}

	// Skip types that have no TLS layer.
	if t, _ := obj["type"].(string); skipTypes[t] {
		return outboundJSON, nil
	}

	// Operate only on outbounds that already have a tls block.
	tlsRaw, hasTLS := obj["tls"]
	if !hasTLS {
		return outboundJSON, nil
	}

	tlsObj, ok := tlsRaw.(map[string]interface{})
	if !ok {
		return outboundJSON, nil
	}

	// Only apply ECH when TLS is actually enabled.
	if enabled, _ := tlsObj["enabled"].(bool); !enabled {
		return outboundJSON, nil
	}

	// Inject ECH.
	tlsObj["ech"] = map[string]interface{}{
		"enabled":                        true,
		"pq_signature_schemes_enabled":   true,
		"dynamic_record_sizing_disabled": false,
	}

	// Set the outer public name only when the outbound does not already specify
	// a server_name, to avoid overriding an explicit user configuration.
	if cfg.ECHPublicName != "" {
		if _, hasServerName := obj["server_name"]; !hasServerName {
			obj["server_name"] = cfg.ECHPublicName
		}
	}

	obj["tls"] = tlsObj

	result, err := json.Marshal(obj)
	if err != nil {
		return outboundJSON, err
	}
	return result, nil
}
