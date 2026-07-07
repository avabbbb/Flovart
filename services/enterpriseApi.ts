// 企业后台新 API 客户端 — 积分/API Key/定价/额度/资源/审批/敏感词/项目
import { api, ENTERPRISE_BASE_URL } from './hubClient';

// ===== 积分与计费 =====
export interface OrgCredit {
  id: string;
  orgId: string;
  balance: number;
  totalIn: number;
  totalOut: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreditTransaction {
  id: string;
  orgId: string;
  userId?: string;
  kind: string;
  amount: number;
  balanceAfter: number;
  refRequestId?: string;
  refUsageId?: string;
  reason?: string;
  createdAt: string;
}

export interface RechargeRequest {
  id: string;
  orgId: string;
  requestedBy: string;
  amount: number;
  priceCents: number;
  note?: string;
  status: string;
  reviewedBy?: string;
  reviewNote?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UsageRecord {
  id: string;
  orgId: string;
  userId: string;
  provider?: string;
  endpoint?: string;
  model?: string;
  mode?: string;
  costCredits: number;
  durationMs?: number;
  status: string;
  requestRef?: string;
  errorMsg?: string;
  createdAt: string;
}

export const creditApi = {
  balance: (orgId: string) =>
    api.get<OrgCredit>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/credit`),
  transactions: (orgId: string, page = 1, pageSize = 20) =>
    api.get<{ list: CreditTransaction[]; total: number }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/credit/transactions?page=${page}&pageSize=${pageSize}`),
  createRecharge: (orgId: string, body: { amount: number; priceCents?: number; note?: string }) =>
    api.post<RechargeRequest>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/credit/recharges`, body),
  listRecharges: (orgId: string, page = 1, pageSize = 20) =>
    api.get<{ list: RechargeRequest[]; total: number }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/credit/recharges?page=${page}&pageSize=${pageSize}`),
  cancelRecharge: (orgId: string, rechargeId: string) =>
    api.put<RechargeRequest>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/credit/recharges/${rechargeId}/cancel`, {}),
  reviewRecharge: (orgId: string, rechargeId: string, body: { approve: boolean; reviewNote?: string }) =>
    api.put<RechargeRequest>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/credit/recharges/${rechargeId}/review`, body),
  listUsage: (orgId: string, page = 1, pageSize = 20) =>
    api.get<{ list: UsageRecord[]; total: number }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/credit/usage?page=${page}&pageSize=${pageSize}`),
};

// ===== API Key 池 =====
export interface OrgApiKey {
  id: string;
  orgId: string;
  label: string;
  provider: string;
  baseUrl?: string;
  keyHint?: string;
  enabled: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelPricing {
  id: string;
  orgId: string;
  provider: string;
  model: string;
  mode: string;
  costCredits: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemberQuota {
  id: string;
  orgId: string;
  userId: string;
  monthlyLimit: number;
  usedThisMonth: number;
  periodStart: string;
  createdAt: string;
  updatedAt: string;
}

export const apiKeyApi = {
  list: (orgId: string) =>
    api.get<OrgApiKey[]>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/api-keys`),
  create: (orgId: string, body: { label: string; provider: string; baseUrl?: string; apiKey: string }) =>
    api.post<OrgApiKey>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/api-keys`, body),
  toggle: (orgId: string, keyId: string, enabled: boolean) =>
    api.put<OrgApiKey>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/api-keys/${keyId}`, { enabled }),
  delete: (orgId: string, keyId: string) =>
    api.del<{ deleted: string }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/api-keys/${keyId}`),
  listPricing: (orgId: string) =>
    api.get<ModelPricing[]>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/pricing`),
  createPricing: (orgId: string, body: { provider: string; model: string; mode: string; costCredits: number }) =>
    api.post<ModelPricing>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/pricing`, body),
  deletePricing: (orgId: string, pricingId: string) =>
    api.del<{ deleted: string }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/pricing/${pricingId}`),
  listQuotas: (orgId: string) =>
    api.get<MemberQuota[]>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/quotas`),
  updateQuota: (orgId: string, body: { userId: string; monthlyLimit: number }) =>
    api.put<MemberQuota>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/quotas`, body),
};

