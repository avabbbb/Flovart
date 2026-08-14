package model

import "time"

type AuditLog struct {
	ID         string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID      string    `gorm:"size:64;index" json:"orgId,omitempty"`
	ActorID    string    `gorm:"size:64;index;not null" json:"actorId"`
	Method     string    `gorm:"size:12;index;not null" json:"method"`
	Route      string    `gorm:"size:255;index;not null" json:"route"`
	StatusCode int       `gorm:"index;not null" json:"statusCode"`
	RequestID  string    `gorm:"size:64;index;not null" json:"requestId"`
	IP         string    `gorm:"size:64" json:"ip"`
	UserAgent  string    `gorm:"size:500" json:"userAgent"`
	CreatedAt  time.Time `gorm:"index" json:"createdAt"`
}
