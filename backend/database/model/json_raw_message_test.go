package model

import (
	"testing"
)

func TestJSONRawMessageScanFromString(t *testing.T) {
	var msg JSONRawMessage
	if err := msg.Scan(`{"enabled":true}`); err != nil {
		t.Fatalf("Scan(string) failed: %v", err)
	}
	if string(msg) != `{"enabled":true}` {
		t.Fatalf("unexpected value after Scan(string): %s", string(msg))
	}
}

func TestJSONRawMessageScanFromBytes(t *testing.T) {
	var msg JSONRawMessage
	if err := msg.Scan([]byte(`{"insecure":false}`)); err != nil {
		t.Fatalf("Scan([]byte) failed: %v", err)
	}
	if string(msg) != `{"insecure":false}` {
		t.Fatalf("unexpected value after Scan([]byte): %s", string(msg))
	}
}

func TestJSONRawMessageValue(t *testing.T) {
	msg := JSONRawMessage(`{"k":"v"}`)
	v, err := msg.Value()
	if err != nil {
		t.Fatalf("Value() failed: %v", err)
	}
	s, ok := v.(string)
	if !ok {
		t.Fatalf("expected string driver value, got %T", v)
	}
	if s != `{"k":"v"}` {
		t.Fatalf("unexpected driver value: %s", s)
	}
}
