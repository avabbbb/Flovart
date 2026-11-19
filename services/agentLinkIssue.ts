/**
 * Classifies why the browser cannot talk to the local Iris Agent (the
 * Workspace Operator DSH / Codex / CLI also connect through) and turns it into
 * one plain sentence plus a concrete next step.
 *
 * The browser hides most transport details (an EventSource error carries no
 * status; a CORS rejection and a refused port both surface as `TypeError`), so
 * this probes two endpoints with different access rules:
 *
 * - `/health` is unauthenticated and always CORS-readable → tells "nothing is
 *   listening / the page is blocked / timed out" apart from "service is up".
 * - `/crew/protocol` needs the token and only answers authorised origins →
 *   401 = credential expired, network-level failure after a healthy `/health`
 *   = origin not allowed (CORS), protocol mismatch = version skew.
 */

export type AgentLinkIssueKind =
  | 'not_configured'
  | 'blocked_by_page'
  | 'refused'
  | 'unreachable'
  | 'timeout'
  | 'cors'
  | 'auth'
  | 'version'
  | 'wrong_service'
  | 'stream_lost'
  | 'sync_failed';

export interface AgentLinkIssue {
  kind: AgentLinkIssueKind;
  /** ISO time the issue was classified. */
  at: string;
  /** Loopback origin that was probed; never carries a token. */
  url: string | null;
  /** Short technical hint (HTTP status, reported protocol); no secrets. */
  detail?: string;
}

export interface AgentLinkProbeOptions {
  url: string | null | undefined;
  token?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Origin of the page doing the probe; defaults to window.location.origin. */
  pageOrigin?: string | null;
  expectedProtocolVersion?: string;
  now?: () => number;
}

/** Faster than this and a network failure is the OS refusing the port, not a silent drop. */
const REFUSED_WITHIN_MS = 1500;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export const AGENT_PROTOCOL_VERSION = '1';

function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).origin; } catch { return null; }
}

function currentPageOrigin(): string | null {
  try { return typeof window === 'undefined' ? null : window.location.origin; } catch { return null; }
}

function isRemoteSecurePage(pageOrigin: string | null): boolean {
  if (!pageOrigin) return false;
  try {
    const page = new URL(pageOrigin);
    return page.protocol === 'https:' && !LOOPBACK_HOSTS.has(page.hostname);
  } catch {
    return false;
  }
}

type ProbeResult =
  | { kind: 'response'; status: number; body: Record<string, unknown> }
  | { kind: 'timeout' }
  | { kind: 'network'; elapsedMs: number };

