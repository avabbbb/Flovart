/**
 * Flovart Dock 前端 Crew 客户端
 *
 * 通过同一 loopback Agent/Workspace Adapter 通道（localStorage 仅记忆 url，
 * sessionStorage 保存短期 token）读取 Crew 协议：director.status、crew.intent.*、
 * crew.receipt.get、crew.event.watch、crew.protocol。
 *
 * 约定与 Node 侧 workspace-client 一致：请求头携带 x-flovart-agent-token，
 * 响应体 { ok, ... }；失败按 { code, message, retryable } 抛出 DockClientError，
 * 避免前端把凭据或 HTTP 细节泄露给 Harness。
 */

import { DOCK_CHANNEL, DOCK_PROTOCOL_VERSION } from '../components/dock/protocol';

export const DOCK_AGENT_URL_KEY = 'flovart.agent.url';
export const DOCK_AGENT_TOKEN_KEY = 'flovart.agent.token';

export class DockClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public details: unknown = null,
  ) {
    super(message);
    this.name = 'DockClientError';
  }
}

export type DockConnection = {
  url: string;
  token: string;
};

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function normalizeDockUrl(url: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(url.trim());
  } catch {
    throw new DockClientError('INVALID_CONNECTION', '本机 Agent 地址不是有效的 URL。');
  }
  if (
    endpoint.protocol !== 'http:'
    || !LOOPBACK_HOSTS.has(endpoint.hostname)
    || endpoint.username
    || endpoint.password
  ) {
    throw new DockClientError('INVALID_CONNECTION', '本机 Agent 地址必须是 loopback HTTP 地址。');
  }
  return endpoint;
}

export function normalizeDockConnection(url: string, token: string): DockConnection {
  const trimmedToken = token.trim();
  const endpoint = normalizeDockUrl(url);
  if (!trimmedToken) throw new DockClientError('INVALID_CONNECTION', '本机 Agent 连接必须提供 Token。');
  return { url: endpoint.origin, token: trimmedToken };
}

export function rememberDockConnection(url: string, token: string, rememberToken = true) {
  try {
    const connection = normalizeDockConnection(url, token);
    localStorage.setItem(DOCK_AGENT_URL_KEY, connection.url);
    sessionStorage.setItem(DOCK_AGENT_TOKEN_KEY, connection.token);
    // 兼容旧版本参数，但不再把 Agent token 写入 localStorage。
    void rememberToken;
    localStorage.removeItem(DOCK_AGENT_TOKEN_KEY + '.session');
  } catch {
    // 隐私模式或存储不可用时静默失败，仅本次会话可用
  }
}

export function loadDockConnection(): DockConnection | null {
  try {
    localStorage.removeItem(DOCK_AGENT_TOKEN_KEY + '.session');
    const url = localStorage.getItem(DOCK_AGENT_URL_KEY) || '';
    const token = sessionStorage.getItem(DOCK_AGENT_TOKEN_KEY) || '';
    if (!url || !token) return null;
    return normalizeDockConnection(url, token);
  } catch {
    return null;
  }
}

export function loadDockAgentUrl(): string {
  try {
    const url = localStorage.getItem(DOCK_AGENT_URL_KEY) || '';
    return url ? normalizeDockUrl(url).origin : '';
  } catch {
    return '';
  }
}

export interface DockProtocol {
  protocolVersion: string;
  registryHash: string;
  capabilities: string[];
  limits: Record<string, unknown>;
}

export interface DockDirectorStatus {
  binding: {
    bindingId: string;
    productionSessionId: string;
    hostKind: string;
    externalSessionId: string;
    capabilities: string[];
    state: 'active' | 'archived';
    createdAt: string;
    lastSeenAt: string;
  } | null;
  archivedCount: number;
  projectId: string | null;
}

export interface DockIntent {
  intentId: string;
  projectId: string;
  goal: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  changeSetId?: string;
  error?: { code: string; message: string };
}

export interface DockReceiptCommand {
  command: string;
  summary: string;
  ok?: boolean;
  changeSetId?: string;
  draftVersion?: number;
  affectedNodeIds?: string[];
  error?: { code?: string; message?: string };
}

export interface DockReceipt {
  intentId: string;
  status: 'completed' | 'partial' | 'failed' | 'waiting' | 'cancelled' | 'interrupted';
  changeSetId?: string;
  affectedObjectIds?: string[];
  commands: DockReceiptCommand[];
  waiting?: { reason: string; objectIds?: string[] };
  error?: { code: string; message: string; retryable?: boolean };
}

export interface DockEvent {
  eventId: number;
  eventVersion: string;
  eventType: string;
  data: Record<string, unknown>;
}

