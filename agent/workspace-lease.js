import crypto from 'node:crypto';

const text = value => typeof value === 'string' ? value.trim() : '';

export class WorkspaceLeaseError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkspaceLeaseError';
    this.code = code;
    this.details = details;
    this.retryable = code === 'LEASE_EXPIRED' || code === 'WORKSPACE_UNAVAILABLE';
  }

  toJSON() {
    return { code: this.code, message: this.message, retryable: this.retryable, details: this.details };
  }
}

const leaseError = (code, message, details) => new WorkspaceLeaseError(code, message, details);

function ownerKey({ agentIdentity, hostSessionId, source }) {
  return [text(agentIdentity) || text(source) || 'unknown', text(hostSessionId)].join(':');
}

function view(lease) {
  if (!lease) return null;
  return {
    leaseId: lease.leaseId,
    agentIdentity: lease.agentIdentity,
    clientId: lease.clientId,
    projectId: lease.projectId,
    baseRevision: lease.baseRevision,
    issuedAt: lease.issuedAt,
    expiresAt: lease.expiresAt,
  };
}

/**
 * A process-local lease registry. Workflow truth remains in the visible
 * Browser Workflow; this object only prevents a command turn from silently
 * following a changed writer/project.
 */
export class WorkspaceLeaseManager {
  constructor({ ttlMs = 120_000, now = () => Date.now(), idFactory = () => crypto.randomUUID() } = {}) {
    this.ttlMs = Math.max(1, Number(ttlMs) || 120_000);
    this.now = now;
    this.idFactory = idFactory;
    this.byId = new Map();
    this.byOwner = new Map();
  }

  expire() {
    const now = this.now();
    for (const lease of this.byId.values()) {
      if (lease.expiresAt <= now) this.remove(lease);
    }
  }

  acquire({ agentIdentity, hostSessionId, source, clientId, projectId, baseRevision } = {}) {
    this.expire();
    const identity = text(agentIdentity) || text(source);
    const client = text(clientId);
    const project = text(projectId);
    if (!identity || !client || !project) {
      throw leaseError('WORKSPACE_UNAVAILABLE', '当前 Workflow 没有可租用的工作区目标。', { clientId: client || null, projectId: project || null });
    }
    const key = ownerKey({ agentIdentity: identity, hostSessionId, source });
    const existing = this.byOwner.get(key);
    if (existing) {
      if (existing.clientId !== client || existing.projectId !== project) {
        throw leaseError(
          'LEASE_TARGET_CHANGED',
          '当前 Agent turn 的 Workflow 目标已经改变；请结束当前任务后重新开始。',
          { leaseId: existing.leaseId, leaseProjectId: existing.projectId, requestedProjectId: project, leaseClientId: existing.clientId, requestedClientId: client },
        );
      }
      return this.renew(existing.leaseId);
    }
    const issuedAt = this.now();
    const lease = {
      leaseId: String(this.idFactory()),
      agentIdentity: identity,
      clientId: client,
      projectId: project,
      baseRevision: Number.isFinite(Number(baseRevision)) ? Number(baseRevision) : null,
      issuedAt,
      expiresAt: issuedAt + this.ttlMs,
      ownerKey: key,
    };
    this.byId.set(lease.leaseId, lease);
    this.byOwner.set(key, lease);
    return view(lease);
  }

