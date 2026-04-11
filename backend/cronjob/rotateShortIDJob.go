package cronjob

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/aetherproxy/backend/database"
	"github.com/aetherproxy/backend/database/model"
	"github.com/aetherproxy/backend/logger"
	"github.com/aetherproxy/backend/service"

	"gorm.io/gorm"
)

// RotateShortIDJob regenerates the Reality short-IDs on every TLS profile that
// has Reality enabled.  Fresh, unpredictable short-IDs prevent CGFW systems from
// fingerprinting proxies by their static short-ID values.
type RotateShortIDJob struct {
	service.ConfigService
}

func NewRotateShortIDJob() *RotateShortIDJob {
	return &RotateShortIDJob{}
}

func (j *RotateShortIDJob) Run() {
	db := database.GetDB()
	var tlsProfiles []model.Tls
	if err := db.Find(&tlsProfiles).Error; err != nil {
		logger.Warning("RotateShortIDJob: failed to load TLS profiles:", err)
		return
	}

	updated := 0
	for _, profile := range tlsProfiles {
		if err := j.rotateIfReality(db, &profile); err != nil {
			logger.Warning("RotateShortIDJob: profile", profile.Id, err)
		} else {
			updated++
		}
	}

	if updated > 0 {
		logger.Infof("RotateShortIDJob: rotated short-IDs on %d Reality TLS profile(s)", updated)
		// Bump LastUpdate so clients know to re-fetch subscriptions.
		service.LastUpdate = time.Now().Unix()
		// Hot-reload sing-box so the new short-IDs take effect immediately.
		if err := j.RestartCore(); err != nil {
			logger.Warning("RotateShortIDJob: core restart failed:", err)
		}
	}
}

// rotateIfReality inspects the server TLS config.  If it contains a Reality
// block with short-IDs, it generates 3 fresh random short-IDs and persists them.
func (j *RotateShortIDJob) rotateIfReality(db *gorm.DB, profile *model.Tls) error {
	if profile.Server == nil {
		return nil
	}
	var serverCfg map[string]interface{}
	if err := json.Unmarshal(profile.Server, &serverCfg); err != nil {
		return err
	}
	reality, ok := serverCfg["reality"].(map[string]interface{})
	if !ok {
		return nil // Not a Reality profile.
	}
	if enabled, _ := reality["enabled"].(bool); !enabled {
		return nil
	}

	// Generate 3 fresh short-IDs of random length between 4 and 8 bytes (8–16 hex chars).
	newIDs := generateShortIDs(3)
	reality["short_id"] = newIDs
	serverCfg["reality"] = reality

	newServer, err := json.Marshal(serverCfg)
	if err != nil {
		return err
	}
	return db.Model(profile).Update("server", string(newServer)).Error
}

// generateShortIDs returns n random Reality short-ID strings.
// Each is a hex string of 8–16 lowercase hex characters (4–8 random bytes),
// matching the Reality protocol's accepted short-ID format.
func generateShortIDs(n int) []string {
	ids := make([]string, n)
	for i := range ids {
		// Choose a random length between 4 and 8 bytes.
		lenBytes := 4 + randomInt(5) // 4,5,6,7,8
		b := make([]byte, lenBytes)
		if _, err := rand.Read(b); err != nil {
			// Fallback: use zeros (should never happen).
			ids[i] = hex.EncodeToString(b)
			continue
		}
		ids[i] = hex.EncodeToString(b)
	}
	return ids
}

func randomInt(n int) int {
	if n <= 0 {
		return 0
	}
	b := make([]byte, 1)
	_, _ = rand.Read(b)
	return int(b[0]) % n
}
