package model

import (
	"encoding/json"
	"time"
)

// ResourceLevel 资源密级分类。如：公开/内部/机密。
type ResourceLevel struct {
	ID        string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID     string    `gorm:"type:uuid;uniqueIndex:idx_rlevel_org_name;not null" json:"orgId"`
	Name      string    `gorm:"size:60;uniqueIndex:idx_rlevel_org_name;not null" json:"name"`
	Sort      int       `gorm:"default:0" json:"sort"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Resource 画布生成的图片/视频自动上传到组织资源库。
// Status: pending（待审核）/ approved（审核通过）/ rejected（驳回）/ published（已上架）
type Resource struct {
	ID         string          `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID      string          `gorm:"type:uuid;index;not null" json:"orgId"`
	UploaderID string          `gorm:"type:uuid;index;not null" json:"uploaderId"`
	Type       string          `gorm:"size:16;not null" json:"type"` // image|video
	Title      string          `gorm:"size:200" json:"title,omitempty"`
	StorageKey string          `gorm:"size:500" json:"storageKey,omitempty"`
	Href       string          `gorm:"size:1000" json:"href"`
	Thumbnail  string          `gorm:"size:1000" json:"thumbnail,omitempty"`
	LevelID    *string         `gorm:"type:uuid;index" json:"levelId,omitempty"`
	Level      *ResourceLevel  `gorm:"foreignKey:LevelID" json:"level,omitempty"`
	Status     string          `gorm:"size:16;index;not null;default:'pending'" json:"status"` // pending|approved|rejected|published
	Metadata   json.RawMessage `gorm:"type:jsonb" json:"metadata,omitempty"`                   // width/height/mimeType 等
	CreatedAt  time.Time       `gorm:"index" json:"createdAt"`
	UpdatedAt  time.Time       `json:"updatedAt"`
}

const (
	ResourceStatusPending   = "pending"
	ResourceStatusApproved  = "approved"
	ResourceStatusRejected  = "rejected"
	ResourceStatusPublished = "published"
)
