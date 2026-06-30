// 企业后台组织/成员管理 API
import { api, ENTERPRISE_BASE_URL, type HubUser } from './hubClient';

export type OrgRole = 'owner' | 'admin' | 'member';

export interface Organization {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgMember {
  id: string;
  orgId: string;
  userId: string;
  user: HubUser;
  role: OrgRole;
  createdAt: string;
}

export const orgApi = {
  create: (body: { slug: string; name: string }) =>
    api.post<Organization>(ENTERPRISE_BASE_URL, '/orgs', body),
  myOrgs: () => api.get<Organization[]>(ENTERPRISE_BASE_URL, '/orgs'),
  get: (id: string) => api.get<Organization>(ENTERPRISE_BASE_URL, `/orgs/${id}`),
  delete: (id: string) => api.del<{ deleted: string }>(ENTERPRISE_BASE_URL, `/orgs/${id}`),
  members: (id: string) => api.get<OrgMember[]>(ENTERPRISE_BASE_URL, `/orgs/${id}/members`),
  addMember: (id: string, body: { byUsername: string; role: OrgRole }) =>
    api.post<OrgMember>(ENTERPRISE_BASE_URL, `/orgs/${id}/members`, body),
  updateMemberRole: (id: string, userId: string, role: OrgRole) =>
    api.put<{ updated: string }>(ENTERPRISE_BASE_URL, `/orgs/${id}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) =>
    api.del<{ removed: string }>(ENTERPRISE_BASE_URL, `/orgs/${id}/members/${userId}`),
};