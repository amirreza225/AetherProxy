package model

// Node represents a remote VPS running sing-box managed by AetherProxy.
type Node struct {
	Id         uint   `json:"id"         form:"id"         gorm:"primaryKey;autoIncrement"`
	Name       string `json:"name"        form:"name"`
	Host       string `json:"host"        form:"host"`
	SshPort    int    `json:"sshPort"     form:"sshPort"    gorm:"default:22"`
	SshKeyPath string `json:"sshKeyPath"  form:"sshKeyPath"`
	Provider   string `json:"provider"    form:"provider"`
	// Status values: "unknown" | "online" | "offline"
	Status   string `json:"status"    gorm:"default:unknown"`
	LastPing int64  `json:"lastPing"`
}

// EvasionEvent stores a detected censorship/blocking event scraped from external sources.
type EvasionEvent struct {
	Id       uint   `json:"id"       gorm:"primaryKey;autoIncrement"`
	DateTime int64  `json:"dateTime"`
	Source   string `json:"source"`
	Protocol string `json:"protocol"`
	Port     int    `json:"port"`
	Domain   string `json:"domain"`
	Detail   string `json:"detail"`
	// AutoAction is the suggested action taken: "" | "promote_hysteria2" | "manual"
	AutoAction string `json:"autoAction"`
}
