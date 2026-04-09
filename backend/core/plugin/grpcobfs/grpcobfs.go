// Package grpcobfs is an AetherProxy outbound plugin that disguises proxy
// traffic as gRPC calls to well-known Google or cloud API service names.
//
// DPI systems that attempt to identify illegal traffic often allowlist known
// gRPC service patterns.  By injecting a gRPC transport with a realistic
// service name (e.g. "google.maps.v1.RouteService"), proxy traffic blends in
// with legitimate gRPC API calls.
package grpcobfs

import (
	"encoding/json"

	parentplugin "github.com/aetherproxy/backend/core/plugin"
)

// Plugin is the exported symbol loaded by AetherProxy's plugin system.
var Plugin parentplugin.OutboundPlugin = &GRPCObfsPlugin{enabled: false}

// serviceNamePresets maps preset identifiers to realistic gRPC service names.
var serviceNamePresets = map[string]string{
	"google-maps": "google.maps.v1.RouteService",
	"google-api":  "google.apis.discovery.v1.DiscoveryService",
	"grpc-health": "grpc.health.v1.Health",
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

// GRPCObfsConfig holds the plugin configuration.
type GRPCObfsConfig struct {
	// ServiceNamePreset selects a built-in gRPC service name to mimic.
	// Valid values: "google-maps", "google-api", "grpc-health", "custom".
	// When "custom", CustomServiceName is used instead.
	ServiceNamePreset string `json:"service_name_preset"`
	// CustomServiceName is the gRPC service name used when ServiceNamePreset
	// is "custom" or when this field is non-empty (takes precedence).
	CustomServiceName string `json:"custom_service_name"`
	// FakeAuthority overrides the TLS SNI / gRPC :authority header.
	// Leave empty to keep the outbound's existing server_name.
	FakeAuthority string `json:"fake_authority"`
	// ForceApply overwrites an existing transport block if true.
	ForceApply bool `json:"force_apply"`
}

// GRPCObfsPlugin implements parentplugin.OutboundPlugin.
type GRPCObfsPlugin struct{ enabled bool }

func (p *GRPCObfsPlugin) Name() string { return "grpcobfs" }

func (p *GRPCObfsPlugin) Description() string {
	return "Disguises outbound as gRPC traffic mimicking real Google/Cloud API service names to defeat DPI."
}

func (p *GRPCObfsPlugin) DefaultConfig() json.RawMessage {
	cfg := GRPCObfsConfig{
		ServiceNamePreset: "google-api",
		CustomServiceName: "",
		FakeAuthority:     "",
		ForceApply:        false,
	}
	b, _ := json.Marshal(cfg)
	return b
}

func (p *GRPCObfsPlugin) Enabled() bool    { return p.enabled }
func (p *GRPCObfsPlugin) SetEnabled(v bool) { p.enabled = v }

// Apply injects a gRPC transport block into the outbound JSON.
func (p *GRPCObfsPlugin) Apply(outboundJSON json.RawMessage, cfgJSON json.RawMessage) (json.RawMessage, error) {
	if !p.enabled {
		return outboundJSON, nil
	}

	var cfg GRPCObfsConfig
	if err := json.Unmarshal(cfgJSON, &cfg); err != nil {
		return outboundJSON, nil
	}

	// Resolve service name: CustomServiceName always wins if set.
	serviceName := cfg.CustomServiceName
	if serviceName == "" {
		var ok bool
		serviceName, ok = serviceNamePresets[cfg.ServiceNamePreset]
		if !ok {
			serviceName = serviceNamePresets["google-api"]
		}
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

	obj["transport"] = map[string]interface{}{
		"type":         "grpc",
		"service_name": serviceName,
	}

	// Optionally override TLS SNI to look like the fake gRPC authority.
	if cfg.FakeAuthority != "" {
		if tlsObj, ok := obj["tls"].(map[string]interface{}); ok {
			tlsObj["server_name"] = cfg.FakeAuthority
			obj["tls"] = tlsObj
		}
	}

	result, err := json.Marshal(obj)
	if err != nil {
		return outboundJSON, err
	}
	return result, nil
}
