package service

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aetherproxy/backend/config"
	"golang.org/x/crypto/acme/autocert"
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

// IssueLetsEncrypt obtains a certificate from Let's Encrypt for the given domain.
// It temporarily binds port 80 to serve the HTTP-01 ACME challenge, then writes
// fullchain.pem and privkey.pem into {certsDir}/{domain}/ and returns their paths.
func (s *CertService) IssueLetsEncrypt(domain, email string) (certPath, keyPath string, err error) {
	domain = strings.TrimSpace(domain)
	if domain == "" {
		return "", "", fmt.Errorf("domain is required")
	}

	domainDir := filepath.Join(certsDir(), domain)
	if err := os.MkdirAll(domainDir, 0o700); err != nil {
		return "", "", fmt.Errorf("create certs directory: %w", err)
	}

	certPath = filepath.Join(domainDir, "fullchain.pem")
	keyPath = filepath.Join(domainDir, "privkey.pem")

	m := &autocert.Manager{
		Cache:      autocert.DirCache(filepath.Join(certsDir(), ".acme-cache")),
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(domain),
	}
	if email != "" {
		m.Email = email
	}

	// Bind port 80 for the HTTP-01 challenge.
	ln, listenErr := net.Listen("tcp", ":80")
	if listenErr != nil {
		return "", "", fmt.Errorf("cannot listen on port 80 (required for Let's Encrypt HTTP challenge): %w", listenErr)
	}
	srv := &http.Server{Handler: m.HTTPHandler(nil)}
	go func() { _ = srv.Serve(ln) }()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	// Trigger certificate issuance. GetCertificate runs the ACME flow when no
	// cached cert is available and blocks until it completes or fails.
	tlsCert, issueErr := m.GetCertificate(&tls.ClientHelloInfo{ServerName: domain})
	if issueErr != nil {
		return "", "", fmt.Errorf("certificate issuance failed: %w", issueErr)
	}

	// Write the certificate chain as PEM.
	certFile, err := os.Create(certPath)
	if err != nil {
		return "", "", fmt.Errorf("create cert file: %w", err)
	}
	defer func() {
		if closeErr := certFile.Close(); closeErr != nil && err == nil {
			err = closeErr
		}
	}()
	for _, derBlock := range tlsCert.Certificate {
		if encErr := pem.Encode(certFile, &pem.Block{Type: "CERTIFICATE", Bytes: derBlock}); encErr != nil {
			return "", "", fmt.Errorf("write cert PEM: %w", encErr)
		}
	}

	// Write the private key as PKCS#8 PEM.
	keyDER, err := x509.MarshalPKCS8PrivateKey(tlsCert.PrivateKey)
	if err != nil {
		return "", "", fmt.Errorf("marshal private key: %w", err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		return "", "", fmt.Errorf("write key file: %w", err)
	}

	return certPath, keyPath, nil
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
