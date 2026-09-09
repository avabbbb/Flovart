import { setBrowserWorkflowBinding } from './browserWorkflowBinding';
import type { ManagedAgentConnection } from './managedAgentConnection';
import { useAgentConnectionStore, type AgentConnectionStatus } from '../stores/useAgentConnectionStore';

const AGENT_URL_PARAM = 'agentUrl';
const AGENT_TOKEN_PARAM = 'agentToken';
const BOOTSTRAP_TOKEN_PARAM = 'bootstrapToken';
const AUTO_ACTIVATE_PARAM = 'activateBrowserWriter';
const SESSION_URL_KEY = 'flovart.agent.bootstrap.url';
const SESSION_TOKEN_KEY = 'flovart.agent.bootstrap.token';
const SESSION_EXPIRES_KEY = 'flovart.agent.bootstrap.expires';
const SESSION_AUTO_ACTIVATE_KEY = 'flovart.agent.bootstrap.activate';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

type BootstrapLocation = Pick<Location, 'href' | 'search' | 'hash' | 'pathname'>;
type BootstrapHistory = Pick<History, 'replaceState'>;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type AgentBootstrapState = 'skipped' | 'connecting' | 'ready' | 'offline' | 'auth_failed';

export interface AgentBootstrapResult {
  state: AgentBootstrapState;
  connection?: ManagedAgentConnection;
  error?: string;
}

export interface AgentConnectionBootstrapOptions {
  location?: BootstrapLocation;
  history?: BootstrapHistory;
  sessionStorage?: StorageLike;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
  maxAttempts?: number;
}

let inFlight: Promise<AgentBootstrapResult> | null = null;

function browserLocation(): BootstrapLocation | null {
  return typeof window === 'undefined' ? null : window.location;
}

function browserHistory(): BootstrapHistory | null {
  return typeof window === 'undefined' ? null : window.history;
}

function sessionStore(): StorageLike | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; }
  catch { return null; }
}

function parseHashParams(hash: string) {
  const queryIndex = String(hash || '').indexOf('?');
  return queryIndex < 0 ? new URLSearchParams() : new URLSearchParams(String(hash).slice(queryIndex + 1));
}

function readConnectionParams(location: BootstrapLocation) {
  const search = new URLSearchParams(location.search || '');
  const hash = parseHashParams(location.hash || '');
  return {
    url: search.get(AGENT_URL_PARAM) || hash.get(AGENT_URL_PARAM) || '',
    token: search.get(AGENT_TOKEN_PARAM) || hash.get(AGENT_TOKEN_PARAM) || '',
    bootstrapToken: search.get(BOOTSTRAP_TOKEN_PARAM) || hash.get(BOOTSTRAP_TOKEN_PARAM) || '',
    autoActivate: search.get(AUTO_ACTIVATE_PARAM) === '1' || hash.get(AUTO_ACTIVATE_PARAM) === '1',
    fromUrl: search.has(AGENT_URL_PARAM) || search.has(AGENT_TOKEN_PARAM) || search.has(BOOTSTRAP_TOKEN_PARAM) || search.has(AUTO_ACTIVATE_PARAM)
      || hash.has(AGENT_URL_PARAM) || hash.has(AGENT_TOKEN_PARAM) || hash.has(BOOTSTRAP_TOKEN_PARAM) || hash.has(AUTO_ACTIVATE_PARAM),
  };
}

function readSessionConnection(storage: StorageLike | null) {
  if (!storage) return { url: '', token: '' };
  try {
    const expiresAt = Number(storage.getItem(SESSION_EXPIRES_KEY) || 0);
    if (expiresAt && expiresAt <= Date.now()) {
      storage.removeItem(SESSION_URL_KEY);
      storage.removeItem(SESSION_TOKEN_KEY);
      storage.removeItem(SESSION_EXPIRES_KEY);
      return { url: '', token: '' };
    }
    return { url: storage.getItem(SESSION_URL_KEY) || '', token: storage.getItem(SESSION_TOKEN_KEY) || '' };
  } catch {
    return { url: '', token: '' };
  }
}

function normalizeUrl(value: string) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error('Flovart Agent 地址无效。'); }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('Flovart Agent 只能使用本机 loopback HTTP 地址。');
  }
  return url.origin;
}

