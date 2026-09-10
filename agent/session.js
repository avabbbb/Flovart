import crypto from 'node:crypto';
import { WorkspaceLeaseError, WorkspaceLeaseManager } from './workspace-lease.js';

const sendEvent = (response, type, payload) => response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);

const HOST_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const LEASED_WORKFLOW_COMMANDS = new Set([
  'workflow.inspect', 'workflow.selection.get', 'workflow.apply', 'workflow.node.run', 'workflow.node.stop',
  'workflow.node.create', 'workflow.node.create-connected', 'workflow.node.update', 'workflow.node.delete',
  'workflow.node.move', 'workflow.node.resize', 'workflow.node.tool', 'workflow.connect', 'workflow.disconnect',
  'workflow.select', 'workflow.viewport.set',
]);

export class WorkflowAgentSessionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkflowAgentSessionError';
    this.code = code;
    this.details = details;
    this.retryable = ['LINK_OFFLINE', 'WORKSPACE_UNAVAILABLE', 'LEASE_EXPIRED'].includes(code);
  }

  toJSON() {
    return { code: this.code, message: this.message, retryable: this.retryable, details: this.details };
  }
}

const hostWriterView = writer => writer
  ? {
    agentIdentity: writer.agentIdentity,
    projectId: writer.projectId || null,
    hasSessionId: Boolean(writer.hostSessionId),
  }
  : null;

function sessionError(code, message, details) {
  return new WorkflowAgentSessionError(code, message, details);
}

export class WorkflowAgentSession {
  constructor({ timeoutMs = 60000, isKnownAgentIdentity, workspaceLease } = {}) {
    this.timeoutMs = timeoutMs;
    this.clients = new Map();
    this.pending = new Map();
    this.snapshot = null;
    this.snapshots = new Map();
    this.activeClientId = null;
    this.activeHostWriter = null;
    this.isKnownAgentIdentity = isKnownAgentIdentity;
    this.workspaceLease = workspaceLease || new WorkspaceLeaseManager();
  }

  health() {
    return {
      ok: true,
      hasWorkflow: Boolean(this.snapshot),
      clients: this.clients.size,
      pending: this.pending.size,
      activeProjectId: this.snapshot?.id || null,
      snapshotUpdatedAt: this.snapshot?.snapshotUpdatedAt || null,
      clientId: this.activeClientId || this.snapshot?.clientId || null,
      revision: this.snapshot?.draftVersion ?? this.snapshot?.revision ?? null,
      activeWriter: this.activeClientId ? { clientId: this.activeClientId, projectId: this.snapshot?.id || null } : null,
      activeHostWriter: hostWriterView(this.activeHostWriter),
    };
  }

  openEvents(url, response) {
    const clientId = url.searchParams.get('clientId') || crypto.randomUUID();
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    this.clients.set(clientId, response);
    sendEvent(response, 'hello', { ok: true, clientId });
    const timer = setInterval(() => sendEvent(response, 'ping', { time: Date.now() }), 15000);
    response.on('close', () => {
      clearInterval(timer);
      // A reconnect may reuse a client id before the old SSE response emits
      // `close`. Never let the old response evict the replacement session.
      if (this.clients.get(clientId) !== response) return;
      this.clients.delete(clientId);
      this.snapshots.delete(clientId);
      this.workspaceLease.revokeClient(clientId);
      if (this.activeClientId === clientId) {
        const projectId = this.snapshot?.id || null;
        this.activeClientId = null;
        this.snapshot = null;
        this.emit('writer_unavailable', { clientId, projectId });
      }
      this.pending.forEach((pending, requestId) => {
        if (pending.clientId !== clientId) return;
        this.pending.delete(requestId);
        pending.reject(sessionError('WORKSPACE_UNAVAILABLE', 'Flovart 浏览器连接已断开，当前 Workflow 不可用。', { clientId }));
      });
    });
  }

