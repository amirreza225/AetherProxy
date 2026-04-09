//go:build plugin

// This file is the thin package main wrapper used only when building grpcobfs
// as a standalone .so plugin for dynamic loading via plugin.LoadPlugin.
// For normal AetherProxy builds the plugin is registered statically in app/app.go.
package main

import (
	parentplugin "github.com/aetherproxy/backend/core/plugin"
	"github.com/aetherproxy/backend/core/plugin/grpcobfs"
)

// Plugin is the exported symbol required by AetherProxy's dynamic plugin loader.
var Plugin parentplugin.OutboundPlugin = grpcobfs.Plugin
