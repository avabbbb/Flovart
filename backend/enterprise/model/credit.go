package model

import "time"

// OrgCredit 组织的总额度余额。每个组织至多一行（uniqueIndex: OrgID）。
// 余额变动必须放在事务里，配合 CreditTransaction 流水一同写入。
type OrgCredit struct {
	ID        string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID     string    `gorm:"type:uuid;uniqueIndex;not null" json:"orgId"`
	Org       *Organization `gorm:"foreignKey:OrgID" json:"org,omitempty"`
	Balance   int64     `gorm:"not null;default:0" json:"balance"`     // 当前可用余额（整数积分）
	TotalIn   int64     `gorm:"not null;default:0" json:"totalIn"`     // 历史累计充值
	TotalOut  int64     `gorm:"not null;default:0" json:"totalOut"`    // 历史累计消耗
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// CreditTransaction 每一笔额度变动流水。不可变。
// Kind: recharge（充值入账） / consume（调用消耗） / refund（失败退还） / adjust（人工调整） / grant（赠送）
type CreditTransaction struct {
	ID         string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID      string    `gorm:"type:uuid;index;not null" json:"orgId"`
	Org        *Organization `gorm:"foreignKey:OrgID" json:"org,omitempty"`
	UserID     string    `gorm:"type:uuid;index" json:"userId,omitempty"`     // 触发者（消耗/退还时为调用成员）
	Kind       string    `gorm:"size:16;index;not null" json:"kind"`          // recharge|consume|refund|adjust|grant
	Amount     int64     `gorm:"not null" json:"amount"`                       // 正数为入账，负数为扣减
	BalanceAfter int64   `gorm:"not null" json:"balanceAfter"`                // 本次变动后余额，便于审计
	RefRequestID string `gorm:"type:uuid;index" json:"refRequestId,omitempty"`   // 关联的 RechargeRequest ID（充值入账时填）
	RefUsageID  string   `gorm:"type:uuid;index" json:"refUsageId,omitempty"`    // 关联的 UsageRecord ID（消耗/退还时填）
	Reason     string   `gorm:"size:200" json:"reason,omitempty"`             // 人工备注/失败原因
	CreatedAt  time.Time `gorm:"index" json:"createdAt"`
}

// RechargeRequest 组织充值申请。由 org owner 自助提交，hub 平台 admin 审批。
// Status: pending（待审） / approved（已审批并已入账） / rejected（被驳回） / cancelled（提交者撤销）
type RechargeRequest struct {
	ID          string     `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID       string     `gorm:"type:uuid;index;not null" json:"orgId"`
	Org         *Organization `gorm:"foreignKey:OrgID" json:"org,omitempty"`
	RequestedBy string     `gorm:"type:uuid;not null" json:"requestedBy"`     // 提交人（通常为 org owner）
	Amount      int64      `gorm:"not null" json:"amount"`                    // 申请入账的积分数量
	PriceCents  int64      `gorm:"default:0" json:"priceCents,omitempty"`     // 约定的人民币金额（分），全流程不真实收钱，仅账面留存
	Note        string     `gorm:"size:500" json:"note,omitempty"`           // 提交人备注（合同号/转账证明等）
	Status      string     `gorm:"size:16;index;not null;default:'pending'" json:"status"` // pending|approved|rejected|cancelled
	ReviewedBy  string     `gorm:"type:uuid;index" json:"reviewedBy,omitempty"`        // 平台 admin ID
	ReviewNote  string     `gorm:"size:500" json:"reviewNote,omitempty"`
	ReviewedAt  *time.Time `json:"reviewedAt,omitempty"`
	CreatedAt   time.Time  `gorm:"index" json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// UsageRecord 每次代理 AI 调用的用量记录。即使最终被退款也保留，退款方向用 Refund 流水表达。
// Status: success / failed / refunded
type UsageRecord struct {
	ID          string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID       string    `gorm:"type:uuid;index;not null" json:"orgId"`
	UserID      string    `gorm:"type:uuid;index;not null" json:"userId"`        // 发起调用的成员
	Provider    string    `gorm:"size:32;index" json:"provider,omitempty"`       // runninghub | openai | ...
	Endpoint    string    `gorm:"size:120;index" json:"endpoint,omitempty"`      // 具体接口标识
	Model       string    `gorm:"size:120" json:"model,omitempty"`
	Mode        string    `gorm:"size:24;index" json:"mode,omitempty"`           // image | video | text
	CostCredits int64     `gorm:"not null;default:0" json:"costCredits"`         // 本次被扣额度（成功时为正，失败应退还）
	DurationMs  int64     `gorm:"default:0" json:"durationMs,omitempty"`
	Status      string    `gorm:"size:16;index;not null;default:'success'" json:"status"` // success|failed|refunded
	RequestRef  string    `gorm:"size:120;index" json:"requestRef,omitempty"`    // 业务侧的 requestId（前端可关联）
	ErrorMsg    string    `gorm:"size:500" json:"errorMsg,omitempty"`
	CreatedAt   time.Time `gorm:"index" json:"createdAt"`
}

// 用量计分参考：1 积分 = 1 次基础调用；不同模式/Provider 可以后续调整系数
const (
	UsageStatusSuccess  = "success"
	UsageStatusFailed   = "failed"
	UsageStatusRefunded = "refunded"
)

const (
	RechargeStatusPending   = "pending"
	RechargeStatusApproved  = "approved"
	RechargeStatusRejected  = "rejected"
	RechargeStatusCancelled = "cancelled"
)

const (
	TxKindRecharge = "recharge"
	TxKindConsume  = "consume"
	TxKindRefund   = "refund"
	TxKindAdjust   = "adjust"
	TxKindGrant    = "grant"
)