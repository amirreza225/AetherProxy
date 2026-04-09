// Package plugin defines the AetherProxy outbound plugin interface.
// Plugins can be compiled as Go shared objects (.so) and loaded at runtime
// via plugin.Open, or registered statically via RegisterPlugin.
package plugin

import (
	"encoding/json"
	"fmt"
	"plugin"
	"sync"
)

// OutboundPlugin is the interface every AetherProxy outbound plugin must implement.
type OutboundPlugin interface {
	// Name returns the unique plugin identifier (e.g. "my-obfs-plugin").
	Name() string
	// Description returns a human-readable description shown in the admin panel.
	Description() string
	// DefaultConfig returns the default JSON configuration for the plugin.
	DefaultConfig() json.RawMessage
	// Apply modifies or wraps the provided sing-box outbound JSON and returns
	// the modified version.
	Apply(outboundJSON json.RawMessage, cfg json.RawMessage) (json.RawMessage, error)
	// Enabled reports whether the plugin is currently active.
	Enabled() bool
	// SetEnabled toggles the plugin on or off.
	SetEnabled(enabled bool)
}

// PluginInfo holds metadata about a registered plugin.
type PluginInfo struct {
	Plugin  OutboundPlugin
	Config  json.RawMessage
}

var (
	mu      sync.RWMutex
	plugins = make(map[string]*PluginInfo)
)

// RegisterPlugin registers a plugin under its Name().
// Panics if two plugins share the same name.
func RegisterPlugin(p OutboundPlugin) {
	mu.Lock()
	defer mu.Unlock()
	name := p.Name()
	if _, exists := plugins[name]; exists {
		panic(fmt.Sprintf("plugin %q already registered; ensure plugin names are unique across all loaded .so files", name))
	}
	plugins[name] = &PluginInfo{Plugin: p, Config: p.DefaultConfig()}
}

// LoadPlugin opens a compiled .so file and registers the plugin it exports.
// The .so must export a symbol named "Plugin" that satisfies OutboundPlugin.
func LoadPlugin(path string) error {
	p, err := plugin.Open(path)
	if err != nil {
		return fmt.Errorf("open plugin %s: %w", path, err)
	}
	sym, err := p.Lookup("Plugin")
	if err != nil {
		return fmt.Errorf("plugin %s missing 'Plugin' symbol: %w", path, err)
	}
	op, ok := sym.(OutboundPlugin)
	if !ok {
		return fmt.Errorf("plugin %s 'Plugin' symbol does not implement OutboundPlugin", path)
	}
	RegisterPlugin(op)
	return nil
}

// List returns a copy of all registered plugins.
func List() []*PluginInfo {
	mu.RLock()
	defer mu.RUnlock()
	result := make([]*PluginInfo, 0, len(plugins))
	for _, info := range plugins {
		result = append(result, info)
	}
	return result
}

// Get returns the PluginInfo for the given name, or nil if not found.
func Get(name string) *PluginInfo {
	mu.RLock()
	defer mu.RUnlock()
	return plugins[name]
}

// SetConfig updates the JSON configuration for the named plugin.
func SetConfig(name string, cfg json.RawMessage) error {
	mu.Lock()
	defer mu.Unlock()
	info, ok := plugins[name]
	if !ok {
		return fmt.Errorf("plugin %q not found", name)
	}
	info.Config = cfg
	return nil
}

// ApplyAll runs all enabled plugins on the given outbound JSON in registration order.
func ApplyAll(outboundJSON json.RawMessage) (json.RawMessage, error) {
	mu.RLock()
	defer mu.RUnlock()
	result := outboundJSON
	for _, info := range plugins {
		if !info.Plugin.Enabled() {
			continue
		}
		var err error
		result, err = info.Plugin.Apply(result, info.Config)
		if err != nil {
			return nil, fmt.Errorf("plugin %q: %w", info.Plugin.Name(), err)
		}
	}
	return result, nil
}
