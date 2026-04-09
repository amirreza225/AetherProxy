// Package sample provides a reference implementation of the AetherProxy
// OutboundPlugin interface. It can be compiled as a standalone .so file and
// loaded at runtime via plugin.LoadPlugin, or registered statically with
// plugin.RegisterPlugin for testing/demonstration purposes.
//
// Build as a shared library (Linux only):
//
//	go build -buildmode=plugin -o sample_plugin.so ./backend/core/plugin/sample
//
// Load at runtime:
//
//	import "github.com/aetherproxy/backend/core/plugin"
//	plugin.LoadPlugin("/path/to/sample_plugin.so")
package sample

import (
	"encoding/json"

	parentplugin "github.com/aetherproxy/backend/core/plugin"
)

// Plugin is the exported symbol that AetherProxy's plugin loader looks for.
// The variable must be named exactly "Plugin" and satisfy plugin.OutboundPlugin.
var Plugin parentplugin.OutboundPlugin = &OutboundPluginImpl{enabled: true}

// SampleConfig holds configuration for the sample plugin.
type SampleConfig struct {
	// Suffix is appended to the outbound tag to make it identifiable.
	Suffix string `json:"suffix"`
}

// OutboundPluginImpl is the sample plugin implementation.
type OutboundPluginImpl struct {
	enabled bool
}

func (p *OutboundPluginImpl) Name() string {
	return "sample-passthrough"
}

func (p *OutboundPluginImpl) Description() string {
	return "Sample AetherProxy plugin – passes outbound JSON through unchanged (demo only)."
}

func (p *OutboundPluginImpl) DefaultConfig() json.RawMessage {
	cfg := SampleConfig{Suffix: "-aether"}
	b, _ := json.Marshal(cfg)
	return b
}

// Apply receives the outbound JSON (a single sing-box outbound object) and an
// optional plugin-specific config blob. This sample implementation appends
// a configurable suffix to the outbound "tag" field to demonstrate the
// transformation pipeline.
func (p *OutboundPluginImpl) Apply(outboundJSON json.RawMessage, cfgJSON json.RawMessage) (json.RawMessage, error) {
	if !p.enabled {
		return outboundJSON, nil
	}

	var cfg SampleConfig
	if err := json.Unmarshal(cfgJSON, &cfg); err != nil || cfg.Suffix == "" {
		return outboundJSON, nil
	}

	var obj map[string]interface{}
	if err := json.Unmarshal(outboundJSON, &obj); err != nil {
		return outboundJSON, nil
	}

	if tag, ok := obj["tag"].(string); ok {
		obj["tag"] = tag + cfg.Suffix
	}

	result, err := json.Marshal(obj)
	if err != nil {
		return outboundJSON, err
	}
	return result, nil
}

func (p *OutboundPluginImpl) Enabled() bool {
	return p.enabled
}

func (p *OutboundPluginImpl) SetEnabled(enabled bool) {
	p.enabled = enabled
}
