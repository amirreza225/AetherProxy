package sub

import (
	"reflect"
	"testing"
)

func TestPreferEvasionProtocol(t *testing.T) {
	links := []string{
		"vless://first",
		"hysteria2://preferred",
		"trojan://fallback",
	}
	want := []string{
		"hysteria2://preferred",
		"vless://first",
		"trojan://fallback",
	}
	if got := preferEvasionProtocol(links, "hysteria2"); !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected ordering: got %v want %v", got, want)
	}
}
