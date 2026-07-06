package model

import "time"

// OrgApiKey 组织集中管理的 API Key 池。成员不接触明文 Key，只通过代理端点间接使用。
// API Key 在数据库中以 AES-GCM 密文存储，API 响应始终掩码（仅末 4 位）。
type OrgApiKey struct {
	ID          string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID       string    `gorm:"type:uuid;uniqueIndex:idx_apikey_org_label;not null" json:"orgId"`
	Label       string    `gorm:"size:120;uniqueIndex:idx_apikey_org_label;not null" json:"label"` // "OpenAI 主Key"
	Provider    string    `gorm:"size:32;index;not null" json:"provider"`                          // openai|runninghub|anthropic|custom
	BaseURL     string    `gorm:"size:255" json:"baseUrl,omitempty"`
	APIKey      string    `gorm:"size:1000;not null" json:"-"`      // 密文存储，永不返回
	KeyHint     string    `gorm:"size:16" json:"keyHint,omitempty"` // 末 4 位，用于前端识别
	Enabled     bool      `gorm:"default:true" json:"enabled"`
	CreatedByID string    `gorm:"type:uuid;not null" json:"createdById"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// ModelPricing 模型单价配置。管理员为每个模型设置每次调用消耗的积分数。
type ModelPricing struct {
	ID          string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID       string    `gorm:"type:uuid;uniqueIndex:idx_pricing_org_model;not null" json:"orgId"`
	Provider    string    `gorm:"size:32;uniqueIndex:idx_pricing_org_model;not null" json:"provider"`
	Model       string    `gorm:"size:120;uniqueIndex:idx_pricing_org_model;not null" json:"model"`
	Mode        string    `gorm:"size:24;not null" json:"mode"` // image|video|text
	CostCredits int64     `gorm:"not null;default:1" json:"costCredits"`
	Enabled     bool      `gorm:"default:true" json:"enabled"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// MemberQuota 成员月度额度。每月可消耗的积分上限，超出则拦截。
type MemberQuota struct {
	ID            string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID         string    `gorm:"type:uuid;uniqueIndex:idx_quota_org_user;not null" json:"orgId"`
	UserID        string    `gorm:"type:uuid;uniqueIndex:idx_quota_org_user;index;not null" json:"userId"`
	MonthlyLimit  int64     `gorm:"not null;default:0" json:"monthlyLimit"` // 0 = 不限
	UsedThisMonth int64     `gorm:"not null;default:0" json:"usedThisMonth"`
	PeriodStart   time.Time `gorm:"not null" json:"periodStart"` // 当前计费周期起始日
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}