async function probe(url: URL, options: AgentLinkProbeOptions, token?: string | null): Promise<ProbeResult> {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || Date.now;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2500);
  const startedAt = now();
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: token ? { 'x-flovart-agent-token': token } : {},
    });
    const body = await response.json().catch(() => ({}));
    return { kind: 'response', status: response.status, body: body && typeof body === 'object' ? body as Record<string, unknown> : {} };
  } catch {
    if (controller.signal.aborted) return { kind: 'timeout' };
    return { kind: 'network', elapsedMs: now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

export function agentLinkIssue(kind: AgentLinkIssueKind, url: string | null | undefined, detail?: string, at = new Date()): AgentLinkIssue {
  return { kind, at: at.toISOString(), url: originOf(url), ...(detail ? { detail } : {}) };
}

/**
 * Returns the classified issue, or `null` when the Agent is reachable,
 * authorised and speaks the expected protocol.
 */
export async function diagnoseAgentLink(options: AgentLinkProbeOptions): Promise<AgentLinkIssue | null> {
  const origin = originOf(options.url);
  if (!origin) return agentLinkIssue('not_configured', null);
  const pageOrigin = options.pageOrigin === undefined ? currentPageOrigin() : options.pageOrigin;

  const health = await probe(new URL('/health', origin), options);
  if (health.kind === 'timeout') return agentLinkIssue('timeout', origin);
  if (health.kind === 'network') {
    if (isRemoteSecurePage(pageOrigin)) return agentLinkIssue('blocked_by_page', origin);
    return agentLinkIssue(health.elapsedMs <= REFUSED_WITHIN_MS ? 'refused' : 'unreachable', origin);
  }
  if (health.status < 200 || health.status >= 300 || health.body.ok !== true) {
    return agentLinkIssue('wrong_service', origin, `HTTP ${health.status}`);
  }

  if (!options.token) return agentLinkIssue('auth', origin, 'missing credential');
  const protocol = await probe(new URL('/crew/protocol', origin), options, options.token);
  if (protocol.kind === 'timeout') return agentLinkIssue('timeout', origin);
  // /health answered this origin but the authorised endpoint did not: the
  // Agent withheld CORS headers, i.e. it does not trust this page's origin.
  if (protocol.kind === 'network') return agentLinkIssue('cors', origin);
  if (protocol.status === 401) return agentLinkIssue('auth', origin, 'HTTP 401');
  if (protocol.status === 403) return agentLinkIssue('cors', origin, 'HTTP 403');
  if (protocol.status === 404) return agentLinkIssue('version', origin, 'HTTP 404');
  if (protocol.status < 200 || protocol.status >= 300) return agentLinkIssue('wrong_service', origin, `HTTP ${protocol.status}`);
  const expected = options.expectedProtocolVersion || AGENT_PROTOCOL_VERSION;
  const reported = protocol.body.protocolVersion;
  if (reported !== undefined && String(reported) !== expected) {
    return agentLinkIssue('version', origin, `protocol ${String(reported)} ≠ ${expected}`);
  }
  return null;
}

export type AgentLinkLanguage = 'en' | 'zho';

export interface AgentLinkIssueCopy {
  title: string;
  detail: string;
  next: string;
  /** Optional terminal command that performs the next step. */
  command?: string;
}

const COPY: Record<AgentLinkIssueKind, { zho: AgentLinkIssueCopy; en: AgentLinkIssueCopy }> = {
  not_configured: {
    zho: { title: '还没有连接本机 Agent', detail: '当前页面没有拿到本机 Iris Agent 的地址。', next: '在终端启动 DSH（会同时拉起本机 Agent），或从启动器重新打开画布。', command: 'npm run dsh:start' },
    en: { title: 'No local agent connected yet', detail: 'This page has no address for the local Iris Agent.', next: 'Start DSH in a terminal (it also starts the local agent), or reopen the canvas from the launcher.', command: 'npm run dsh:start' },
  },
  blocked_by_page: {
    zho: { title: '浏览器拦截了本机连接', detail: '线上 HTTPS 页面不能访问你电脑上的 http 本机服务。', next: '改用本地工作区打开 Iris（npm run dev 或 DSH 内的 Iris 页签）。', command: 'npm run dev' },
    en: { title: 'The browser blocked the local connection', detail: 'A hosted HTTPS page cannot call an http service on your computer.', next: 'Open Iris from a local workspace (npm run dev, or the Iris tab inside DSH).', command: 'npm run dev' },
  },
  refused: {
    zho: { title: '本机 Agent 没有运行', detail: '这个端口上没有服务在监听：Agent 没启动、已退出，或端口不对。', next: '重新启动 DSH / 本机 Agent，再点「重新连接」。', command: 'npm run dsh:start' },
    en: { title: 'The local agent is not running', detail: 'Nothing is listening on this port: the agent is not started, has exited, or the port is wrong.', next: 'Restart DSH or the local agent, then choose Reconnect.', command: 'npm run dsh:start' },
  },
  unreachable: {
    zho: { title: '连不上本机 Agent', detail: '请求没有得到任何响应，可能被防火墙、代理或安全软件拦截。', next: '确认 Agent 正在运行，并允许本机 127.0.0.1 连接后点「重新连接」。', command: 'npm run iris:cli -- status --json' },
    en: { title: 'Cannot reach the local agent', detail: 'The request got no response; a firewall, proxy or security tool may be blocking it.', next: 'Make sure the agent is running and loopback (127.0.0.1) traffic is allowed, then choose Reconnect.', command: 'npm run iris:cli -- status --json' },
  },
  timeout: {
    zho: { title: '本机 Agent 响应超时', detail: 'Agent 在运行，但没有及时回应，可能正忙于启动或扫描。', next: '稍等几秒后点「重新连接」；持续超时请重启 Agent。' },
    en: { title: 'The local agent timed out', detail: 'The agent is running but did not answer in time; it may still be starting or scanning.', next: 'Wait a few seconds and choose Reconnect; restart the agent if it keeps timing out.' },
  },
  cors: {
    zho: { title: 'Agent 拒绝了这个页面的来源', detail: '本机 Agent 在线，但不信任当前页面地址（跨域来源未授权）。', next: '从 DSH 或启动器重新打开画布，让 Agent 记住这个来源。', command: 'npm run dsh:start' },
    en: { title: 'The agent rejected this page’s origin', detail: 'The local agent is online but does not trust this page’s address (origin not authorised).', next: 'Reopen the canvas from DSH or the launcher so the agent authorises this origin.', command: 'npm run dsh:start' },
  },
  auth: {
    zho: { title: '连接凭证已失效', detail: '本机 Agent 在线，但当前页面的连接凭证过期或已被重置（常见于 Agent 重启后）。', next: '点「重新连接」获取新凭证；不行就从 DSH / 启动器重新打开画布。' },
    en: { title: 'The connection credential expired', detail: 'The local agent is online, but this page’s credential expired or was reset (usually after the agent restarted).', next: 'Choose Reconnect to get a new credential; otherwise reopen the canvas from DSH or the launcher.' },
  },
  version: {
    zho: { title: '版本不匹配', detail: '本机 Agent 与当前页面的协议版本不一致。', next: '更新 Iris 后重启 Agent，让两边使用同一版本。', command: 'git pull && npm install && npm run dsh:start' },
    en: { title: 'Version mismatch', detail: 'The local agent and this page speak different protocol versions.', next: 'Update Iris and restart the agent so both sides run the same version.', command: 'git pull && npm install && npm run dsh:start' },
  },
  wrong_service: {
    zho: { title: '端口上不是 Iris Agent', detail: '这个地址有服务应答，但不是 Iris Agent 或它返回了错误。', next: '检查端口是否被其它程序占用，重启 Agent 后点「重新连接」。', command: 'npm run iris:cli -- status --json' },
    en: { title: 'Something else answered on this port', detail: 'A service responded, but it is not the Iris Agent or it returned an error.', next: 'Check whether another program took the port, restart the agent, then choose Reconnect.', command: 'npm run iris:cli -- status --json' },
  },
  stream_lost: {
    zho: { title: '实时通道中断', detail: 'Agent 在线且凭证有效，但画布事件流断开了。', next: '正在自动重连；也可以点「重新连接」立即重试。' },
    en: { title: 'Live channel dropped', detail: 'The agent is online and the credential is valid, but the canvas event stream disconnected.', next: 'Reconnecting automatically; choose Reconnect to retry now.' },
  },
  sync_failed: {
    zho: { title: '画布同步失败', detail: '把当前画布同步给 Agent 时出错。', next: '再改动一次画布会自动重试；持续失败请点「重新连接」。' },
    en: { title: 'Canvas sync failed', detail: 'Sending the current canvas to the agent failed.', next: 'Your next canvas change retries automatically; choose Reconnect if it keeps failing.' },
  },
};

export function describeAgentLinkIssue(kind: AgentLinkIssueKind, language: AgentLinkLanguage = 'zho'): AgentLinkIssueCopy {
  const entry = COPY[kind] || COPY.unreachable;
  return language === 'zho' ? entry.zho : entry.en;
}

/** Issues where retrying with the same credential can never succeed. */
export function isTerminalAgentLinkIssue(kind: AgentLinkIssueKind): boolean {
  return kind === 'auth' || kind === 'cors' || kind === 'version' || kind === 'blocked_by_page';
}

/** One-line message for places that only show a string (store.error, toasts). */
export function agentLinkIssueMessage(issue: Pick<AgentLinkIssue, 'kind'>, language: AgentLinkLanguage = 'zho'): string {
  const copy = describeAgentLinkIssue(issue.kind, language);
  return `${copy.title}：${copy.next}`.replace('：', language === 'zho' ? '：' : ': ');
}