  updateSnapshot(snapshot, clientId) {
    const next = {
      ...(snapshot && typeof snapshot === 'object' ? snapshot : {}),
      clientId,
      snapshotUpdatedAt: new Date().toISOString(),
    };
    if (clientId) {
      this.snapshots.delete(clientId);
      this.snapshots.set(clientId, next);
      // The first visible browser claims the writer slot. A second tab may
      // publish a snapshot, but it cannot silently steal the active writer.
      if (!this.activeClientId || !this.clients.has(this.activeClientId)) {
        this.activeClientId = clientId;
        this.snapshot = next;
        this.emit('writer_changed', { clientId, projectId: next.id || null });
      } else if (this.activeClientId === clientId) {
        this.snapshot = next;
      }
    } else {
      this.snapshot = next;
    }
  }

  activateClient({ clientId, projectId } = {}) {
    const id = String(clientId || '');
    const snapshot = this.snapshots.get(id);
    if (!id || !snapshot || !this.clients.has(id)) throw new Error('指定的 Browser Workflow 不可用。');
    if (projectId && String(projectId) !== String(snapshot.id || '')) throw new Error(`Workflow Browser binding 不匹配：${projectId}`);
    this.activeClientId = id;
    this.snapshot = snapshot;
    this.emit('writer_changed', { clientId: id, projectId: snapshot.id || null });
    return { clientId: id, projectId: snapshot.id || null, revision: snapshot.draftVersion ?? snapshot.revision ?? null };
  }

  normalizeAgentIdentity(value) {
    const id = String(value || '').trim().toLowerCase();
    if (!HOST_ID_PATTERN.test(id)) throw sessionError('INVALID_ARGUMENT', 'Agent Identity 无效。');
    if (this.isKnownAgentIdentity && !this.isKnownAgentIdentity(id)) {
      throw sessionError('UNKNOWN_AGENT_HOST', `未注册的 Agent Identity：${id}`);
    }
    return id;
  }

  hostWriterState() {
    return hostWriterView(this.activeHostWriter);
  }

  acquireWorkspaceLease(input) {
    try {
      return this.workspaceLease.acquire(input);
    } catch (cause) {
      if (cause instanceof WorkspaceLeaseError) throw sessionError(cause.code, cause.message, cause.details);
      throw cause;
    }
  }

  validateWorkspaceLease(input) {
    try {
      return this.workspaceLease.validate(input);
    } catch (cause) {
      if (cause instanceof WorkspaceLeaseError) throw sessionError(cause.code, cause.message, cause.details);
      throw cause;
    }
  }

  renewWorkspaceLease(leaseId) {
    try {
      return this.workspaceLease.renew(leaseId);
    } catch (cause) {
      if (cause instanceof WorkspaceLeaseError) throw sessionError(cause.code, cause.message, cause.details);
      throw cause;
    }
  }

  releaseWorkspaceLease(leaseId) {
    return this.workspaceLease.release(leaseId);
  }

  workspaceLeaseState() {
    return this.workspaceLease.list();
  }

  expireWorkspaceLeases() {
    this.workspaceLease.expire();
    return this.workspaceLease.list();
  }

  isLeasedWorkflowCommand(command) {
    return LEASED_WORKFLOW_COMMANDS.has(command);
  }

  browserLeaseContext(boundSnapshot, clientId, args = {}) {
    return {
      clientId,
      projectId: String(args.projectId || boundSnapshot?.id || ''),
      currentClientId: clientId,
      currentProjectId: boundSnapshot?.id || null,
      currentRevision: boundSnapshot?.draftVersion ?? boundSnapshot?.revision ?? 1,
    };
  }

  ensureWorkspaceLease({ command, args, source, caller, context, idempotencyKey }) {
    if (!this.isLeasedWorkflowCommand(command)) return null;
    const identity = caller?.agentIdentity || source;
    const hostSessionId = caller?.hostSessionId || null;
    const explicitLeaseId = args.leaseId || args['lease-id'];
    const mutation = !['workflow.inspect', 'workflow.selection.get'].includes(command);
    const mutationId = args.mutationId || args['mutation-id'] || args.idempotencyKey || args['idempotency-key'] || idempotencyKey;
    try {
      const lease = explicitLeaseId
        ? this.workspaceLease.validate({
          leaseId: explicitLeaseId,
          agentIdentity: identity,
          hostSessionId,
          source,
          ...context,
          mutationId,
          mutation,
          expectedRevision: args.expectedRevision,
        })
        : this.workspaceLease.acquire({
          agentIdentity: identity,
          hostSessionId,
          source,
          clientId: context.clientId,
          projectId: context.projectId,
          baseRevision: context.currentRevision,
        });
      return this.workspaceLease.validate({
        leaseId: lease.leaseId,
        agentIdentity: identity,
        hostSessionId,
        source,
        ...context,
        mutationId,
        mutation,
        expectedRevision: args.expectedRevision,
      });
    } catch (cause) {
      if (cause instanceof WorkspaceLeaseError) throw sessionError(cause.code, cause.message, cause.details);
      throw cause;
    }
  }

