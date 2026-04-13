package logger

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/op/go-logging"
)

var (
	logger      *logging.Logger
	logBufferMu sync.RWMutex
	throttleMu  sync.Mutex
	repeatMu    sync.Mutex
	logBuffer   []struct {
		time  string
		level logging.Level
		log   string
	}
	throttleStates      = map[string]*throttleState{}
	repeatStates        = map[string]*repeatState{}
	throttleDisabled    bool
	globalThrottleDebug bool
	globalThrottleEvery time.Duration
)

type throttleState struct {
	lastLogged time.Time
	lastMsg    string
	suppressed int
}

type repeatState struct {
	lastLogged time.Time
	suppressed int
}

const defaultThrottleWindow = 30 * time.Second
const defaultGlobalThrottleWindow = 20 * time.Second
const maxRepeatStateEntries = 8192

func InitLogger(level logging.Level) {
	newLogger := logging.MustGetLogger("s-ui")
	throttleDisabled = readBoolEnv("AETHER_LOG_THROTTLE_DISABLED")
	globalThrottleDebug = readBoolEnv("AETHER_LOG_AUTO_THROTTLE_DEBUG")
	globalThrottleEvery = readDurationSecondsEnv("AETHER_LOG_AUTO_THROTTLE_WINDOW_SECONDS", defaultGlobalThrottleWindow)

	var err error
	var backend logging.Backend
	var format logging.Formatter

	_, inContainer := os.LookupEnv("container")
	if !inContainer {
		if _, statErr := os.Stat("/.dockerenv"); statErr == nil {
			inContainer = true
		}
	}
	if inContainer {
		backend = logging.NewLogBackend(os.Stderr, "", 0)
		format = logging.MustStringFormatter(`%{time:2006/01/02 15:04:05} %{level} - %{message}`)
	} else {
		backend, err = logging.NewSyslogBackend("")
		if err != nil {
			fmt.Println("Unable to use syslog: " + err.Error())
			backend = logging.NewLogBackend(os.Stderr, "", 0)
		}
		if err != nil {
			format = logging.MustStringFormatter(`%{time:2006/01/02 15:04:05} %{level} - %{message}`)
		} else {
			format = logging.MustStringFormatter(`%{level} - %{message}`)
		}
	}

	backendFormatter := logging.NewBackendFormatter(backend, format)
	backendLeveled := logging.AddModuleLevel(backendFormatter)
	backendLeveled.SetLevel(level, "s-ui")
	newLogger.SetBackend(backendLeveled)

	logger = newLogger
}

func readBoolEnv(key string) bool {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return false
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		return false
	}
	return v
}

func readDurationSecondsEnv(key string, def time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 0 {
		return def
	}
	return time.Duration(v) * time.Second
}

func GetLogger() *logging.Logger {
	return logger
}

func Debug(args ...interface{}) {
	writeLog(logging.DEBUG, fmt.Sprint(args...))
}

func Debugf(format string, args ...interface{}) {
	writeLog(logging.DEBUG, fmt.Sprintf(format, args...))
}

func Info(args ...interface{}) {
	writeLog(logging.INFO, fmt.Sprint(args...))
}

func Infof(format string, args ...interface{}) {
	writeLog(logging.INFO, fmt.Sprintf(format, args...))
}

func Warning(args ...interface{}) {
	writeLog(logging.WARNING, fmt.Sprint(args...))
}

func Warningf(format string, args ...interface{}) {
	writeLog(logging.WARNING, fmt.Sprintf(format, args...))
}

func Error(args ...interface{}) {
	writeLog(logging.ERROR, fmt.Sprint(args...))
}

func Errorf(format string, args ...interface{}) {
	writeLog(logging.ERROR, fmt.Sprintf(format, args...))
}

func DebugThrottled(key string, every time.Duration, args ...interface{}) {
	throttledLog(logging.DEBUG, key, every, fmt.Sprint(args...))
}

func DebugfThrottled(key string, every time.Duration, format string, args ...interface{}) {
	throttledLog(logging.DEBUG, key, every, fmt.Sprintf(format, args...))
}

func InfoThrottled(key string, every time.Duration, args ...interface{}) {
	throttledLog(logging.INFO, key, every, fmt.Sprint(args...))
}

func InfofThrottled(key string, every time.Duration, format string, args ...interface{}) {
	throttledLog(logging.INFO, key, every, fmt.Sprintf(format, args...))
}

func WarningThrottled(key string, every time.Duration, args ...interface{}) {
	throttledLog(logging.WARNING, key, every, fmt.Sprint(args...))
}

func WarningfThrottled(key string, every time.Duration, format string, args ...interface{}) {
	throttledLog(logging.WARNING, key, every, fmt.Sprintf(format, args...))
}

