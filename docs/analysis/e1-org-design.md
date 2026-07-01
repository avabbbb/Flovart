# E1 组织架构（Department 树 + 自定义角色 + RBAC + 部门继承）设计稿

> 范围：enterprise 服务后端。前端管理 UI 留到 E1 末段再做。

## 一、数据模型

新增 3 张表，废弃 `OrganizationMember`（owner 改用 `Organization.OwnerID` 字段判断；"组织成员名册" = 该组织所有部门成员并集，不再单独表化）。

### 1. `Department`（部门，邻接表树）
```go
type Department struct {
    ID       string `gorm:"primaryKey;type:uuid;default:gen_random_uuid()"`
    OrgID    string `gorm:"type:uuid;index:idx_dept_org;not null"`           // 所属组织
    ParentID *string `gorm:"type:uuid;index"`                                 // null = 顶层
    Parent   *Department `gorm:"foreignKey:ParentID"`
    Slug     string `gorm:"size:80;uniqueIndex:idx_dept_org_slug;not null"`   // 同组织内唯一
    Name     string `gorm:"size:120;not null"`
    Sort     int    `gorm:"default:0"`                                         // 同级排序
    CreatedAt time.Time
    UpdatedAt time.Time
}
```
- 复合唯一索引 `(orgID, slug)`。
- `parent_id` 自引用。建树在后端递归或 Postgres 递归 CTE（见下"建树算法"）。

### 2. `DepartmentMember`（部门成员 + 部门内角色，多对多）
```go
type DepartmentMember struct {
    ID      string `gorm:"primaryKey;type:uuid;default:gen_random_uuid()"`
    DeptID  string `gorm:"type:uuid;uniqueIndex:idx_dm_dept_user;not null"`
    Dept    *Department `gorm:"foreignKey:DeptID"`
    UserID  string `gorm:"type:uuid;uniqueIndex:idx_dm_dept_user;not null"`
    User    *User  `gorm:"foreignKey:UserID"`
    IsLead  bool   `gorm:"default:false"`                                      // 部门负责人
    Roles   pq.StringArray `gorm:"type:uuid[]"`                                 // roleIDs 数组，多角色
    CreatedAt time.Time
    UpdatedAt time.Time
}
```
- 复合唯一索引 `(deptID, userID)`：一人同部门只有一条记录，但一人可在多个部门各一条。
- `Roles` 用 Postgres `uuid[]` 数组（GORM + `lib/pq` 的 `pq.StringArray` 自动支持），省一张 `MemberRole` 关联表，符合"能简单不引入复杂抽象"。
- `IsLead` 独立 bool 持久字段（用于"部门负责人"快速 filter 与 UI 展示），不混进 Roles。

### 3. `Role`（自定义角色 + 预置内置角色）
```go
type Role struct {
    ID          string `gorm:"primaryKey;type:uuid;default:gen_random_uuid()"`
    OrgID       string `gorm:"type:uuid;index:idx_role_org;not null"`
    Name        string `gorm:"size:32;not null"`                                // 同组织内唯一
    IsBuiltin   bool   `gorm:"default:false"`                                   // owner / admin 预置
    Permissions pq.StringArray `gorm:"type:text[]"`                             // 权限点 key 数组
    Sort        int    `gorm:"default:0"`
    CreatedAt   time.Time
    UpdatedAt   time.Time
}
```
- 复合唯一索引 `(orgID, name)`。
- 预置角色：创建组织时自动 seed `owner`（isBuiltin=true，全权限）和可选 `admin`（isBuiltin=true，除 `org:manage` `view:audit_log` 外全权限）。
- `IsBuiltin` 角色不能删，只能改语义上"可调"的 permissions 子集（或锁死不可改，便于一致性；MVP 锁死，admin/owner 语义固定）。
- 自定义角色由有 `role:manage` 权限的用户增删改。

## 二、权限点常量（后端硬编码）

