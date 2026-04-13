package service

import (
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/aetherproxy/backend/config"
)

// CertService handles TLS certificate provisioning.
// It supports two flows:
//   - Let's Encrypt (HTTP-01 ACME challenge, requires port 80 reachable)
//   - Paste PEM content directly (e.g. Cloudflare Origin Certificates)
type CertService struct{}

// certsDir returns the directory where managed certificates are stored.
func certsDir() string {
	return filepath.Join(config.GetDBFolderPath(), "certs")
}

// caddyCertPaths returns the certificate and key paths that Caddy stores for a
// domain inside the volume mounted at /caddy-certs. Returns empty strings if
// no Caddy-managed cert is found for the domain.
func caddyCertPaths(domain string) (certPath, keyPath string) {
	base := filepath.Join("/caddy-certs", "caddy", "certificates",
		"acme-v02.api.letsencrypt.org-directory", domain)
	c := filepath.Join(base, domain+".crt")
	k := filepath.Join(base, domain+".key")
	if _, err := os.Stat(c); err != nil {
		return "", ""
	}
	if _, err := os.Stat(k); err != nil {
		return "", ""
	}
	return c, k
}

// IssueLetsEncrypt returns a valid certificate and key for domain.
//
// Priority order:
//  1. Caddy-managed cert (mounted at /caddy-certs) — reused when Caddy already
//     owns the domain, avoiding an ACME conflict where Caddy intercepts the
//     HTTP-01 challenge before it reaches the backend.
//  2. Backend-owned ACME cert — obtained via the HTTP-01 challenge served by
//     the backend web server and forwarded by Caddy for domains Caddy does not
//     already manage.
//
// email is accepted for API compatibility but is unused.
func (s *CertService) IssueLetsEncrypt(domain, _ string) (certPath, keyPath string, err error) {
	domain = strings.TrimSpace(domain)
	if domain == "" {
		return "", "", fmt.Errorf("domain is required")
	}

	// If Caddy already has a cert for this domain, reuse it directly.
	if cp, kp := caddyCertPaths(domain); cp != "" {
		return cp, kp, nil
	}

	// Fall back to the backend's own ACME client.
	return GetACMEService().ObtainCert(domain)
}

// SavePastedCert validates certPEM and keyPEM, then persists them as files under
// {certsDir}/{tag}/ and returns the resulting absolute paths.
// tag is a short identifier (e.g. the inbound tag) used as the sub-directory name.
func (s *CertService) SavePastedCert(tag, certPEM, keyPEM string) (certPath, keyPath string, err error) {
	tag = sanitizeTag(tag)
	if tag == "" {
		return "", "", fmt.Errorf("tag is required")
	}
	if block, _ := pem.Decode([]byte(certPEM)); block == nil {
		return "", "", fmt.Errorf("certificate does not appear to be valid PEM")
	}
	if block, _ := pem.Decode([]byte(keyPEM)); block == nil {
		return "", "", fmt.Errorf("private key does not appear to be valid PEM")
	}

	tagDir := filepath.Join(certsDir(), tag)
	if err := os.MkdirAll(tagDir, 0o700); err != nil {
		return "", "", fmt.Errorf("create certs directory: %w", err)
	}

	certPath = filepath.Join(tagDir, "cert.pem")
	keyPath = filepath.Join(tagDir, "key.pem")

	if err := os.WriteFile(certPath, []byte(certPEM), 0o644); err != nil {
		return "", "", fmt.Errorf("write cert file: %w", err)
	}
	if err := os.WriteFile(keyPath, []byte(keyPEM), 0o600); err != nil {
		return "", "", fmt.Errorf("write key file: %w", err)
	}
	return certPath, keyPath, nil
}

// sanitizeTag strips characters that would be unsafe in a filesystem path component.
func sanitizeTag(tag string) string {
	tag = strings.TrimSpace(tag)
	var b strings.Builder
	for _, r := range tag {
		if r == '.' || r == '-' || r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}
