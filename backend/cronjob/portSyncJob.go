package cronjob

import (
	"github.com/aetherproxy/backend/logger"
	"github.com/aetherproxy/backend/service"
)

type PortSyncJob struct{}

func NewPortSyncJob() *PortSyncJob {
	return &PortSyncJob{}
}

func (j *PortSyncJob) Run() {
	if err := service.GetPortSyncService().ProcessDueTasks(30); err != nil {
		logger.Warning("PortSyncJob failed:", err)
	}
}