  validate({ leaseId, agentIdentity, hostSessionId, source, clientId, projectId, currentClientId, currentProjectId, expectedRevision, currentRevision, mutationId, mutation = false } = {}) {
    this.expire();
    const id = text(leaseId);
    const lease = this.byId.get(id);
    if (!lease) throw leaseError('LEASE_EXPIRED', 'Workflow Lease 不存在或已经失效。', { leaseId: id || null });
    if (lease.expiresAt <= this.now()) {
      this.remove(lease);
      throw leaseError('LEASE_EXPIRED', 'Workflow Lease 已过期，请重新开始任务。', { leaseId: id });
    }
    const identity = text(agentIdentity) || text(source);
    if (identity && lease.agentIdentity !== identity) {
      throw leaseError('LEASE_TARGET_CHANGED', '当前 Agent 不能使用另一个 Agent 的 Workflow Lease。', { leaseId: id });
    }
    if (hostSessionId !== undefined || source !== undefined) {
      const requestedOwner = ownerKey({ agentIdentity: identity, hostSessionId, source });
      if (requestedOwner !== lease.ownerKey) throw leaseError('LEASE_TARGET_CHANGED', '当前 Agent Host Session 与 Workflow Lease 不匹配。', { leaseId: id });
    }
    if (clientId && lease.clientId !== text(clientId)) throw leaseError('LEASE_TARGET_CHANGED', 'Workflow Lease 的 Browser Writer 已改变。', { leaseId: id, leaseClientId: lease.clientId, requestedClientId: text(clientId) });
    if (projectId && lease.projectId !== text(projectId)) throw leaseError('LEASE_TARGET_CHANGED', 'Workflow Lease 的项目目标已改变。', { leaseId: id, leaseProjectId: lease.projectId, requestedProjectId: text(projectId) });
    if (currentClientId === null || currentProjectId === null) {
      throw leaseError('WORKSPACE_UNAVAILABLE', 'Workflow Browser 或当前项目已经不可用。', { leaseId: id, projectId: lease.projectId });
    }
    if (currentClientId !== undefined && text(currentClientId) !== lease.clientId) {
      throw leaseError('LEASE_TARGET_CHANGED', '当前 Active Browser Writer 已改变。', { leaseId: id, leaseClientId: lease.clientId, activeClientId: text(currentClientId) });
    }
    if (currentProjectId !== undefined && text(currentProjectId) !== lease.projectId) {
      throw leaseError('LEASE_TARGET_CHANGED', '当前 Active Workflow 项目已改变。', { leaseId: id, leaseProjectId: lease.projectId, activeProjectId: text(currentProjectId) });
    }
    if (mutation && !text(mutationId)) throw leaseError('INVALID_ARGUMENT', 'Workflow mutation 必须提供 mutationId。', { leaseId: id });
    if (expectedRevision !== undefined && expectedRevision !== null && currentRevision !== undefined && Number(expectedRevision) !== Number(currentRevision)) {
      throw leaseError('REVISION_CONFLICT', `Workflow 草稿版本已变化：期望 ${expectedRevision}，当前 ${currentRevision}。`, { leaseId: id, expectedRevision: Number(expectedRevision), actualRevision: Number(currentRevision) });
    }
    return this.renew(id);
  }

  renew(leaseId) {
    const lease = this.byId.get(text(leaseId));
    if (!lease || lease.expiresAt <= this.now()) {
      if (lease) this.remove(lease);
      throw leaseError('LEASE_EXPIRED', 'Workflow Lease 已过期，请重新开始任务。', { leaseId: text(leaseId) || null });
    }
    lease.expiresAt = this.now() + this.ttlMs;
    return view(lease);
  }

  release(leaseId) {
    const lease = this.byId.get(text(leaseId));
    if (!lease) return false;
    this.remove(lease);
    return true;
  }

  releaseOwner({ agentIdentity, hostSessionId, source } = {}) {
    const lease = this.byOwner.get(ownerKey({ agentIdentity, hostSessionId, source }));
    return lease ? this.release(lease.leaseId) : false;
  }

  revokeClient(clientId) {
    const client = text(clientId);
    for (const lease of [...this.byId.values()]) {
      if (lease.clientId === client) this.remove(lease);
    }
  }

  get(leaseId) {
    this.expire();
    return view(this.byId.get(text(leaseId)));
  }

  list() {
    this.expire();
    return [...this.byId.values()].map(view);
  }

  remove(lease) {
    this.byId.delete(lease.leaseId);
    if (this.byOwner.get(lease.ownerKey) === lease) this.byOwner.delete(lease.ownerKey);
  }
}
