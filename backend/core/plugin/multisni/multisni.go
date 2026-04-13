// Package multisni is an AetherProxy outbound plugin that rotates the
// TLS server_name (SNI) and Reality short_id on each config application,
// choosing randomly from operator-configured pools.
//
// This defeats statistical fingerprinting that looks for a single static SNI
// on a Reality-based proxy and makes the traffic pattern harder to distinguish
// from legitimate HTTPS traffic to the impersonated domains.
//
// Only applies to outbounds whose TLS block has reality.enabled == true.
// Harmlessly skips all other outbound types.
package multisni

import (
	"encoding/json"
	"math/rand"

	parentplugin "github.com/aetherproxy/backend/core/plugin"
)

// Plugin is the exported symbol loaded by AetherProxy's plugin system.
var Plugin parentplugin.OutboundPlugin = &MultiSNIPlugin{enabled: false}

// MultiSNIConfig holds the plugin configuration.
type MultiSNIConfig struct {
	// SNIPool is the set of domains to rotate through as server_name / SNI.
	// Defaults to a curated set of high-traffic CDN and cloud domains.
	SNIPool []string `json:"sni_pool"`
	// ShortIDPool is the set of Reality short_id values to rotate through.
	// Each entry must be a hex string (0-9, a-f).
	// Leave empty to leave the existing short_id unchanged.
	ShortIDPool []string `json:"short_id_pool"`
}

var defaultSNIPool = []string{
	"www.apple.com",
	"www.microsoft.com",
	"www.cloudflare.com",
	"www.amazon.com",
	"www.google.com",
	"www.icloud.com",
	"cdn.jsdelivr.net",
	"ajax.googleapis.com",
}

// MultiSNIPlugin implements parentplugin.OutboundPlugin.
type MultiSNIPlugin struct{ enabled bool }

func (p *MultiSNIPlugin) Name() string { return "multisni" }

func (p *MultiSNIPlugin) Description() string {
	return "Rotates the Reality TLS SNI and short_id on each config reload, choosing randomly from configurable pools to defeat static-SNI fingerprinting."
}

func (p *MultiSNIPlugin) DefaultConfig() json.RawMessage {
	cfg := MultiSNIConfig{
		SNIPool:     defaultSNIPool,
		ShortIDPool: []string{},
	}
	b, _ := json.Marshal(cfg)
	return b
}

func (p *MultiSNIPlugin) Enabled() bool     { return p.enabled }
func (p *MultiSNIPlugin) SetEnabled(v bool) { p.enabled = v }

// Apply rotates the server_name and reality.short_id in the outbound's TLS
// block. Skips non-Reality outbounds and outbounds without a TLS block.
func (p *MultiSNIPlugin) Apply(outboundJSON json.RawMessage, cfgJSON json.RawMessage) (json.RawMessage, error) {
	if !p.enabled {
		return outboundJSON, nil
	}

	var cfg MultiSNIConfig
	if err := json.Unmarshal(cfgJSON, &cfg); err != nil {
		return outboundJSON, nil
	}

	pool := cfg.SNIPool
	if len(pool) == 0 {
		pool = defaultSNIPool
	}

	var obj map[string]interface{}
	if err := json.Unmarshal(outboundJSON, &obj); err != nil {
		return outboundJSON, err
	}

	tlsRaw, hasTLS := obj["tls"]
	if !hasTLS {
		return outboundJSON, nil
	}

	tls, ok := tlsRaw.(map[string]interface{})
	if !ok {
		return outboundJSON, nil
	}

	// Only apply to Reality-enabled outbounds.
	reality, hasReality := tls["reality"].(map[string]interface{})
	if !hasReality {
		return outboundJSON, nil
	}
	realityEnabled, _ := reality["enabled"].(bool)
	if !realityEnabled {
		return outboundJSON, nil
	}

	// Rotate server_name.
	tls["server_name"] = pool[rand.Intn(len(pool))]

	// Rotate short_id if a pool is configured.
	if len(cfg.ShortIDPool) > 0 {
		reality["short_id"] = cfg.ShortIDPool[rand.Intn(len(cfg.ShortIDPool))]
		tls["reality"] = reality
	}

	obj["tls"] = tls

	result, err := json.Marshal(obj)
	if err != nil {
		return outboundJSON, err
	}
	return result, nil
}
