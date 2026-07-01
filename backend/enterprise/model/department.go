package model

import (
	"time"

	"github.com/lib/pq"
)

// Department 部门，邻接表树（parent_id 自引用）
type Department struct {
	ID       string       `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID    string       `gorm:"type:uuid;index;not null" json:"orgId"`                         // 所属组织全
	ParentID *string      `gorm:"type:uuid;index" json:"parentId,omitempty"`                    // null = 顶层
	Parent   *Department  `gorm:"foreignKey:ParentID" json:"parent,omitempty"`
	Slug     string       `gorm:"size:80;index:idx_dept_org_slug,unique;not null" json:"slug"`    // 同组织内唯一
	Name     string       `gorm:"size:120;not null" json:"name"`
	Sort     int          `gorm:"default:0" json:"sort"`                                          // 同级排序
	Hidden   bool         `gorm:"default:false" json:"hidden"`                                   // 内部根部门（_all）对前端隐藏
	CreatedAt time.Time   `json:"createdAt"`
	UpdatedAt time.Time   `json:"updatedAt"`
}

// DepartmentMember 部门成员 + 部门内角色（多对多，一人可在多个部门）
// Roles 字段存 roleID uuid 数组，GORM + pg 数组类型自动序列化。
type DepartmentMember struct {
	ID        string         `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	DeptID    string         `gorm:"type:uuid;uniqueIndex:idx_dm_dept_user;not null" json:"deptId"`
	Dept      *Department    `gorm:"foreignKey:DeptID" json:"dept,omitempty"`
	UserID    string         `gorm:"type:uuid;uniqueIndex:idx_dm_dept_user;index;not null" json:"userId"`
	User      *User          `gorm:"foreignKey:UserID" json:"user,omitempty"`
	IsLead    bool           `gorm:"default:false" json:"isLead"`                                     // 部门负责人
	Roles     pq.StringArray `gorm:"type:uuid[]" json:"roles"`                                        // roleID uuid 数组，多角色
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
}