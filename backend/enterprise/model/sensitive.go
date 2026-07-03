package model

import "time"

// SensitiveWord 敏感词库。生成请求前拦截检查。
// Action: block（直接拦截）/ warn（仅警告继续）/ review（标记待人工审核）
type SensitiveWord struct {
	ID        string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID     string    `gorm:"type:uuid;uniqueIndex:idx_sw_org_word;index;not null" json:"orgId"`
	Word      string    `gorm:"size:120;uniqueIndex:idx_sw_org_word;not null" json:"word"`
	Category  string    `gorm:"size:60;index;not null;default:'custom'" json:"category"` // politics|violence|adult|custom
	Action    string    `gorm:"size:16;not null;default:'block'" json:"action"`          // block|warn|review
	CreatedAt time.Time `gorm:"index" json:"createdAt"`
}

const (
	SensitiveActionBlock  = "block"
	SensitiveActionWarn   = "warn"
	SensitiveActionReview = "review"
)
