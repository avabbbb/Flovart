/**
 * 本机 Agent loopback 连接凭据存取。
 *
 * localStorage 仅记忆 url，sessionStorage 保存短期 token；
 * 与 Node 侧 workspace-client 约定一致：请求头携带 x-flovart-agent-token。
 */

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