`model/permissions.go`：
```go
const (
    PermOrgManage       = "org:manage"       // 改名/删除组织
    PermMemberInvite    = "member:invite"   // 邀请成员加入组织
    PermMemberManage    = "member:manage"   // 调整/移除成员、调整部门角色
    PermDeptManage      = "dept:manage"      // 部门 CRUD
    PermRoleManage      = "role:manage"      // 角色增删改
    PermCreditGrant     = "credit:grant"     // E2 占位
    PermCreditAdjust    = "credit:adjust"    // E2 占位
    PermAssetApprove    = "asset:approve"    // E3 占位
    PermAssetPublish    = "asset:publish"    // E3 占位
    PermWorkflowPublish = "workflow:publish" // 发布工作流
    PermViewAuditLog    = "view:audit_log"   // 审计日志
)

var AllPermissions = []string{...} // 上述全部
var BuiltinOwnerPerms = AllPermissions
var BuiltinAdminPerms = []string{all except PermOrgManage, PermViewAuditLog}
```

## 三、继承机制（用户拍板：本部门 ∪ 祖先部门 并集）

### 鉴权算法（组织级，输入 orgID+userID+requiredPerm）
```
1. 若 Organization.OwnerID == userID → 通过（owner 全权，含 builtin owner 角色）
2. 收集 user 在该 org 所有 DeptMember 记录 → DM_user = [{deptID, Roles}]
3. 对每个 DM_user，求该 dept 的祖先链 ancestors(D)（递归 parent_id 直到 null/根）
4. 用户在 dept D 的有效角色 = Roles(D ∪ ancestors(D) 上该用户的 DeptMember.Roles) 并集
5. 用户在 org 的有效角色集 = 所有 DM_user 的有效角色并集
6. effective_perms = 所有有效角色对应 Role.Permissions 并集
7. requiredPerm ∈ effective_perms → 通过
```

### 实现要点
- `ancestors(D)` 用 Postgres 递归 CTE 一次查询：
```sql
WITH RECURSIVE anc AS (
  SELECT id, parent_id FROM departments WHERE id = $1
  UNION ALL
  SELECT d.id, d.parent_id FROM departments d JOIN anc ON d.id = anc.parent_id
)
SELECT id FROM anc;
```
- 对每个 user 的 dept，只算"该 user 在 (dept ∪ ancestors) 上的 DeptMember"—可合并优化:
```sql
WITH RECURSIVE reachable AS (
  -- user 直接所属部门
  SELECT DISTINCT dept_id FROM department_members dm
  JOIN departments d ON d.id = dm.dept_id AND d.org_id = $org
  WHERE dm.user_id = $user
  UNION
  -- 向上扩展祖先
  SELECT d.parent_id FROM reachable r JOIN departments d ON d.id = r.dept_id
  WHERE d.parent_id IS NOT NULL
)
SELECT DISTINCT dm.roles FROM department_members dm
WHERE dm.user_id = $user AND dm.dept_id IN (SELECT reachable.dept_id FROM reachable);
```
  - 一次 SQL 拿到该用户在该 org 的"全部有效部门"上的 Roles 数组 → GORM 扁平化求 permissions 并集。
- 缓存：MVP 每次鉴权都查（部门数量 ≤几百时 query 数 <10ms 可接受）。后续视压测加内存缓存。

### 部门级资源（E3 才用到）
资源挂在具体部门 D_node 上时，用户对 D_node 资源的权限 = 用户在 (D_node ∪ ancestors(D_node)) 上角色的 permissions 并集（同等机制，仅把 reachable 起点换成 D_node 本身，role 由"user 在该路径上 deptMember 的 Roles"挑出）。

## 四、API（全部走 `/api/v1/enterprise`，Auth 中间件已接）

