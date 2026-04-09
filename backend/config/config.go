package config

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// BootstrapManifestPubKey is the Ed25519 public key (32 bytes, base64-encoded)
// used to verify signed bootstrap manifests.
// When empty (the default), manifest signature verification is skipped.
// Set AETHER_GOSSIP_MANIFEST_PUBKEY in production to enforce verification.
const BootstrapManifestPubKey = ""

//go:embed version
var version string

//go:embed name
var name string

type LogLevel string

const (
	Debug LogLevel = "debug"
	Info  LogLevel = "info"
	Warn  LogLevel = "warn"
	Error LogLevel = "error"
)

func GetVersion() string {
	return strings.TrimSpace(version)
}

func GetName() string {
	return strings.TrimSpace(name)
}

func GetLogLevel() LogLevel {
	if IsDebug() {
		return Debug
	}
	logLevel := os.Getenv("AETHER_LOG_LEVEL")
	if logLevel == "" {
		return Info
	}
	return LogLevel(logLevel)
}

func IsDebug() bool {
	return os.Getenv("AETHER_DEBUG") == "true"
}

func GetDBFolderPath() string {
	dbFolderPath := os.Getenv("AETHER_DB_FOLDER")
	if dbFolderPath == "" {
		dir, err := filepath.Abs(filepath.Dir(os.Args[0]))
		if err != nil {
			if runtime.GOOS == "windows" {
				return "C:\\ProgramData\\aetherproxy\\db"
			}
			return "/usr/local/aetherproxy/db"
		}
		dbFolderPath = filepath.Join(dir, "db")
	}
	return dbFolderPath
}

func GetDBPath() string {
	return fmt.Sprintf("%s/%s.db", GetDBFolderPath(), GetName())
}

// GetJWTSecret returns the JWT signing secret from the environment.
// Falls back to a static default only in debug mode – production must set AETHER_JWT_SECRET.
func GetJWTSecret() string {
	s := os.Getenv("AETHER_JWT_SECRET")
	if s == "" {
		return "change-me-in-production"
	}
	return s
}

// GetAdminOrigin returns the allowed CORS origin for the admin panel.
func GetAdminOrigin() string {
	o := os.Getenv("AETHER_ADMIN_ORIGIN")
	if o == "" {
		return "http://localhost:3000"
	}
	return o
}

// GetPort returns the TCP port the API server listens on.
func GetPort() string {
	p := os.Getenv("AETHER_PORT")
	if p == "" {
		return "2095"
	}
	return p
}

// GetSubPort returns the TCP port the subscription server listens on.
func GetSubPort() string {
	p := os.Getenv("AETHER_SUB_PORT")
	if p == "" {
		return "2096"
	}
	return p
}

// GetDBDSN returns the full database DSN from AETHER_DB_DSN.
// When set and starts with "postgres://" or "host=", a PostgreSQL driver is used.
// When set to a file path, SQLite is used with that path.
// When empty, the legacy AETHER_DB_FOLDER-derived path is used.
func GetDBDSN() string {
	return os.Getenv("AETHER_DB_DSN")
}

// GetPluginsDir returns the directory scanned for .so outbound plugin files at startup.
// Defaults to a "plugins/" directory next to the binary.
func GetPluginsDir() string {
	d := os.Getenv("AETHER_PLUGINS_DIR")
	if d != "" {
		return d
	}
	dir, err := filepath.Abs(filepath.Dir(os.Args[0]))
	if err != nil {
		return "plugins"
	}
	return filepath.Join(dir, "plugins")
}

// GetGossipPort returns the UDP port for the memberlist gossip protocol.
// Defaults to 7946 (memberlist default).
func GetGossipPort() int {
	p := os.Getenv("AETHER_GOSSIP_PORT")
	if p == "" {
		return 7946
	}
	var port int
	fmt.Sscanf(p, "%d", &port)
	if port <= 0 {
		return 7946
	}
	return port
}

// GetGossipBootstrap returns extra bootstrap peer addresses (host:port) from
// AETHER_GOSSIP_BOOTSTRAP (comma-separated).
func GetGossipBootstrap() []string {
	raw := os.Getenv("AETHER_GOSSIP_BOOTSTRAP")
	if raw == "" {
		return nil
	}
	var out []string
	for _, s := range strings.Split(raw, ",") {
		s = strings.TrimSpace(s)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}

// GetGossipManifestURL returns the URL of the signed bootstrap-node manifest.
// Defaults to an empty string (disabled).
func GetGossipManifestURL() string {
	return os.Getenv("AETHER_GOSSIP_MANIFEST_URL")
}

// GetGossipManifestPubKey returns the base64-encoded Ed25519 public key used
// to verify signed bootstrap manifests. Falls back to BootstrapManifestPubKey.
// When empty, manifest signature verification is skipped.
func GetGossipManifestPubKey() string {
	if k := os.Getenv("AETHER_GOSSIP_MANIFEST_PUBKEY"); k != "" {
		return k
	}
	return BootstrapManifestPubKey
}
