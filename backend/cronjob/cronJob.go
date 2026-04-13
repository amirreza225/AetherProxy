package cronjob

import (
	"time"

	"github.com/robfig/cron/v3"
)

type CronJob struct {
	cron *cron.Cron
}

func NewCronJob() *CronJob {
	return &CronJob{}
}

func (c *CronJob) Start(loc *time.Location, trafficAge int) error {
	c.cron = cron.New(cron.WithLocation(loc), cron.WithSeconds())
	c.cron.Start()

	go func() {
		// Start stats job
		_, _ = c.cron.AddJob("@every 10s", NewStatsJob(trafficAge > 0))
		// Start expiry job
		_, _ = c.cron.AddJob("@every 1m", NewDepleteJob())
		// Start deleting old stats
		if trafficAge > 0 {
			_, _ = c.cron.AddJob("@daily", NewDelStatsJob(trafficAge))
		}
		// Start core if it is not running (check every 30s; the 15s cooldown
		// in StartCore prevents back-to-back restart attempts anyway)
		_, _ = c.cron.AddJob("@every 30s", NewCheckCoreJob())
		// database WAL checkpoint
		_, _ = c.cron.AddJob("@every 10m", NewWALCheckpointJob())
		// Retry failed inbound port/firewall sync tasks.
		_, _ = c.cron.AddJob("@every 30s", NewPortSyncJob())
		// Rotate Reality short-IDs daily to prevent CGFW fingerprinting
		_, _ = c.cron.AddJob("@daily", NewRotateShortIDJob())
	}()

	return nil
}

func (c *CronJob) Stop() {
	if c.cron != nil {
		c.cron.Stop()
	}
}