| Method | Path | 说明 | 需权限 |
|---|---|---|---|
| POST   | `/orgs/:id/departments` | 新建部门（可选 parentID） | `dept:manage` |
| GET    | `/orgs/:id/departments` | 部门树（递归一次构造，children 嵌套） | （组织成员即可） |
| PUT    | `/departments/:deptId` | 改名/slug/sort/移动到其他父部门 | `dept:manage` |
| DELETE | `/departments/:deptId` | 删除部门（要求无子部门、或子部门级联；成员需先迁出或一并移除根组织） | `dept:manage` |
| GET    | `/departments/:deptId/members` | 部门成员列表 | （组织成员即可） |
| POST   | `/departments/:deptId/members` | 加成员到部门（userID + isLead + roleIDs） | `member:invite` 或 `member:manage` |
| PUT    | `/departments/:deptId/members/:userId` | 调整 isLead / 角色列表 | `member:manage` |
| DELETE | `/departments/:deptId/members/:userId` | 移除部门成员 | `member:manage` |
| GET    | `/orgs/:id/roles` | 角色列表 | （组织成员即可） |
| POST   | `/orgs/:id/roles` | 创建自定义角色 | `role:manage` |
| PUT    | `/roles/:roleId` | 改角色 permissions/name | `role:manage` |
| DELETE | `/roles/:roleId` | 删自定义角色（builtin 不可删） | `role:manage` |
| GET    | `/orgs/:id/me/permissions` | 我在该组织的有效权限集（前端 UI 按钮显隐用） | — |

## 五、改造现状（破坏性，项目未上线不兼容旧数据）

- **删除** `model.OrganizationMember`、`model.ValidRole/CanManage/RoleOwner/RoleAdmin/RoleMember` 三档常量。
- **org_handler / org_service**：现有 8 个接口（Create/MyOrgs/Get/Delete + ListMembers/AddMember/UpdateMemberRole/RemoveMember）。重构方向：
  - Create 保留，创建时同时 seed 预置 `owner` 角色 + 创建一个"全员"根部门（slug=`_all`，owner 加入该根部门 IsLead=true Roles=[owner_id]）。
  - MyOrgs/Get/Delete 保留。
  - ListMembers 改成"按所有部门汇总成组织名册"（去重 userID + 合并展示所有部门+角色）。
  - AddMember（→ 现邀请进组织=加入根"全员"部门，默认 member 角色）改写后由新的 dept member API 取代。
  - UpdateMemberRole / RemoveMember 改写成调 dept member API（在哪个部门改就在哪个部门 API 上动）。
- **middleware/auth.go** 保留 JWT 解析，新增 `middleware/rbac.go` 提供 `RequirePerm(perm string) gin.HandlerFunc` 中间件，走上面"继承算法"。

## 六、实施分阶段（每段请示一次）

1. **M1 模型层**：新建 `model/department.go` `model/role.go` `model/permissions.go`；改 `model.go` 删 OrganizationMember 相关；改 main.go AutoMigrate。`pq.StringArray` 引入 `lib/pq` 依赖（hub 不用，仅 enterprise 加）。
2. **M2 鉴权与继承**：`repository/rbac_repository.go`（递归 CTE 计算 user 在 org 的有效 permissions 集合）；`middleware/rbac.go` `RequirePerm`。
3. **M3 部门/角色 API**：`service/dept_service.go` `service/role_service.go` + handler，main.go 注册路由。
4. **M4 现有 org API 重构**：org_service.go 重写（Create 时 seed 角色和根部门、ListMembers 汇总、AddMember 入根部门默认 member、RemoveMember 跨所有部门一并删）。
5. **M5 前端管理 UI**：企业后台 `/enterprise/departments` 部门树 + 成员抽屉 + `/enterprise/roles` 角色权限点勾选表。
6. 并同步更新 `docs/content/docs/backend/backend-database.mdx`。

## 七、未决次要项（不阻塞 M1，做 M5 时再拍）

- 级联删除策略：删部门时子部门是 `reparent 到上级` 还是 `一并删除`？— MVP 倾向"删前要求其无子部门（前端禁止删非叶）"。
- 组织级"全员根部门"`_all` 是否要向用户暴露（隐藏 vs 显示）。— 倾向隐藏并在 ListMembers 汇总时不展示。
- 角色跨组织共享：当前角色 OrgID 隔离，不允许跨 org 复用；未来若想要"组织模板角色"再加 `role_template` 表。
- 审计日志：`view:audit_log` 权限对应的日志表先不建，权限点先占位留到 e? 单独做。

---

请确认本设计稿后我从 M1 开始动手。