// ===== 资源管理 =====
export interface ResourceLevel {
  id: string;
  orgId: string;
  name: string;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface Resource {
  id: string;
  orgId: string;
  uploaderId: string;
  type: string;
  title?: string;
  storageKey?: string;
  href: string;
  thumbnail?: string;
  levelId?: string;
  level?: ResourceLevel;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const resourceApi = {
  listLevels: (orgId: string) =>
    api.get<ResourceLevel[]>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/resource-levels`),
  createLevel: (orgId: string, body: { name: string; sort?: number }) =>
    api.post<ResourceLevel>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/resource-levels`, body),
  deleteLevel: (orgId: string, levelId: string) =>
    api.del<{ deleted: string }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/resource-levels/${levelId}`),
  list: (orgId: string, page = 1, pageSize = 20, status?: string) =>
    api.get<{ list: Resource[]; total: number }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/resources?page=${page}&pageSize=${pageSize}${status ? `&status=${status}` : ''}`),
  create: (orgId: string, body: { type: string; title?: string; href: string; thumbnail?: string; storageKey?: string; levelId?: string }) =>
    api.post<Resource>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/resources`, body),
  get: (orgId: string, resId: string) =>
    api.get<Resource>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/resources/${resId}`),
  review: (orgId: string, resId: string, status: 'approved' | 'rejected') =>
    api.put<Resource>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/resources/${resId}/review`, { status }),
  publish: (orgId: string, resId: string) =>
    api.put<Resource>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/resources/${resId}/publish`, {}),
};

// ===== 审批 =====
export interface ApprovalWorkflow {
  id: string;
  orgId: string;
  name: string;
  targetType: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalNode {
  id: string;
  workflowId: string;
  nodeIndex: number;
  nodeType: string;
  approverType: string;
  approverIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRecord {
  id: string;
  orgId: string;
  workflowId: string;
  targetType: string;
  targetId: string;
  initiatorId: string;
  status: string;
  currentNodeIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalStep {
  id: string;
  recordId: string;
  nodeIndex: number;
  approverId: string;
  action: string;
  note?: string;
  actedAt: string;
}

export const approvalApi = {
  listWorkflows: (orgId: string) =>
    api.get<ApprovalWorkflow[]>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/approval-workflows`),
  createWorkflow: (orgId: string, body: { name: string; targetType: string; nodes: { nodeType?: string; approverType?: string; approverIds: string[] }[] }) =>
    api.post<ApprovalWorkflow>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/approval-workflows`, body),
  getWorkflow: (orgId: string, wfId: string) =>
    api.get<{ workflow: ApprovalWorkflow; nodes: ApprovalNode[] }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/approval-workflows/${wfId}`),
  deleteWorkflow: (orgId: string, wfId: string) =>
    api.del<{ deleted: string }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/approval-workflows/${wfId}`),
  submit: (orgId: string, body: { targetType: string; targetId: string }) =>
    api.post<ApprovalRecord>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/approvals/submit`, body),
  listRecords: (orgId: string, page = 1, pageSize = 20) =>
    api.get<{ list: ApprovalRecord[]; total: number }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/approvals?page=${page}&pageSize=${pageSize}`),
  getRecord: (orgId: string, recId: string) =>
    api.get<{ record: ApprovalRecord; steps: ApprovalStep[] }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/approvals/${recId}`),
  act: (orgId: string, recId: string, body: { action: 'approve' | 'reject'; note?: string }) =>
    api.put<ApprovalRecord>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/approvals/${recId}/act`, body),
};

// ===== 敏感词 =====
export interface SensitiveWord {
  id: string;
  orgId: string;
  word: string;
  category: string;
  action: string;
  createdAt: string;
}

export const sensitiveApi = {
  list: (orgId: string) =>
    api.get<SensitiveWord[]>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/sensitive-words`),
  create: (orgId: string, body: { word: string; category?: string; action?: string }) =>
    api.post<SensitiveWord>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/sensitive-words`, body),
  delete: (orgId: string, wordId: string) =>
    api.del<{ deleted: string }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/sensitive-words/${wordId}`),
  check: (orgId: string, text: string) =>
    api.post<{ blocked: string[]; warned: string[]; reviewed: string[]; hasBlock: boolean }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/sensitive-words/check`, { text }),
};

// ===== 项目镜像 =====
export interface Project {
  id: string;
  orgId: string;
  ownerId: string;
  title: string;
  nodeCount: number;
  connectionCount: number;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const projectApi = {
  sync: (orgId: string, body: { id: string; orgId: string; ownerId: string; title: string; nodeCount?: number; connectionCount?: number }) =>
    api.post<Project>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/projects/sync`, body),
  list: (orgId: string, page = 1, pageSize = 20) =>
    api.get<{ list: Project[]; total: number }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/projects?page=${page}&pageSize=${pageSize}`),
  delete: (orgId: string, projId: string) =>
    api.del<{ deleted: string }>(ENTERPRISE_BASE_URL, `/orgs/${orgId}/projects/${projId}`),
};
