package service

import (
	"sort"
	"strings"
	"time"

	"github.com/aetherproxy/backend/database"
	"github.com/aetherproxy/backend/database/model"
	"gorm.io/gorm"
)

type onlines struct {
	Inbound  []string `json:"inbound,omitempty"`
	User     []string `json:"user,omitempty"`
	Outbound []string `json:"outbound,omitempty"`
}

var onlineResources = &onlines{}

type StatsService struct {
}

func (s *StatsService) SaveStats(enableTraffic bool) error {
	if corePtr == nil || !corePtr.IsRunning() {
		return nil
	}
	box := corePtr.GetInstance()
	if box == nil {
		return nil
	}
	st := box.StatsTracker()
	if st == nil {
		return nil
	}
	stats := st.GetStats()

	// Reset onlines
	onlineResources.Inbound = nil
	onlineResources.Outbound = nil
	onlineResources.User = nil

	if len(*stats) == 0 {
		return nil
	}

	// Accumulate per-user up/down deltas to perform two bulk UPDATEs
	// instead of one UPDATE per stat row (eliminates the N+1 write pattern).
	upDeltas := make(map[string]int64)
	downDeltas := make(map[string]int64)

	for _, stat := range *stats {
		if stat.Resource == "user" {
			if stat.Direction {
				upDeltas[stat.Tag] += stat.Traffic
			} else {
				downDeltas[stat.Tag] += stat.Traffic
			}
		}
		if stat.Direction {
			switch stat.Resource {
			case "inbound":
				onlineResources.Inbound = append(onlineResources.Inbound, stat.Tag)
			case "outbound":
				onlineResources.Outbound = append(onlineResources.Outbound, stat.Tag)
			case "user":
				onlineResources.User = append(onlineResources.User, stat.Tag)
			}
		}
	}

	var err error
	db := database.GetDB()
	tx := db.Begin()
	defer func() {
		if err == nil {
			tx.Commit()
		} else {
			tx.Rollback()
		}
	}()

	// Bulk UPDATE for upload traffic using a single CASE expression.
	if len(upDeltas) > 0 {
		err = bulkUpdateTraffic(tx, "up", upDeltas)
		if err != nil {
			return err
		}
	}

	// Bulk UPDATE for download traffic using a single CASE expression.
	if len(downDeltas) > 0 {
		err = bulkUpdateTraffic(tx, "down", downDeltas)
		if err != nil {
			return err
		}
	}

	if !enableTraffic {
		return nil
	}
	return tx.Create(&stats).Error
}

// bulkUpdateTraffic issues a single UPDATE that increments `column` for each
// client in deltas by its respective delta value, using a CASE expression:
//
//	UPDATE clients SET up = up + CASE name WHEN 'u1' THEN 10 WHEN 'u2' THEN 5 END
//	WHERE name IN ('u1', 'u2')
//
// This replaces N individual per-row UPDATE calls with one statement.
func bulkUpdateTraffic(tx *gorm.DB, column string, deltas map[string]int64) error {
	names := make([]string, 0, len(deltas))
	for name := range deltas {
		names = append(names, name)
	}

	// Build: UPDATE clients SET <column> = <column> + CASE name WHEN ? THEN ? ... END WHERE name IN (?)
	var sb strings.Builder
	sb.WriteString("UPDATE clients SET ")
	sb.WriteString(column)
	sb.WriteString(" = ")
	sb.WriteString(column)
	sb.WriteString(" + CASE name")

	args := make([]interface{}, 0, len(deltas)*2+1)
	for _, name := range names {
		sb.WriteString(" WHEN ? THEN ?")
		args = append(args, name, deltas[name])
	}
	sb.WriteString(" END WHERE name IN ?")
	args = append(args, names)

	return tx.Exec(sb.String(), args...).Error
}

func (s *StatsService) GetStats(resource string, tag string, limit int) ([]model.Stats, error) {
	var err error
	var result []model.Stats

	currentTime := time.Now().Unix()
	timeDiff := currentTime - (int64(limit) * 3600)

	db := database.GetDB()
	resources := []string{resource}
	if resource == "endpoint" {
		resources = []string{"inbound", "outbound"}
	}
	err = db.Model(model.Stats{}).Where("resource in ? AND tag = ? AND date_time > ?", resources, tag, timeDiff).Scan(&result).Error
	if err != nil {
		return nil, err
	}

	result = s.downsampleStats(result, 60) // 60 rows for 30 buckets
	return result, nil
}

// downsampleStats reduces stats to at most maxRows rows by averaging traffic
// within equal-width time buckets.  Each bucket produces two output rows
// (direction=false and direction=true).
//
// The previous implementation was O(n × numBuckets) because it rescanned all
// rows for every bucket.  This version is O(n) after the initial sort: each
// row is assigned to a bucket by arithmetic and accumulated in a single pass.
func (s *StatsService) downsampleStats(stats []model.Stats, maxRows int) []model.Stats {
	if len(stats) <= maxRows {
		return stats
	}
	numBuckets := maxRows / 2

	// Sort once by time ascending.
	// (stats are typically already ordered from the DB query, but sort anyway
	// to guarantee correctness.)
	sort.Slice(stats, func(i, j int) bool { return stats[i].DateTime < stats[j].DateTime })

	timeMin := stats[0].DateTime
	timeMax := stats[len(stats)-1].DateTime
	bucketSpan := (timeMax - timeMin) / int64(numBuckets)
	if bucketSpan == 0 {
		bucketSpan = 1
	}

	// Accumulate sums and counts per (bucket, direction).
	// Direction false → index 0, true → index 1.
	type accumulator struct{ sum, count int64 }
	buckets := make([][2]accumulator, numBuckets)

	for _, r := range stats {
		idx := int((r.DateTime - timeMin) / bucketSpan)
		if idx >= numBuckets {
			idx = numBuckets - 1
		}
		dir := 0
		if r.Direction {
			dir = 1
		}
		buckets[idx][dir].sum += r.Traffic
		buckets[idx][dir].count++
	}

	resource := stats[0].Resource
	tag := stats[0].Tag

	downsampled := make([]model.Stats, 0, numBuckets*2)
	for i := 0; i < numBuckets; i++ {
		bucketStart := timeMin + int64(i)*bucketSpan
		for dir := 0; dir < 2; dir++ {
			avg := int64(0)
			if buckets[i][dir].count > 0 {
				avg = buckets[i][dir].sum / buckets[i][dir].count
			}
			downsampled = append(downsampled, model.Stats{
				DateTime:  bucketStart,
				Resource:  resource,
				Tag:       tag,
				Direction: dir == 1,
				Traffic:   avg,
			})
		}
	}
	return downsampled
}

func (s *StatsService) GetOnlines() (onlines, error) {
	return *onlineResources, nil
}
func (s *StatsService) DelOldStats(days int) error {
	oldTime := time.Now().AddDate(0, 0, -(days)).Unix()
	db := database.GetDB()
	return db.Where("date_time < ?", oldTime).Delete(model.Stats{}).Error
}
