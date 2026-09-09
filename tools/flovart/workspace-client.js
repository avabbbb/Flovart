import { existsSync } from 'node:fs';
// 仓库开发时读 agent/config.js；npm 打包后读 managed-agent/config.js（prepare-package 复制）。
const configModule = await import('./managed-agent/config.js').catch(() => import('../../agent/config.js'));
const { AGENT_CONFIG_FILE, loadAgentConfig } = configModule;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export class WorkspaceClientError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'WorkspaceClientError';
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.details = options.details ?? null;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
      actionUrl: null,
    };
  }
}

function workspaceError(code, message, options) {
  return new WorkspaceClientError(code, message, options);
}

export function workspaceConfigMissingMessage(os = process.platform, env = process.env) {
  return os === 'linux' && env.WSL_DISTRO_NAME
    ? 'WSL 中未找到 Flovart Agent 配置。请在同一 WSL 发行版运行本地 Agent 服务；如果 Agent 运行在 Windows，请设置 FLOVART_AGENT_CONFIG 指向 /mnt/c/Users/<user>/.flovart/agent.json，并启用 WSL mirrored networking。'
    : '未找到 Flovart Workspace Adapter 配置。请先在当前用户环境启动本地 Agent 服务。';
}

function defaultConfig() {
  if (!existsSync(AGENT_CONFIG_FILE)) {
    throw workspaceError('WORKSPACE_UNAVAILABLE', workspaceConfigMissingMessage(), { retryable: true });
  }
  return loadAgentConfig(false);
}

function normalizeConfig(config) {
  let url;
  try {
    url = new URL(config?.url);
  } catch {
    throw workspaceError('WORKSPACE_UNAVAILABLE', 'Flovart Workspace Adapter 配置无效。', { retryable: false });
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw workspaceError('WORKSPACE_UNAVAILABLE', 'Workspace Adapter 只允许使用本机 loopback HTTP。', { retryable: false });
  }
  const token = String(config?.token || '');
  if (!token) throw workspaceError('WORKSPACE_UNAVAILABLE', 'Workspace Adapter 缺少本机连接 Token。', { retryable: false });
  return { url: url.origin, token };
}

export class FlovartWorkspaceClient {
  constructor(options = {}) {
    this.config = normalizeConfig(options.config || defaultConfig());
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || 35_000;
  }

  async request(path, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(new URL(path, this.config.url), {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          'x-flovart-agent-token': this.config.token,
          ...(init.headers || {}),
        },
      });
    } catch {
      throw workspaceError(
        'WORKSPACE_UNAVAILABLE',
        'Flovart Workspace Adapter 未运行。请启动本地 Agent 服务，并在 Workflow 的本地 Agent 面板建立连接。',
        { retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.ok === false) {
      const message = body?.error?.message || body?.error || `Workspace Adapter 返回 HTTP ${response.status}`;
      const unavailable = /没有已连接|连接已断开|未运行/i.test(String(message));
      const code = body?.error?.code
        || (unavailable
          ? 'WORKSPACE_UNAVAILABLE'
          : response.status === 504
            ? 'WORKSPACE_TIMEOUT'
            : 'WORKSPACE_COMMAND_FAILED');
      throw workspaceError(
        code,
        String(message),
        {
          retryable: typeof body?.error?.retryable === 'boolean' ? body.error.retryable : unavailable || response.status >= 500,
          details: body?.error?.details ?? null,
        },
      );
    }
    return body;
  }

  async status() {
    const body = await this.request('/health');
    return {
      authority: 'browser-workspace',
      state: body.hasWorkflow && body.clients > 0 ? 'ready' : 'disconnected',
      hasWorkflow: Boolean(body.hasWorkflow),
      clients: Number(body.clients || 0),
      pending: Number(body.pending || 0),
      activeProjectId: body.activeProjectId || null,
      snapshotUpdatedAt: body.snapshotUpdatedAt || null,
      clientId: body.clientId || null,
      revision: body.revision === undefined || body.revision === null || body.revision === ''
        ? null
        : Number.isFinite(Number(body.revision)) ? Number(body.revision) : null,
      activeHostWriter: body.activeHostWriter || null,
    };
  }

  async executeEnvelope(envelope) {
    const body = await this.request('/api/tools', {
      method: 'POST',
      body: JSON.stringify({
        command: envelope.command,
        args: envelope.args || {},
        source: envelope.source || 'cli',
        idempotencyKey: envelope.idempotencyKey,
        ...(envelope.caller ? { caller: envelope.caller } : {}),
      }),
    });
    return body.result;
  }

  async execute(command, args = {}, source = 'mcp', options = {}) {
    return this.executeEnvelope({
      command,
      args,
      source,
      idempotencyKey: options.idempotencyKey,
    });
  }
}

export function createWorkspaceFacade(client) {
  return {
    workflow: {
      dispatch: envelope => client.executeEnvelope(envelope),
    },
  };
}

export class CrewClientError extends WorkspaceClientError {}

export class FlovartCrewClient {
  constructor(options = {}) {
    this.workspace = new FlovartWorkspaceClient(options);
  }

  async protocol() {
    const body = await this.workspace.request('/crew/protocol');
    return {
      protocolVersion: body.protocolVersion,
      registryHash: body.registryHash,
      capabilities: body.capabilities || [],
      limits: body.limits || {},
    };
  }

  async submitIntent({ intentJson, projectId, idempotencyKey, director = null }) {
    return this.workspace.request('/crew/intent', {
      method: 'POST',
      body: JSON.stringify({ intentJson, projectId, idempotencyKey, director }),
    });
  }

  async getIntent(intentId) {
    return this.workspace.request(`/crew/intent/${encodeURIComponent(intentId)}`);
  }

  async cancelIntent(intentId, reason) {
    return this.workspace.request(`/crew/intent/${encodeURIComponent(intentId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || null }),
    });
  }

  async getReceipt(intentId) {
    return this.workspace.request(`/crew/receipt/${encodeURIComponent(intentId)}`);
  }

  async listEvents({ afterEventId, limit } = {}) {
    const search = new URLSearchParams();
    if (afterEventId !== undefined && afterEventId !== null) search.set('afterEventId', String(afterEventId));
    if (limit !== undefined && limit !== null) search.set('limit', String(limit));
    const suffix = search.size ? `?${search}` : '';
    return this.workspace.request(`/crew/events${suffix}`);
  }

  async bindDirector({ agentIdentity, host, sessionId, hostInstanceId, projectId }) {
    return this.workspace.request('/director/bind', {
      method: 'POST',
      body: JSON.stringify({ agentIdentity: agentIdentity || host, sessionId, hostInstanceId, projectId }),
    });
  }

  async handoffDirector({ agentIdentity, host, sessionId, hostInstanceId, projectId, expectedBindingId }) {
    return this.workspace.request('/director/handoff', {
      method: 'POST',
      body: JSON.stringify({ agentIdentity: agentIdentity || host, sessionId, hostInstanceId, projectId, expectedBindingId }),
    });
  }

  async directorStatus({ agentIdentity, host, sessionId, projectId } = {}) {
    const search = new URLSearchParams();
    if (agentIdentity || host) search.set('agentIdentity', agentIdentity || host);
    if (sessionId) search.set('sessionId', sessionId);
    if (projectId) search.set('projectId', projectId);
    return this.workspace.request(`/director/status${search.size ? `?${search}` : ''}`);
  }

  async unbindDirector({ bindingId } = {}) {
    return this.workspace.request('/director/unbind', {
      method: 'POST',
      body: JSON.stringify({ bindingId: bindingId || null }),
    });
  }
}
