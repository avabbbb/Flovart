package repository

import (
	"gorm.io/gorm"
)

// RbacRepository 用 Postgres 递归 CTE 计算 user 在 org 的有效权限并集
// 算法：user 直接所属部门 ∪ 所有祖先部门 上该用户的 DeptMember.Roles 并集
//       再求这些 role 的 permissions 并集
type RbacRepository struct {
	db *gorm.DB
}

func NewRbacRepository(db *gorm.DB) *RbacRepository {
	return &RbacRepository{db: db}
}

const userPermsSQL = `
WITH RECURSIVE user_depts AS (
  SELECT dm.dept_id
  FROM department_members dm
  JOIN departments d ON d.id = dm.dept_id AND d.org_id = $2
  WHERE dm.user_id = $1
),
reachable AS (
  SELECT dept_id FROM user_depts
  UNION
  SELECT d.parent_id
  FROM reachable r JOIN departments d ON d.id = r.dept_id
  WHERE d.parent_id IS NOT NULL
),
user_roles AS (
  SELECT DISTINCT unnest(dm.roles) AS role_id
  FROM department_members dm
  WHERE dm.user_id = $1 AND dm.dept_id IN (SELECT dept_id FROM reachable)
)
SELECT DISTINCT unnest(r.permissions) AS perm
FROM user_roles ur JOIN roles r ON r.id = ur.role_id
`

// UserPerms 返回 user 在 org 的有效权限点集合
func (r *RbacRepository) UserPerms(orgID, userID string) (map[string]bool, error) {
	rows, err := r.db.Raw(userPermsSQL, userID, orgID).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	set := make(map[string]bool)
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		set[p] = true
	}
	return set, rows.Err()
}

// UserInOrg 判断 user 是否该 org 任一部门的成员（用于"组织成员即可"权限）
func (r *RbacRepository) UserInOrg(orgID, userID string) (bool, error) {
	var n int64
	err := r.db.Table("department_members dm").
		Joins("JOIN departments d ON d.id = dm.dept_id AND d.org_id = ?", orgID).
		Where("dm.user_id = ?", userID).
		Count(&n).Error
	return n > 0, err
}