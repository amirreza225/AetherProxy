package service

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/aetherproxy/backend/config"
	"github.com/aetherproxy/backend/logger"
	"golang.org/x/crypto/acme"
)

const acmeProductionURL = "https://acme-v02.api.letsencrypt.org/directory"

// ACMEService handles Let's Encrypt certificate acquisition via HTTP-01 challenge.
// The challenge token is served at /.well-known/acme-challenge/:token by the web server.
type ACMEService struct {
	mu         sync.Mutex
	challenges map[string]string // token → keyAuth
}

var acmeOnce sync.Once
var globalACMEService *ACMEService

func GetACMEService() *ACMEService {
	acmeOnce.Do(func() {
		globalACMEService = &ACMEService{
			challenges: make(map[string]string),
		}
	})
	return globalACMEService
}

// ServeChallenge writes the HTTP-01 key authorization for the given token.
// Returns false if no challenge is pending for that token.
func (s *ACMEService) ServeChallenge(w http.ResponseWriter, token string) bool {
	s.mu.Lock()
	keyAuth, ok := s.challenges[token]
	s.mu.Unlock()
	if !ok {
		return false
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write([]byte(keyAuth))
	return true
}

// ObtainCert acquires (or reuses a non-expiring) Let's Encrypt certificate for domain.
// It writes cert.pem and key.pem under <db-folder>/certs/<domain>/ and returns both paths.
func (s *ACMEService) ObtainCert(domain string) (certPath, keyPath string, err error) {
	certsDir := filepath.Join(config.GetDBFolderPath(), "certs", domain)
	certPath = filepath.Join(certsDir, "cert.pem")
	keyPath = filepath.Join(certsDir, "key.pem")

	if certStillValid(certPath) {
		logger.Infof("ACME: reusing valid certificate for %s", domain)
		return certPath, keyPath, nil
	}

	if err = os.MkdirAll(certsDir, 0700); err != nil {
		return "", "", fmt.Errorf("ACME: mkdir %s: %w", certsDir, err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	client, err := s.buildClient(ctx)
	if err != nil {
		return "", "", err
	}

	// Generate the certificate private key.
	certKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", fmt.Errorf("ACME: generate cert key: %w", err)
	}

	// Start the order.
	order, err := client.AuthorizeOrder(ctx, acme.DomainIDs(domain))
	if err != nil {
		return "", "", fmt.Errorf("ACME: authorize order: %w", err)
	}

	// Fulfill each pending authorization via HTTP-01.
	for _, authURL := range order.AuthzURLs {
		authz, err := client.GetAuthorization(ctx, authURL)
		if err != nil {
			return "", "", fmt.Errorf("ACME: get authorization: %w", err)
		}
		if authz.Status == acme.StatusValid {
			continue
		}

		var chal *acme.Challenge
		for _, c := range authz.Challenges {
			if c.Type == "http-01" {
				chal = c
				break
			}
		}
		if chal == nil {
			return "", "", fmt.Errorf("ACME: no http-01 challenge available for %s", domain)
		}

		keyAuth, err := client.HTTP01ChallengeResponse(chal.Token)
		if err != nil {
			return "", "", fmt.Errorf("ACME: compute key auth: %w", err)
		}

		// Register the challenge token so the web server can serve it.
		s.mu.Lock()
		s.challenges[chal.Token] = keyAuth
		s.mu.Unlock()

		if _, err := client.Accept(ctx, chal); err != nil {
			s.mu.Lock()
			delete(s.challenges, chal.Token)
			s.mu.Unlock()
			return "", "", fmt.Errorf("ACME: accept challenge: %w", err)
		}

		_, err = client.WaitAuthorization(ctx, authz.URI)
		s.mu.Lock()
		delete(s.challenges, chal.Token)
		s.mu.Unlock()
		if err != nil {
			return "", "", fmt.Errorf("ACME: wait authorization: %w", err)
		}
	}

	// Build the CSR and finalize the order.
	csrTemplate := &x509.CertificateRequest{DNSNames: []string{domain}}
	csrDER, err := x509.CreateCertificateRequest(rand.Reader, csrTemplate, certKey)
	if err != nil {
		return "", "", fmt.Errorf("ACME: create CSR: %w", err)
	}

	der, _, err := client.CreateOrderCert(ctx, order.FinalizeURL, csrDER, true)
	if err != nil {
		return "", "", fmt.Errorf("ACME: finalize order: %w", err)
	}

	// Write cert.pem (full chain).
	cf, err := os.OpenFile(certPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0644)
	if err != nil {
		return "", "", fmt.Errorf("ACME: open cert file: %w", err)
	}
	for _, b := range der {
		_ = pem.Encode(cf, &pem.Block{Type: "CERTIFICATE", Bytes: b})
	}
	_ = cf.Close()

	// Write key.pem.
	keyDER, err := x509.MarshalECPrivateKey(certKey)
	if err != nil {
		return "", "", fmt.Errorf("ACME: marshal key: %w", err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), 0600); err != nil {
		return "", "", fmt.Errorf("ACME: write key: %w", err)
	}

	logger.Infof("ACME: certificate obtained for %s → %s", domain, certsDir)
	return certPath, keyPath, nil
}

// buildClient creates an ACME client with a persistent account key.
func (s *ACMEService) buildClient(ctx context.Context) (*acme.Client, error) {
	accountKeyPath := filepath.Join(config.GetDBFolderPath(), "acme-account.key")

	var accountKey *ecdsa.PrivateKey
	if data, err := os.ReadFile(accountKeyPath); err == nil {
		if block, _ := pem.Decode(data); block != nil {
			accountKey, _ = x509.ParseECPrivateKey(block.Bytes)
		}
	}
	if accountKey == nil {
		var err error
		accountKey, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return nil, fmt.Errorf("ACME: generate account key: %w", err)
		}
		keyDER, _ := x509.MarshalECPrivateKey(accountKey)
		_ = os.WriteFile(accountKeyPath,
			pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), 0600)
	}

	client := &acme.Client{
		Key:          accountKey,
		DirectoryURL: acmeProductionURL,
	}

	if _, err := client.Register(ctx, &acme.Account{}, acme.AcceptTOS); err != nil {
		if ae, ok := err.(*acme.Error); !ok || ae.StatusCode != 409 {
			return nil, fmt.Errorf("ACME: register account: %w", err)
		}
	}

	return client, nil
}

// certStillValid returns true if the PEM cert at path exists and expires in > 30 days.
func certStillValid(certPath string) bool {
	data, err := os.ReadFile(certPath)
	if err != nil {
		return false
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return false
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return false
	}
	return time.Until(cert.NotAfter) > 30*24*time.Hour
}
