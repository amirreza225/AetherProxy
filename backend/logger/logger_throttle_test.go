package logger

import (
	"strings"
	"testing"
	"time"

	"github.com/op/go-logging"
)

func resetGlobalThrottleState() {
	repeatMu.Lock()
	repeatStates = map[string]*repeatState{}
	repeatMu.Unlock()
}

func TestGlobalThrottleSuppressesRepeats(t *testing.T) {
	throttleDisabled = false
	globalThrottleDebug = false
	globalThrottleEvery = 2 * time.Second
	resetGlobalThrottleState()

	msg, emit := applyGlobalRepeatThrottle(logging.INFO, "same-message")
	if !emit || msg != "same-message" {
		t.Fatalf("first log should emit unchanged message, emit=%v msg=%q", emit, msg)
	}

	_, emit = applyGlobalRepeatThrottle(logging.INFO, "same-message")
	if emit {
		t.Fatalf("second identical log should be suppressed")
	}

	repeatMu.Lock()
	state := repeatStates["INFO|same-message"]
	if state == nil {
		repeatMu.Unlock()
		t.Fatalf("expected repeat state entry")
	}
	state.lastLogged = time.Now().Add(-3 * time.Second)
	repeatMu.Unlock()

	msg, emit = applyGlobalRepeatThrottle(logging.INFO, "same-message")
	if !emit {
		t.Fatalf("message should emit after throttle window")
	}
	if !strings.Contains(msg, "auto-suppressed 1 repeats") {
		t.Fatalf("expected suppression summary in emitted message, got %q", msg)
	}
}

func TestGlobalThrottleDebugByDefaultNotSuppressed(t *testing.T) {
	throttleDisabled = false
	globalThrottleDebug = false
	globalThrottleEvery = 10 * time.Second
	resetGlobalThrottleState()

	_, emit := applyGlobalRepeatThrottle(logging.DEBUG, "dbg")
	if !emit {
		t.Fatalf("first debug message should emit")
	}
	_, emit = applyGlobalRepeatThrottle(logging.DEBUG, "dbg")
	if !emit {
		t.Fatalf("debug message should not be globally throttled when disabled for DEBUG")
	}
}

func TestGlobalThrottleDebugCanBeEnabled(t *testing.T) {
	throttleDisabled = false
	globalThrottleDebug = true
	globalThrottleEvery = 10 * time.Second
	resetGlobalThrottleState()

	_, emit := applyGlobalRepeatThrottle(logging.DEBUG, "dbg")
	if !emit {
		t.Fatalf("first debug message should emit")
	}
	_, emit = applyGlobalRepeatThrottle(logging.DEBUG, "dbg")
	if emit {
		t.Fatalf("second debug message should be suppressed when debug throttling is enabled")
	}
}

func TestGlobalThrottleDisabledBypass(t *testing.T) {
	throttleDisabled = true
	globalThrottleDebug = true
	globalThrottleEvery = 10 * time.Second
	resetGlobalThrottleState()

	_, emit := applyGlobalRepeatThrottle(logging.INFO, "x")
	if !emit {
		t.Fatalf("throttle disabled should always emit")
	}
	_, emit = applyGlobalRepeatThrottle(logging.INFO, "x")
	if !emit {
		t.Fatalf("throttle disabled should always emit repeated messages")
	}
}