function normalizeConnection(url: string, token: string): ManagedAgentConnection {
  const normalizedUrl = normalizeUrl(url.trim());
  if (!token.trim()) throw new Error('Flovart Agent bootstrap 缺少连接 Token。');
  return { state: 'ready', url: normalizedUrl, token: token.trim(), managed: false };
}

function scrubConnectionParams(location: BootstrapLocation, history: BootstrapHistory | null) {
  if (!history) return;
  try {
    const url = new URL(location.href);
    url.searchParams.delete(AGENT_URL_PARAM);
    url.searchParams.delete(AGENT_TOKEN_PARAM);
    url.searchParams.delete(BOOTSTRAP_TOKEN_PARAM);
    url.searchParams.delete(AUTO_ACTIVATE_PARAM);
    const hashQueryIndex = url.hash.indexOf('?');
    if (hashQueryIndex >= 0) {
      const route = url.hash.slice(0, hashQueryIndex);
      const params = new URLSearchParams(url.hash.slice(hashQueryIndex + 1));
      params.delete(AGENT_URL_PARAM);
      params.delete(AGENT_TOKEN_PARAM);
      params.delete(BOOTSTRAP_TOKEN_PARAM);
      params.delete(AUTO_ACTIVATE_PARAM);
      url.hash = params.size ? `${route}?${params}` : route;
    }
    history.replaceState(null, typeof document === 'undefined' ? '' : document.title, `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // A restricted embedded browser may reject history changes; connection still works.
  }
}

function saveSessionConnection(storage: StorageLike | null, connection: ManagedAgentConnection) {
  if (!storage) return;
  try {
    storage.setItem(SESSION_URL_KEY, connection.url);
    storage.setItem(SESSION_TOKEN_KEY, connection.token);
  } catch {
    // Private browsing/storage restrictions should not block the current connection.
  }
}

function saveSessionExpiry(storage: StorageLike | null, expiresAt?: number) {
  if (!storage) return;
  try {
    if (Number.isFinite(expiresAt)) storage.setItem(SESSION_EXPIRES_KEY, String(expiresAt));
    else storage.removeItem(SESSION_EXPIRES_KEY);
  } catch { /* storage is best effort */ }
}

function clearSessionConnection(storage: StorageLike | null) {
  if (!storage) return;
  try {
    storage.removeItem(SESSION_URL_KEY);
    storage.removeItem(SESSION_TOKEN_KEY);
    storage.removeItem(SESSION_EXPIRES_KEY);
  } catch { /* storage is best effort */ }
}

function saveAutoActivation(storage: StorageLike | null, enabled: boolean) {
  if (!storage) return;
  try {
    if (enabled) storage.setItem(SESSION_AUTO_ACTIVATE_KEY, '1');
    else storage.removeItem(SESSION_AUTO_ACTIVATE_KEY);
  } catch { /* storage is best effort */ }
}

async function requestJson(url: URL, options: AgentConnectionBootstrapOptions, token?: string, headers: Record<string, string> = {}, method = 'GET') {
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 1200);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      method,
      headers: { ...(token ? { 'x-flovart-agent-token': token } : {}), ...headers },
    });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  } catch (cause) {
    if (controller.signal.aborted) throw new Error('连接本机 Flovart Agent 超时。');
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

async function exchangeBootstrapCredential(url: string, bootstrapToken: string, options: AgentConnectionBootstrapOptions) {
  const result = await requestJson(
    new URL('/bootstrap/exchange', url),
    options,
    undefined,
    { 'x-flovart-bootstrap-token': bootstrapToken },
    'POST',
  );
  if (!result.response.ok || typeof result.body?.sessionToken !== 'string' || !result.body.sessionToken) {
    const error = new Error(String(result.body?.error?.message || result.body?.error || `Browser bootstrap 返回 HTTP ${result.response.status}。`));
    (error as Error & { code?: string }).code = result.body?.error?.code || 'AUTH_FAILED';
    throw error;
  }
  return { token: result.body.sessionToken, expiresAt: Number(result.body.expiresAt) || undefined };
}

async function authenticate(connection: ManagedAgentConnection, options: AgentConnectionBootstrapOptions) {
  const health = await requestJson(new URL('/health', connection.url), options);
  if (!health.response.ok) throw new Error(`Agent health 返回 HTTP ${health.response.status}。`);
  const protocol = await requestJson(new URL('/crew/protocol', connection.url), options, connection.token);
  if (protocol.response.status === 401 || /invalid token/i.test(String(protocol.body?.error || ''))) {
    const error = new Error('Flovart Agent Token 无效。');
    (error as Error & { code?: string }).code = 'AUTH_FAILED';
    throw error;
  }
  if (!protocol.response.ok || protocol.body?.ok === false) {
    throw new Error(`Agent protocol 返回 HTTP ${protocol.response.status}。`);
  }
}

function setStoreStatus(status: AgentConnectionStatus, patch: Parameters<ReturnType<typeof useAgentConnectionStore.getState>['setStatus']>[1] = {}) {
  useAgentConnectionStore.getState().setStatus(status, patch);
}

async function runBootstrap(options: AgentConnectionBootstrapOptions): Promise<AgentBootstrapResult> {
  const location = options.location || browserLocation();
  if (!location) return { state: 'skipped' };
  const storage = options.sessionStorage || sessionStore();
  const params = readConnectionParams(location);
  const history = options.history || browserHistory();
  if (params.fromUrl) scrubConnectionParams(location, history);
  const session = readSessionConnection(storage);
  const url = params.url || session.url;
  const token = params.token || session.token;
  if (!url && !token && !params.bootstrapToken) return { state: 'skipped' };

  setStoreStatus('connecting', { url: url || null, error: null });
  let connection: ManagedAgentConnection;
  let sessionExpiresAt: number | undefined;
  try {
    const exchanged = params.bootstrapToken
      ? await exchangeBootstrapCredential(url, params.bootstrapToken, options)
      : { token, expiresAt: undefined };
    sessionExpiresAt = exchanged.expiresAt;
    connection = normalizeConnection(url, exchanged.token);
  } catch (cause) {
    clearSessionConnection(storage);
    saveAutoActivation(storage, false);
    setBrowserWorkflowBinding(null);
    const error = cause instanceof Error ? cause.message : String(cause);
    setStoreStatus('auth_failed', { url: null, clientId: null, projectId: null, revision: null, error });
    return { state: 'auth_failed', error };
  }

  const maxAttempts = Math.max(1, options.maxAttempts || 8);
  let lastError = 'Flovart Agent 暂时不可用。';
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await authenticate(connection, options);
      saveSessionConnection(storage, connection);
      saveSessionExpiry(storage, sessionExpiresAt);
      saveAutoActivation(storage, params.autoActivate);
      setBrowserWorkflowBinding(connection);
      return { state: 'ready', connection };
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
      if ((cause as Error & { code?: string })?.code === 'AUTH_FAILED') {
        clearSessionConnection(storage);
        saveAutoActivation(storage, false);
        setBrowserWorkflowBinding(null);
        setStoreStatus('auth_failed', { url: connection.url, clientId: null, projectId: null, revision: null, error: lastError });
        return { state: 'auth_failed', connection, error: lastError };
      }
      if (attempt + 1 < maxAttempts) await new Promise(resolve => setTimeout(resolve, options.retryDelayMs || 350));
    }
  }
  setStoreStatus('offline', { url: connection.url, error: lastError });
  return { state: 'offline', connection, error: lastError };
}

export function bootstrapLocalAgentConnection(options: AgentConnectionBootstrapOptions = {}) {
  if (inFlight) return inFlight;
  inFlight = runBootstrap(options).finally(() => { inFlight = null; });
  return inFlight;
}

export function resetAgentConnectionBootstrapForTests() {
  inFlight = null;
}

export function consumeBrowserWriterAutoActivation(storage: StorageLike | null = sessionStore()) {
  if (!storage) return false;
  try {
    const enabled = storage.getItem(SESSION_AUTO_ACTIVATE_KEY) === '1';
    storage.removeItem(SESSION_AUTO_ACTIVATE_KEY);
    return enabled;
  } catch {
    return false;
  }
}

export const agentBootstrapStorageKeys = Object.freeze({
  url: SESSION_URL_KEY,
  token: SESSION_TOKEN_KEY,
  expiresAt: SESSION_EXPIRES_KEY,
  autoActivate: SESSION_AUTO_ACTIVATE_KEY,
});
