package model

// 权限点常量。后端硬编码全集，不动态增删。
const (
	PermOrgManage       = "org:manage"        // 改名/删除组织
	PermMemberInvite    = "member:invite"     // 邀请成员加入组织
	PermMemberManage    = "member:manage"      // 调整/移除成员、调整部门角色
	PermDeptManage      = "dept:manage"       // 部门 CRUD
	PermRoleManage      = "role:manage"       // 角色增删改
	PermCreditGrant     = "credit:grant"      // E2 占位
	PermCreditAdjust    = "credit:adjust"     // E2 占位
	PermAssetApprove    = "asset:approve"     // E3 占位
	PermAssetPublish    = "asset:publish"     // E3 占位
	PermWorkflowPublish = "workflow:publish" // 发布工作流
	PermViewAuditLog    = "view:audit_log"    // 审计日志
)

// AllPermissions 全量权限点。新增权限点时追加到此切片。
var AllPermissions = []string{
	PermOrgManage,
	PermMemberInvite,
	PermMemberManage,
	PermDeptManage,
	PermRoleManage,
	PermCreditGrant,
	PermCreditAdjust,
	PermAssetApprove,
	PermAssetPublish,
	PermWorkflowPublish,
	PermViewAuditLog,
}

// BuiltinOwnerPerks owner 预置角色拥有全部权限。
var BuiltinOwnerPerms = AllPermissions

// BuiltinAdminPerms admin 预置角色权限集：除 PermOrgManage 与 PermViewAuditLog 外全部。
var BuiltinAdminPerms = []string{
	PermMemberInvite,
	PermMemberManage,
	PermDeptManage,
	PermRoleManage,
	PermCreditGrant,
	PermCreditAdjust,
	PermAssetApprove,
	PermAssetPublish,
	PermWorkflowPublish,
}

// ValidPerm 判断字符串是否是已注册的权限点。
func ValidPerm(p string) bool {
	for _, x := range AllPermissions {
		if x == p {
			return true
		}
	}
	return false
}

// NormalizePerms 过滤输入权限点切片，剔除未注册项并去重，保序。
func NormalizePerms(in []string) []string {
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, p := range in {
		if !ValidPerm(p) {
			continue
		}
		if seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return out
}