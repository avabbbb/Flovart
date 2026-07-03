package model

import "time"

// Project 画布项目的只读镜像。前端画布保存时同步到组织库，供管理员查看。
// 不存完整画布数据，只存元信息用于管理列表展示。
type Project struct {
	ID              string     `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID           string     `gorm:"type:uuid;index;not null" json:"orgId"`
	OwnerID         string     `gorm:"type:uuid;index;not null" json:"ownerId"`
	Title           string     `gorm:"size:200;not null" json:"title"`
	NodeCount       int        `gorm:"not null;default:0" json:"nodeCount"`
	ConnectionCount int        `gorm:"not null;default:0" json:"connectionCount"`
	LastSyncedAt    *time.Time `json:"lastSyncedAt,omitempty"`
	CreatedAt       time.Time  `gorm:"index" json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}
