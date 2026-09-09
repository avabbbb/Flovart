import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const DEFAULT_WEB_URL = 'http://127.0.0.1:37522';

export function agentConfigPath(env = process.env) {
  return env.FLOVART_AGENT_CONFIG || join(homedir(), '.flovart', 'agent.json');
}

export function normalizeLocalAgentUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('Flovart Agent 地址无效。');
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('Flovart Agent 只能使用本机 loopback HTTP 地址。');
  }
  return url.origin;
}

export function readLocalAgentConnection(options = {}) {
  const file = options.configPath || agentConfigPath(options.env || process.env);
  if (!existsSync(file)) return null;
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error('Flovart Agent 配置无法读取。');
  }
  const url = normalizeLocalAgentUrl(config?.url);
  const token = String(config?.token || '').trim();
  if (!token) throw new Error('Flovart Agent 配置缺少连接 Token。');
  return { url, token, configPath: file };
}

async function fetchJson(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前环境没有可用的 fetch。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 800);
  try {
    const response = await fetchImpl(url, {
      method: options.method || 'GET',
      signal: controller.signal,
      body: options.body,
      headers: {
        ...(options.token ? { 'x-flovart-agent-token': options.token } : {}),
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  } catch (cause) {
    if (controller.signal.aborted) throw new Error('请求本机 Flovart Agent 超时。');
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

/** Exchange the launcher-only Agent token for a one-use Browser credential. */
export async function issueBrowserBootstrapToken(connection, options = {}) {
  const normalized = connection || readLocalAgentConnection(options);
  if (!normalized) throw new Error('Flovart Agent 连接不可用。');
  let result;
  try {
    result = await fetchJson(new URL('/bootstrap/issue', normalized.url), {
      ...options,
      method: 'POST',
      token: normalized.token,
    });
  } catch (cause) {
    throw Object.assign(new Error(cause instanceof Error ? cause.message : String(cause)), { code: 'BOOTSTRAP_ISSUE_FAILED' });
  }
  if (!result.response.ok || !result.body?.bootstrapToken) {
    const message = result.body?.error?.message || result.body?.error || `Agent bootstrap 签发返回 HTTP ${result.response.status}`;
    throw Object.assign(new Error(String(message)), { code: result.body?.error?.code || 'BOOTSTRAP_ISSUE_FAILED' });
  }
  return String(result.body.bootstrapToken);
}

export async function inspectLocalAgent(connection, options = {}) {
  const normalized = connection || readLocalAgentConnection(options);
  if (!normalized) return { state: 'offline', connection: null, health: null, protocol: null };

  let healthResponse;
  try {
    healthResponse = await fetchJson(new URL('/health', normalized.url), options);
  } catch (cause) {
    return { state: 'offline', connection: normalized, health: null, protocol: null, error: cause instanceof Error ? cause.message : String(cause) };
  }
  if (!healthResponse.response.ok) {
    return { state: 'offline', connection: normalized, health: healthResponse.body, protocol: null, error: `Agent health 返回 HTTP ${healthResponse.response.status}` };
  }

  let protocolResponse;
  try {
    protocolResponse = await fetchJson(new URL('/crew/protocol', normalized.url), { ...options, token: normalized.token });
  } catch (cause) {
    return { state: 'offline', connection: normalized, health: healthResponse.body, protocol: null, error: cause instanceof Error ? cause.message : String(cause) };
  }
  if (protocolResponse.response.status === 401 || /invalid token/i.test(String(protocolResponse.body?.error || ''))) {
    return { state: 'auth_failed', connection: normalized, health: healthResponse.body, protocol: null, error: 'Flovart Agent 连接 Token 无效。' };
  }
  if (!protocolResponse.response.ok || protocolResponse.body?.ok === false) {
    return { state: 'offline', connection: normalized, health: healthResponse.body, protocol: null, error: `Agent protocol 返回 HTTP ${protocolResponse.response.status}` };
  }
  return { state: 'ready', connection: normalized, health: healthResponse.body, protocol: protocolResponse.body };
}

export async function waitForLocalAgent(options = {}) {
  const deadline = Date.now() + (options.timeoutMs || 15_000);
  let last = null;
  while (Date.now() <= deadline) {
    let connection = null;
    try {
      connection = readLocalAgentConnection(options);
    } catch (cause) {
      last = { state: 'auth_failed', error: cause instanceof Error ? cause.message : String(cause) };
    }
    if (connection) {
      last = await inspectLocalAgent(connection, options);
      if (last.state === 'ready' || last.state === 'auth_failed') return last;
    }
    await new Promise(resolve => setTimeout(resolve, options.intervalMs || 250));
  }
  return last || { state: 'offline', connection: null, health: null, protocol: null, error: '等待 Flovart Agent 超时。' };
}

export async function waitForWebUi(url = DEFAULT_WEB_URL, options = {}) {
  const deadline = Date.now() + (options.timeoutMs || 20_000);
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      const origin = await probeWebUi(url, options);
      if (origin) return origin;
      lastError = '目标 localhost 服务不是 Flovart WebUI。';
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    }
    await new Promise(resolve => setTimeout(resolve, options.intervalMs || 250));
  }
  throw new Error(lastError || '等待 Flovart WebUI 超时。');
}

/**
 * Probe a local WebUI without mistaking an unrelated localhost HTTP service
 * for Flovart. Source WebUI carries this marker in index.html; an explicit
 * URL may still be opened by the caller when it intentionally bypasses the
 * discovery probe.
 */
export async function probeWebUi(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('当前环境没有可用的 fetch。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 800);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: 'text/html' },
    });
    if (!response.ok || typeof response.text !== 'function') return null;
    const body = await response.text();
    if (!/data-flovart-webui\s*=\s*["']1["']/i.test(body)) return null;
    return new URL(url).origin;
  } catch (cause) {
    if (controller.signal.aborted) throw new Error('请求本机 Flovart WebUI 超时。');
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

export function buildBrowserBootstrapUrl(frontendUrl, connection, route = '#/app') {
  const url = new URL(frontendUrl);
  const normalized = connection || {};
  url.searchParams.set('agentUrl', normalizeLocalAgentUrl(normalized.url));
  const bootstrapToken = String(normalized.bootstrapToken || '').trim();
  if (bootstrapToken) {
    url.searchParams.set('bootstrapToken', bootstrapToken);
  } else {
  const token = String(normalized.token || '').trim();
  if (!token) throw new Error('构造 Browser bootstrap URL 时缺少 Agent Token。');
  url.searchParams.set('agentToken', token);
  }
  // Only a launcher-opened page may claim the Browser Writer automatically.
  // Ordinary tabs still require an explicit in-app activation.
  url.searchParams.set('activateBrowserWriter', '1');
  url.hash = route.startsWith('#') ? route : `#${route}`;
  return url.toString();
}

export function redactBootstrapUrl(value) {
  try {
    const url = new URL(String(value));
    url.searchParams.delete('agentToken');
    url.searchParams.delete('bootstrapToken');
    url.searchParams.delete('token');
    url.searchParams.delete('activateBrowserWriter');
    const hashQueryIndex = url.hash.indexOf('?');
    if (hashQueryIndex >= 0) {
      const route = url.hash.slice(0, hashQueryIndex);
      const params = new URLSearchParams(url.hash.slice(hashQueryIndex + 1));
      params.delete('agentToken');
      params.delete('bootstrapToken');
      params.delete('token');
      params.delete('activateBrowserWriter');
      url.hash = params.size ? `${route}?${params}` : route;
    }
    return url.toString();
  } catch {
    return String(value || '')
      .replace(/([?&#](?:agentToken|token)=)[^&#]*/gi, '$1[redacted]')
      .replace(/([?&#]bootstrapToken=)[^&#]*/gi, '$1[redacted]')
      .replace(/([?&#]activateBrowserWriter=)[^&#]*/gi, '$1[removed]');
  }
}

export const LOCAL_AGENT_DEFAULTS = Object.freeze({
  webUrl: DEFAULT_WEB_URL,
  configPath: agentConfigPath(),
});