func ErrorThrottled(key string, every time.Duration, args ...interface{}) {
	throttledLog(logging.ERROR, key, every, fmt.Sprint(args...))
}

func ErrorfThrottled(key string, every time.Duration, format string, args ...interface{}) {
	throttledLog(logging.ERROR, key, every, fmt.Sprintf(format, args...))
}

func throttledLog(level logging.Level, key string, every time.Duration, msg string) {
	if every <= 0 {
		every = defaultThrottleWindow
	}
	if throttleDisabled || key == "" {
		writeLog(level, msg)
		return
	}

	now := time.Now()
	throttleMu.Lock()
	state, ok := throttleStates[key]
	if !ok {
		state = &throttleState{}
		throttleStates[key] = state
	}
	emit := false
	suppressed := 0
	sameMsg := state.lastMsg == msg
	if state.lastLogged.IsZero() || now.Sub(state.lastLogged) >= every || !sameMsg {
		emit = true
		if sameMsg {
			suppressed = state.suppressed
		}
		state.lastLogged = now
		state.lastMsg = msg
		state.suppressed = 0
	} else {
		state.suppressed++
	}
	throttleMu.Unlock()

	if !emit {
		return
	}
	if suppressed > 0 {
		msg = fmt.Sprintf("%s (suppressed %d repeats over %s)", msg, suppressed, every)
	}
	writeLogRaw(level, msg)
}

func writeLog(level logging.Level, msg string) {
	msg, emit := applyGlobalRepeatThrottle(level, msg)
	if !emit {
		return
	}
	writeLogRaw(level, msg)
}

func writeLogRaw(level logging.Level, msg string) {
	if logger == nil {
		fmt.Fprintf(os.Stderr, "%s - %s\n", level.String(), msg)
		addToBuffer(level.String(), msg)
		return
	}
	switch level {
	case logging.DEBUG:
		logger.Debug(msg)
	case logging.INFO:
		logger.Info(msg)
	case logging.WARNING:
		logger.Warning(msg)
	case logging.ERROR:
		logger.Error(msg)
	default:
		logger.Info(msg)
	}
	addToBuffer(level.String(), msg)
}

func applyGlobalRepeatThrottle(level logging.Level, msg string) (string, bool) {
	if throttleDisabled || globalThrottleEvery <= 0 {
		return msg, true
	}
	if level == logging.DEBUG && !globalThrottleDebug {
		return msg, true
	}

	now := time.Now()
	key := level.String() + "|" + msg

	repeatMu.Lock()
	if len(repeatStates) > maxRepeatStateEntries {
		pruneRepeatStatesLocked(now)
	}
	st, ok := repeatStates[key]
	if !ok {
		st = &repeatState{}
		repeatStates[key] = st
	}
	if st.lastLogged.IsZero() || now.Sub(st.lastLogged) >= globalThrottleEvery {
		suppressed := st.suppressed
		st.lastLogged = now
		st.suppressed = 0
		repeatMu.Unlock()
		if suppressed > 0 {
			return fmt.Sprintf("%s (auto-suppressed %d repeats over %s)", msg, suppressed, globalThrottleEvery), true
		}
		return msg, true
	}
	st.suppressed++
	repeatMu.Unlock()
	return "", false
}

func pruneRepeatStatesLocked(now time.Time) {
	cutoff := 10 * globalThrottleEvery
	if cutoff <= 0 {
		cutoff = 10 * defaultGlobalThrottleWindow
	}
	for k, st := range repeatStates {
		if now.Sub(st.lastLogged) > cutoff {
			delete(repeatStates, k)
		}
	}
	if len(repeatStates) > maxRepeatStateEntries {
		repeatStates = map[string]*repeatState{}
	}
}

func addToBuffer(level string, newLog string) {
	t := time.Now()
	logBufferMu.Lock()
	defer logBufferMu.Unlock()

	if len(logBuffer) >= 10240 {
		logBuffer = logBuffer[1:]
	}

	logLevel, _ := logging.LogLevel(level)
	logBuffer = append(logBuffer, struct {
		time  string
		level logging.Level
		log   string
	}{
		time:  t.Format("2006/01/02 15:04:05"),
		level: logLevel,
		log:   newLog,
	})
}

func GetLogs(c int, level string) []string {
	var output []string
	logLevel, _ := logging.LogLevel(level)
	logBufferMu.RLock()
	defer logBufferMu.RUnlock()

	for i := len(logBuffer) - 1; i >= 0 && len(output) <= c; i-- {
		if logBuffer[i].level <= logLevel {
			output = append(output, fmt.Sprintf("%s %s - %s", logBuffer[i].time, logBuffer[i].level, logBuffer[i].log))
		}
	}
	return output
}