  activateAgentHost({ agentIdentity, hostSessionId, projectId } = {}) {
    const id = this.normalizeAgentIdentity(agentIdentity);
    const sessionId = hostSessionId === undefined || hostSessionId === null || hostSessionId === ''
      ? null
      : String(hostSessionId).trim().slice(0, 500);
    if (hostSessionId !== undefined && !sessionId) throw sessionError('INVALID_ARGUMENT', 'hostSessionId 不能为空。');
    const requestedProject = projectId === undefined || projectId === null || projectId === ''
      ? this.snapshot?.id || null
      : String(projectId).trim();
    if (projectId !== undefined && !requestedProject) throw sessionError('INVALID_ARGUMENT', 'projectId 不能为空。');
    if (requestedProject && this.snapshot?.id && requestedProject !== this.snapshot.id) {
      throw sessionError(
        'AGENT_PROJECT_INACTIVE',
        '当前 Browser Writer 没有激活这个 Workflow 项目；请先激活对应的 Browser 页面。',
        { activeProjectId: this.snapshot.id, requestedProjectId: requestedProject },
      );
    }
    const previous = this.activeHostWriter;
    const sameIdentity = previous?.agentIdentity === id;
    if (sameIdentity && previous.hostSessionId && sessionId && previous.hostSessionId !== sessionId) {
      throw sessionError('AGENT_HOST_SESSION_MISMATCH', '当前 Agent Host Session 不匹配，请先显式结束旧会话。', { agentIdentity: id });
    }
    const next = {
      agentIdentity: id,
      hostSessionId: sessionId || (sameIdentity ? previous.hostSessionId : null),
      projectId: requestedProject,
    };
    this.activeHostWriter = next;
    this.emit('host_writer_changed', {
      previous: hostWriterView(previous),
      active: hostWriterView(next),
    });
    return {
      activeHostWriter: hostWriterView(next),
      switched: Boolean(previous && (previous.agentIdentity !== next.agentIdentity || previous.projectId !== next.projectId)),
    };
  }

  authorizeExternalHost(caller, args = {}) {
    const requestedIdentity = caller?.agentIdentity;
    const requestedProject = args.projectId || this.snapshot?.id || null;
    const requestedSession = caller?.hostSessionId ? String(caller.hostSessionId).trim() : null;
    const active = this.activeHostWriter;
    if (!requestedIdentity) {
      if (active) throw sessionError(
        'AGENT_HOST_REQUIRED',
        `当前 Workflow 由 ${active.agentIdentity} 控制；请使用当前 Host Projection 再继续。`,
        { activeHostWriter: hostWriterView(active) },
      );
      return;
    }
    const identity = this.normalizeAgentIdentity(requestedIdentity);
    if (!active) {
      this.activeHostWriter = { agentIdentity: identity, hostSessionId: requestedSession, projectId: requestedProject };
      this.emit('host_writer_changed', { previous: null, active: hostWriterView(this.activeHostWriter) });
      return;
    }
    if (active.agentIdentity !== identity) throw sessionError(
      'AGENT_WRITER_INACTIVE',
      `${identity} 不是当前 Workflow 的 Active Host；请先在 Flovart Host Picker 显式切换。`,
      { activeHostWriter: hostWriterView(active), requestedAgentIdentity: identity },
    );
    if (active.hostSessionId && active.hostSessionId !== requestedSession) {
      throw sessionError('AGENT_HOST_SESSION_MISMATCH', '当前 Agent Host Session 不匹配，请重新建立 Host 会话。', { agentIdentity: identity });
    }
    if (active.projectId && requestedProject && active.projectId !== requestedProject) throw sessionError(
      'AGENT_PROJECT_INACTIVE',
      '当前 Agent Host 没有激活这个 Workflow 项目；请在 Flovart 中显式激活当前项目。',
      { activeHostWriter: hostWriterView(active), requestedProjectId: requestedProject },
    );
  }

