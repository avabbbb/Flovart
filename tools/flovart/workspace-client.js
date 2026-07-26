import { existsSync } from 'node:fs';
import { AGENT_CONFIG_FILE, loadAgentConfig } from './managed-agent/config.js';

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
    ? 'WSL 中未找到 Flovart Agent 配置。请在同一 WSL 发行版运行 Managed Agent；如果 Agent 运行在 Windows，请设置 FLOVART_AGENT_CONFIG 指向 /mnt/c/Users/<user>/.flovart/agent.json，并启用 WSL mirrored networking。'
    : '未找到 Flovart Workspace Adapter 配置。请先在当前用户环境启动 Managed Agent。';
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
        'Flovart Workspace Adapter 未运行。请启动 Managed Agent，并在 Workflow 的本地 Agent 面板建立连接。',
        { retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }

    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.ok === false) {
      const message = body?.error?.message || body?.error || `Workspace Adapter 返回 HTTP ${response.status}`;
      const unavailable = /没有已连接|连接已断开|未运行/i.test(String(message));
      throw workspaceError(
        unavailable ? 'WORKSPACE_UNAVAILABLE' : response.status === 504 ? 'WORKSPACE_TIMEOUT' : 'WORKSPACE_COMMAND_FAILED',
        String(message),
        { retryable: unavailable || response.status >= 500 },
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
