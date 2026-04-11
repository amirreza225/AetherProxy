package model

// PortSyncTask represents a pending firewall reconciliation action.
// scope is either "local" or "node".
type PortSyncTask struct {
	Id uint `json:"id" gorm:"primaryKey;autoIncrement"`

	Scope  string `json:"scope" gorm:"index:idx_port_sync_target,priority:1;size:16"`
	NodeId uint   `json:"nodeId" gorm:"index:idx_port_sync_target,priority:2"`

	Reason    string `json:"reason" gorm:"size:128"`
	Status    string `json:"status" gorm:"size:16;index;default:pending"`
	Attempts  int    `json:"attempts" gorm:"default:0"`
	LastError string `json:"lastError" gorm:"size:1024"`

	NextRunAt int64 `json:"nextRunAt" gorm:"index"`
	CreatedAt int64 `json:"createdAt"`
	UpdatedAt int64 `json:"updatedAt"`
}
