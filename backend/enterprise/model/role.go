package model

import (
	"time"

	"github.com/lib/pq"
)

// 角色类型：builtin owner/admin 或 custom
const (
	RoleTypeBuiltin = "builtin"
	RoleTypeCustom  = "custom"
)

// Role 角色 + 权限集（permissions 是权限点 key 数组）
// 复合唯一索引 (orgID, name) 在同组织内唯一。预置角色 IsBuiltin=true 不可删。
type Role struct {
	ID          string         `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID       string         `gorm:"type:uuid;index:idx_role_org_name,unique;not null" json:"orgId"`
	Name        string         `gorm:"size:32;index:idx_role_org_name,unique;not null" json:"name"`  // 同组织内唯一
	IsBuiltin   bool           `gorm:"default:false" json:"isBuiltin"`                                  // owner/admin 预置
	Permissions pq.StringArray `gorm:"type:text[]" json:"permissions"`                                  // 权限点 key 数组
	Sort        int            `gorm:"default:0" json:"sort"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
}

// HasPerm 角色是否具某权限点
func (r *Role) HasPerm(p string) bool {
	for _, x := range r.Permissions {
		if x == p {
			return true
		}
	}
	return false
}