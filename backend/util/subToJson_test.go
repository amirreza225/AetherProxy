package util

import (
	"net/netip"
	"testing"
)

func TestIsPublicIP(t *testing.T) {
	for _, raw := range []string{"127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1"} {
		if isPublicIP(netip.MustParseAddr(raw)) {
			t.Fatalf("expected %s to be blocked", raw)
		}
	}
	if !isPublicIP(netip.MustParseAddr("1.1.1.1")) {
		t.Fatal("expected public address to be allowed")
	}
}
