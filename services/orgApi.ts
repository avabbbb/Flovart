// 企业后台组织/部门/角色管理 API（M5：对齐 M4 后端契约）
import { api, ENTERPRISE_BASE_URL, type HubUser } from './hubClient';

export interface Organization {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Department {
  id: string;
  orgId: string;
  parentId: string | null;
  slug: string;
  name: string;
  sort: number;
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeptNode extends Department {
  children: DeptNode[];
}

export interface DepartmentMember {
  id: string;
  deptId: string;
  userId: string;
  isLead: boolean;
  roles: string[]; // 绑定在此部门的 roleID 数组
  createdAt: string;
  updatedAt: string;
  user?: HubUser;
}

export interface Role {
  id: string;
  orgId: string;
  name: string;
  isBuiltin: boolean;
  permissions: string[];
  sort: number;
  createdAt: string;
  updatedAt: string;
}

// 权限点全集（镜像后端 model.AllPermissions）
export const ALL_PERMISSIONS = [
  'org:manage',
  'member:invite',
  'member:manage',
  'dept:manage',
  'role:manage',
  'credit:grant',
  'credit:adjust',
  'asset:approve',
  'asset:publish',
  'workflow:publish',
  'view:audit_log',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export const orgApi = {
  // 组织
  create: (body: { slug: string; name: string }) =>
    api.post<Organization>(ENTERPRISE_BASE_URL, '/orgs', body),
  myOrgs: () => api.get<Organization[]>(ENTERPRISE_BASE_URL, '/orgs'),
  get: (id: string) => api.get<Organization>(ENTERPRISE_BASE_URL, `/orgs/${id}`),
  delete: (id: string) => api.del<{ deleted: string }>(ENTERPRISE_BASE_URL, `/orgs/${id}`),
  // 组织成员（M4：根部门快捷加入 / 跨部门汇总去重）
  members: (id: string) => api.get<DepartmentMember[]>(ENTERPRISE_BASE_URL, `/orgs/${id}/members`),
  addMember: (id: string, body: { byUsername: string }) =>
    api.post<DepartmentMember>(ENTERPRISE_BASE_URL, `/orgs/${id}/members`, body),
  removeMember: (id: string, userId: string) =>
    api.del<{ removed: string }>(ENTERPRISE_BASE_URL, `/orgs/${id}/members/${userId}`),
  // 我的有效权限集
  myPerms: (id: string) =>
    api.get<{ permissions: string[] }>(ENTERPRISE_BASE_URL, `/orgs/${id}/me/permissions`),
  // 部门树
  deptTree: (orgId: string) => api.get<DeptNode[]>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/departments`),
  createDept: (orgId: string, body: { slug: string; name: string; parentId?: string; sort?: number }) =>
    api.post<Department>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/departments`, body),
  updateDept: (deptId: string, body: { slug?: string; name?: string; parentId?: string; sort?: number }) =>
    api.put<Department>(ENTERPRISE_BASE_URL, `/departments/${deptId}`, body),
  deleteDept: (deptId: string) => api.del<{ deleted: string }>(ENTERPRISE_BASE_URL, `/departments/${deptId}`),
  // 部门成员
  deptMembers: (deptId: string) =>
    api.get<DepartmentMember[]>(ENTERPRISE_BASE_URL, `/departments/${deptId}/members`),
  addDeptMember: (deptId: string, body: { userId: string; isLead?: boolean; roleIds?: string[] }) =>
    api.post<DepartmentMember>(ENTERPRISE_BASE_URL, `/departments/${deptId}/members`, body),
  updateDeptMember: (deptId: string, userId: string, body: { isLead?: boolean; roleIds?: string[] }) =>
    api.put<DepartmentMember>(ENTERPRISE_BASE_URL, `/departments/${deptId}/members/${userId}`, body),
  removeDeptMember: (deptId: string, userId: string) =>
    api.del<{ removed: string }>(ENTERPRISE_BASE_URL, `/departments/${deptId}/members/${userId}`),
  // 角色
  roles: (orgId: string) => api.get<Role[]>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/roles`),
  createRole: (orgId: string, body: { name: string; permissions?: string[]; sort?: number }) =>
    api.post<Role>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/roles`, body),
  updateRole: (roleId: string, body: { name?: string; permissions?: string[]; sort?: number }) =>
    api.put<Role>(ENTERPRISE_BASE_URL, `/roles/${roleId}`, body),
  deleteRole: (roleId: string) => api.del<{ deleted: string }>(ENTERPRISE_BASE_URL, `/roles/${roleId}`),
};
