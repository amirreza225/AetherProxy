package config

import "testing"

func TestValidateJWTSecret(t *testing.T) {
	t.Setenv("AETHER_DEBUG", "")
	t.Setenv("AETHER_JWT_SECRET", "")
	if err := ValidateJWTSecret(); err == nil {
		t.Fatal("expected missing production secret to be rejected")
	}

	t.Setenv("AETHER_JWT_SECRET", "short")
	if err := ValidateJWTSecret(); err == nil {
		t.Fatal("expected short production secret to be rejected")
	}

	t.Setenv("AETHER_JWT_SECRET", "0123456789abcdef0123456789abcdef")
	if err := ValidateJWTSecret(); err != nil {
		t.Fatalf("expected strong production secret to be accepted: %v", err)
	}
}

func TestValidateJWTSecretAllowsDevelopmentFallback(t *testing.T) {
	t.Setenv("AETHER_DEBUG", "true")
	t.Setenv("AETHER_JWT_SECRET", "")
	if err := ValidateJWTSecret(); err != nil {
		t.Fatalf("expected debug fallback to be accepted: %v", err)
	}
}
