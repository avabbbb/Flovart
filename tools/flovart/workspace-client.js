import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
// 仓库开发时读 agent/config.js；npm 打包后读 managed-agent/config.js（prepare-package 复制）。
// 用变量而非字面量：vite-ignore 注释只对非字面量生效；managed-agent/ 被 gitignore，CI 中不存在。
const managedConfigSpecifier = './managed-agent/config.js';
const configModule = await import(/* @vite-ignore */ managedConfigSpecifier).catch(() => import('../../agent/config.js'));
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

// 与 agent/session.js 的 LONG_RUNNING_COMMANDS 保持一致：这些命令要等生成或人工确认结束才回包。
// 客户端上限略长于 sidecar（15 分钟），让 sidecar 的明确错误先到达。
const LONG_RUNNING_COMMANDS = new Set(['workflow.node.run', 'workflow.node.tool', 'production.run', 'production.approve']);
const LONG_RUNNING_TIMEOUT_MS = 16 * 60_000;

export class FlovartWorkspaceClient {
  constructor(options = {}) {
    this.config = normalizeConfig(options.config || defaultConfig());
    this.fetch = options.fetch || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || 35_000;
    this.longRunningTimeoutMs = options.longRunningTimeoutMs || LONG_RUNNING_TIMEOUT_MS;
  }

  async request(path, init = {}, timeoutMs = this.timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      if (controller.signal.aborted) {
        throw workspaceError(
          'WORKSPACE_TIMEOUT',
          'Workspace Adapter ' + Math.round(timeoutMs / 1000) + 's 内没有返回结果；任务可能仍在 Flovart 中运行，请先 workflow.inspect 查看节点状态，重试时沿用同一个 idempotencyKey。',
          { retryable: true },
        );
      }
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
    const longRunning = LONG_RUNNING_COMMANDS.has(envelope.command);
    // 长任务即使调用方没传也带上幂等键：超时后用 details.idempotencyKey 重试，
    // 浏览器端 dispatcher 会复用在途/已完成的那次执行，而不是重复提交生成。
    const idempotencyKey = envelope.idempotencyKey || (longRunning ? randomUUID() : undefined);
    try {
      const body = await this.request('/api/tools', {
        method: 'POST',
        body: JSON.stringify({
          command: envelope.command,
          args: envelope.args || {},
          source: envelope.source || 'cli',
          idempotencyKey,
          ...(envelope.caller ? { caller: envelope.caller } : {}),
        }),
      }, longRunning ? this.longRunningTimeoutMs : this.timeoutMs);
      return body.result;
    } catch (error) {
      if (idempotencyKey && error instanceof WorkspaceClientError && error.code === 'WORKSPACE_TIMEOUT') {
        error.details = { ...(error.details || {}), idempotencyKey };
      }
      throw error;
    }
  }

  async execute(command, args = {}, source = 'mcp', options = {}) {
    return this.executeEnvelope({
      command,
      args,
      source,
      idempotencyKey: options.idempotencyKey,
      ...(options.caller ? { caller: options.caller } : {}),
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