  emit(type, payload) {
    this.clients.forEach((client, clientId) => {
      try { sendEvent(client, type, payload); }
      catch {
        this.clients.delete(clientId);
        try { client.end(); } catch { /* connection already closed */ }
      }
    });
  }

  resolveResult({ requestId, clientId, result, error }) {
    const pending = requestId ? this.pending.get(requestId) : null;
    if (!pending) return false;
    if (clientId && pending.clientId !== clientId) return false;
    this.pending.delete(requestId);
    error ? pending.reject(new Error(typeof error === 'string' ? error : error.message || 'Workflow command failed')) : pending.resolve(result);
    return true;
  }

  async callCommand(command, args = {}, source = 'mcp', idempotencyKey, signal, caller) {
    if (command === 'status') {
      return {
        ok: true,
        result: {
          surface: 'agent-session',
          authority: 'browser-workflow',
          ...this.health(),
        },
      };
    }
    const workspaceMode = args?.workspaceMode;
    if (command.startsWith('workflow.') && (workspaceMode === 'native' || workspaceMode === 'headless')) {
      throw sessionError('WORKSPACE_REQUIRED', 'Workflow 命令必须通过可见的 Browser Workflow 执行；隐藏工作区不可用。');
    }
    const requestedClientId = typeof args?.clientId === 'string' && args.clientId ? args.clientId : null;
    const boundSnapshot = requestedClientId ? this.snapshots.get(requestedClientId) : this.snapshot;
    if (command.startsWith('workflow.') && requestedClientId && !this.clients.has(requestedClientId)) {
      throw sessionError('WORKSPACE_UNAVAILABLE', '指定的 Flovart Workflow 页面已经不可用。', { clientId: requestedClientId });
    }
    if (command.startsWith('workflow.') && requestedClientId && requestedClientId !== this.activeClientId) {
      throw sessionError('LEASE_TARGET_CHANGED', '指定的 Flovart Workflow 不是当前可写页面。', { clientId: requestedClientId, activeClientId: this.activeClientId });
    }
    const clientId = this.clients.has(boundSnapshot?.clientId) ? boundSnapshot.clientId : null;
    if (args?.projectId && boundSnapshot?.id && args.projectId !== boundSnapshot.id) {
      throw sessionError('LEASE_TARGET_CHANGED', `Workflow 项目目标已改变：${args.projectId}`, { requestedProjectId: args.projectId, activeProjectId: boundSnapshot.id });
    }
    const client = this.clients.get(clientId);
    if (!client) throw sessionError('WORKSPACE_UNAVAILABLE', '当前没有已连接并同步项目的 Flovart Workflow。');
    if (command.startsWith('workflow.') && (source === 'cli' || (source === 'mcp' && caller))) {
      this.authorizeExternalHost(caller, args);
    }
    const lease = this.ensureWorkspaceLease({ command, args, source, caller, idempotencyKey, context: this.browserLeaseContext(boundSnapshot, clientId, args) });
    if (signal?.aborted) throw new Error('Workflow 操作已取消');
    const requestId = crypto.randomUUID();
    const forwardedArgs = { ...args };
    delete forwardedArgs.leaseId;
    delete forwardedArgs['lease-id'];
    const envelope = {
      id: requestId,
      command,
      args: forwardedArgs,
      source,
      idempotencyKey: idempotencyKey || args.idempotencyKey,
      ...(lease ? { workspaceLease: lease } : {}),
      ...(caller ? { caller } : {}),
    };
    sendEvent(client, 'tool_call', { requestId, envelope });
    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const onAbort = () => {
        this.pending.delete(requestId);
        cleanup();
        reject(new Error('Workflow 操作已取消'));
      };
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        cleanup();
        reject(new Error('Workflow 操作超时'));
      }, this.timeoutMs);
      this.pending.set(requestId, {
        clientId,
        resolve: value => { clearTimeout(timer); cleanup(); resolve(value); },
        reject: error => { clearTimeout(timer); cleanup(); reject(error); },
      });
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
