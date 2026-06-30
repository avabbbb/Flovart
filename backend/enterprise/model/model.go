package model

import (
	"errors"
	"time"
)

// 角色枚举：owner 组织所有者；admin 管理员；member 普通成员
const (
	RoleOwner  = "owner"
	RoleAdmin  = "admin"
	RoleMember = "member"
)

func ValidRole(r string) bool {
	return r == RoleOwner || r == RoleAdmin || r == RoleMember
}

// CanManage 判断角色是否具备成员管理权
func CanManage(role string) bool {
	return role == RoleOwner || role == RoleAdmin
}

// Organization 企业组织
type Organization struct {
	ID        string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	Slug      string    `gorm:"size:80;uniqueIndex;not null" json:"slug"`
	Name      string    `gorm:"size:120;not null" json:"name"`
	OwnerID   string    `gorm:"type:uuid;index;not null" json:"ownerId"`
	Owner     *User     `gorm:"foreignKey:OwnerID" json:"owner,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// OrganizationMember 组织成员：组织 + 用户 + 角色
type OrganizationMember struct {
	ID        string       `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID     string       `gorm:"type:uuid;uniqueIndex:idx_org_user;not null" json:"orgId"`
	Org       *Organization `gorm:"foreignKey:OrgID" json:"org,omitempty"`
	UserID    string       `gorm:"type:uuid;uniqueIndex:idx_org_user;not null" json:"userId"`
	User      *User        `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Role      string       `gorm:"size:16;not null;default:'member'" json:"role"`
	CreatedAt time.Time    `json:"createdAt"`
	UpdatedAt time.Time    `json:"updatedAt"`
}

// User 只读引用 hub.users，本服务不创建。字段精简到管理后台需要
type User struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	Username  string    `gorm:"size:32" json:"username"`
	Email     string    `gorm:"size:255" json:"email"`
	Bio       string    `gorm:"size:500" json:"bio"`
	AvatarURL string    `gorm:"size:500" json:"avatarUrl"`
	Role      string    `gorm:"size:16" json:"role"` // hub 平台角色（user/admin）
	CreatedAt time.Time `json:"createdAt"`
}

func (User) TableName() string { return "users" } // 复用 hub 的 users 表

var ErrNotManaged = errors.New("无成员管理权限")