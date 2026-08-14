import { api, ENTERPRISE_BASE_URL, type HubUser } from './hubClient';
import type { AuditLog, Organization } from './orgApi';

export interface PlatformUser extends HubUser {
  status: 'active' | 'suspended' | 'deleted';
  createdAt: string;
  updatedAt: string;
}

export interface PageResult<T> {
  list: T[];
  total: number;
}

export const platformApi = {
  users: (search = '', page = 1, pageSize = 50) =>
    api.get<PageResult<PlatformUser>>(ENTERPRISE_BASE_URL, `/platform/users?search=${encodeURIComponent(search)}&page=${page}&pageSize=${pageSize}`),
  createUser: (body: { username: string; email: string; password: string; role: 'user' | 'admin' }) =>
    api.post<PlatformUser>(ENTERPRISE_BASE_URL, '/platform/users', body),
  updateUser: (userId: string, body: Partial<Pick<PlatformUser, 'username' | 'email' | 'role' | 'status'>>) =>
    api.put<PlatformUser>(ENTERPRISE_BASE_URL, `/platform/users/${userId}`, body),
  deleteUser: (userId: string) =>
    api.del<{ deleted: string }>(ENTERPRISE_BASE_URL, `/platform/users/${userId}`),
  organizations: (page = 1, pageSize = 50) =>
    api.get<PageResult<Organization>>(ENTERPRISE_BASE_URL, `/platform/organizations?page=${page}&pageSize=${pageSize}`),
  updateOrganization: (orgId: string, status: Organization['status']) =>
    api.put<{ orgId: string; status: Organization['status'] }>(ENTERPRISE_BASE_URL, `/platform/organizations/${orgId}`, { status }),
  auditLogs: (page = 1, pageSize = 50) =>
    api.get<PageResult<AuditLog>>(ENTERPRISE_BASE_URL, `/platform/audit-logs?page=${page}&pageSize=${pageSize}`),
};