export class DockCrewClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly connection: DockConnection,
    // globalThis.fetch 必须绑定到 window/globalThis：作为方法保存后再调用会丢失
    // this（Illegal invocation），这正是嵌入 iframe 场景下请求全部失败的根因。
    fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.fetchImpl = fetchImpl;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await this.fetchImpl(new URL(path, this.connection.url), {
        ...init,
        signal: controller.signal,
        headers: {
          'x-flovart-agent-token': this.connection.token,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(init.headers || {}),
        },
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        throw new DockClientError('PROTOCOL_ERROR', 'Agent 返回了非 JSON 响应。', false);
      }
      const record = body as { ok?: boolean; error?: unknown };
      if (!response.ok || !record?.ok) {
        const errorValue = record?.error;
        const errorRecord = errorValue && typeof errorValue === 'object'
          ? errorValue as { code?: string; message?: string; retryable?: boolean; details?: unknown }
          : null;
        const code = errorRecord?.code || (errorValue === 'invalid token' ? 'INVALID_TOKEN' : response.status === 404 ? 'NOT_FOUND' : 'DOCK_COMMAND_FAILED');
        const message = typeof errorValue === 'string'
          ? errorValue === 'invalid token' ? 'Token 无效，请使用当前本机 Agent 的配对 Token。' : errorValue
          : errorRecord?.message || `Dock 请求失败：HTTP ${response.status}`;
        throw new DockClientError(
          code,
          message,
          errorRecord?.retryable ?? response.status >= 500,
          errorRecord?.details ?? null,
        );
      }
      const { ok: _ok, error: _error, ...rest } = record as Record<string, unknown>;
      return rest as unknown as T;
    } catch (cause) {
      if (cause instanceof DockClientError) throw cause;
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      throw new DockClientError(
        aborted ? 'DOCK_TIMEOUT' : 'DOCK_UNAVAILABLE',
        aborted ? 'Dock 请求超时。' : `本机 Agent 未运行或连接已断开（${detail}）。`,
        true,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async protocol(): Promise<DockProtocol> {
    return this.request<DockProtocol>('/crew/protocol');
  }

  async directorStatus(): Promise<DockDirectorStatus> {
    return this.request<DockDirectorStatus>('/director/status');
  }

  async bindDirector(input: { agentIdentity: string; sessionId: string; hostInstanceId?: string; projectId?: string }) {
    return this.request<{ binding: DockDirectorStatus['binding'] }>('/director/bind', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async unbindDirector(bindingId?: string) {
    return this.request<{ binding: DockDirectorStatus['binding'] }>('/director/unbind', {
      method: 'POST',
      body: JSON.stringify({ bindingId: bindingId || null }),
    });
  }

  async submitIntent(input: { goal: string; scope: { workspace: 'workflow'; selectedObjectIds: string[] }; constraints: Record<string, unknown>; completion?: Record<string, unknown>; idempotencyKey: string; projectId: string }) {
    return this.request<{ intent: DockIntent; replayed: boolean; eventCursor: number }>('/crew/intent', {
      method: 'POST',
      body: JSON.stringify({ intentJson: JSON.stringify(input), projectId: input.projectId, idempotencyKey: input.idempotencyKey }),
    });
  }

  async getIntent(intentId: string): Promise<{ intent: DockIntent }> {
    return this.request<{ intent: DockIntent }>(`/crew/intent/${encodeURIComponent(intentId)}`);
  }

  async cancelIntent(intentId: string, reason?: string) {
    return this.request<{ intent: DockIntent; receipt: DockReceipt | null; alreadyFinal: boolean }>(
      `/crew/intent/${encodeURIComponent(intentId)}/cancel`,
      { method: 'POST', body: JSON.stringify({ reason: reason || null }) },
    );
  }

  async getReceipt(intentId: string): Promise<{ receipt: DockReceipt }> {
    return this.request<{ receipt: DockReceipt }>(`/crew/receipt/${encodeURIComponent(intentId)}`);
  }

  async listEvents(afterEventId = 0, limit = 100): Promise<{ events: DockEvent[]; nextEventId: number; hasMore: boolean }> {
    const search = new URLSearchParams({ afterEventId: String(afterEventId), limit: String(limit) });
    return this.request<{ events: DockEvent[]; nextEventId: number; hasMore: boolean }>(`/crew/events?${search}`);
  }
}

export function dockHandshakePayload() {
  return {
    channel: DOCK_CHANNEL,
    version: DOCK_PROTOCOL_VERSION,
    connection: loadDockConnection(),
    sentAt: Date.now(),
  };
}
