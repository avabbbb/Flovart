import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  agentLinkIssue,
  describeAgentLinkIssue,
  diagnoseAgentLink,
  isTerminalAgentLinkIssue,
  type AgentLinkIssueKind,
} from '../services/agentLinkIssue';
import { setBrowserWorkflowBinding, getBrowserWorkflowBinding } from '../services/browserWorkflowBinding';
import {
  agentBootstrapStorageKeys,
  bootstrapLocalAgentConnection,
  resetAgentConnectionBootstrapForTests,
} from '../services/agentConnectionBootstrap';
import { WorkflowAgentBridge } from '../services/workflowAgentBridge';
import { WorkflowWorkspaceAdapter } from '../services/workflowWorkspaceAdapter';
import { useAgentConnectionStore } from '../stores/useAgentConnectionStore';

const URL_ = 'http://127.0.0.1:17372';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

afterEach(() => {
  vi.useRealTimers();
  setBrowserWorkflowBinding(null);
  useAgentConnectionStore.getState().reset();
  resetAgentConnectionBootstrapForTests();
});

describe('diagnoseAgentLink', () => {
  const run = (fetchImpl: typeof fetch, extra: Partial<Parameters<typeof diagnoseAgentLink>[0]> = {}) => diagnoseAgentLink({
    url: URL_, token: 'tok', fetchImpl, pageOrigin: 'http://127.0.0.1:5173', timeoutMs: 50, ...extra,
  });

  it('reports a refused port when /health fails immediately', async () => {
    const issue = await run(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(issue?.kind).toBe('refused');
    expect(issue?.url).toBe(URL_);
  });

  it('reports a slow network failure as unreachable rather than refused', async () => {
    let t = 0;
    const issue = await run(vi.fn(async () => { t += 5000; throw new TypeError('Failed to fetch'); }), { now: () => t });
    expect(issue?.kind).toBe('unreachable');
  });

  it('reports a hosted HTTPS page as blocked by the browser', async () => {
    const issue = await run(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')), { pageOrigin: 'https://iris.avabbbb.com' });
    expect(issue?.kind).toBe('blocked_by_page');
  });

  it('reports a timeout when /health never answers', async () => {
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    expect((await run(fetchImpl as typeof fetch))?.kind).toBe('timeout');
  });

  it('reports something else on the port when /health is not a Iris answer', async () => {
    expect((await run(vi.fn().mockResolvedValue(new Response('<html>', { status: 200 }))))?.kind).toBe('wrong_service');
    expect((await run(vi.fn().mockResolvedValue(json({ error: 'nope' }, 500))))).toMatchObject({ kind: 'wrong_service', detail: 'HTTP 500' });
  });

  it('separates expired credential, rejected origin and version skew once /health is up', async () => {
    const probe = (protocol: () => Promise<Response>) => vi.fn(async (input: RequestInfo | URL) => (
      new URL(String(input)).pathname === '/health' ? json({ ok: true }) : protocol()
    )) as unknown as typeof fetch;
    expect((await run(probe(async () => json({ ok: false, error: 'invalid token' }, 401))))?.kind).toBe('auth');
    expect((await run(probe(async () => { throw new TypeError('Failed to fetch'); })))?.kind).toBe('cors');
    expect((await run(probe(async () => json({ ok: false, error: 'origin not allowed' }, 403))))?.kind).toBe('cors');
    expect((await run(probe(async () => json({ ok: true, protocolVersion: '2' })))))
      .toMatchObject({ kind: 'version', detail: 'protocol 2 ≠ 1' });
    expect((await run(probe(async () => json({ ok: true, protocolVersion: '1' }))))).toBeNull();
  });

  it('never sends the token to the unauthenticated health probe', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === '/health') expect(init?.headers).toEqual({});
      else expect(init?.headers).toEqual({ 'x-flovart-agent-token': 'tok' });
      return json({ ok: true, protocolVersion: '1' });
    });
    await run(fetchImpl as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('has bilingual copy with a next step for every kind, and no Chinese in English labels', () => {
    const kinds: AgentLinkIssueKind[] = ['not_configured', 'blocked_by_page', 'refused', 'unreachable', 'timeout', 'cors', 'auth', 'version', 'wrong_service', 'stream_lost', 'sync_failed'];
    for (const kind of kinds) {
      const zh = describeAgentLinkIssue(kind, 'zho');
      const en = describeAgentLinkIssue(kind, 'en');
      expect(zh.title && zh.next).toBeTruthy();
      expect(`${en.title} ${en.detail} ${en.next}`).not.toMatch(/[\u4e00-\u9fff]/);
    }
    expect(isTerminalAgentLinkIssue('auth')).toBe(true);
    expect(isTerminalAgentLinkIssue('refused')).toBe(false);
  });
});

describe('bootstrap failure classification', () => {
  const location = (query: string) => ({ href: `http://127.0.0.1:5173/?${query}#/app`, search: `?${query}`, hash: '#/app', pathname: '/' });

  it('treats an unreachable Agent during the one-time exchange as offline, not as an expired credential', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await bootstrapLocalAgentConnection({
      location: location(`agentUrl=${encodeURIComponent(URL_)}&bootstrapToken=once`),
      history: { replaceState: vi.fn() }, sessionStorage: storage(), fetchImpl, maxAttempts: 1,
      diagnose: async () => agentLinkIssue('refused', URL_),
    });
    expect(result.state).toBe('offline');
    expect(useAgentConnectionStore.getState()).toMatchObject({ status: 'offline', issue: { kind: 'refused' } });
  });

  it('keeps the launcher credential when the Agent is still starting so Reconnect can retry it', async () => {
    const session = storage();
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await bootstrapLocalAgentConnection({
      location: location(`agentUrl=${encodeURIComponent(URL_)}&agentToken=launcher`),
      history: { replaceState: vi.fn() }, sessionStorage: session, fetchImpl, maxAttempts: 1,
      diagnose: async () => agentLinkIssue('refused', URL_),
    });
    expect(result.state).toBe('offline');
    expect(session.getItem(agentBootstrapStorageKeys.url)).toBe(URL_);
    expect(session.getItem(agentBootstrapStorageKeys.token)).toBe('launcher');

    // Agent comes up; a forced bootstrap (Reconnect) reuses the stored credential.
    const ok = vi.fn(async (input: RequestInfo | URL) => (new URL(String(input)).pathname === '/hosts' ? json({ ok: true, agents: [] }) : json({ ok: true })));
    const retried = await bootstrapLocalAgentConnection({ force: true, location: location(''), history: { replaceState: vi.fn() }, sessionStorage: session, fetchImpl: ok as typeof fetch, maxAttempts: 1 });
    expect(retried.state).toBe('ready');
    expect(getBrowserWorkflowBinding()?.token).toBe('launcher');
  });

  it('labels a rejected credential as auth and clears it', async () => {
    const session = storage();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => (new URL(String(input)).pathname === '/hosts' ? json({ ok: false, error: 'invalid token' }, 401) : json({ ok: true })));
    const result = await bootstrapLocalAgentConnection({ location: location(`agentUrl=${encodeURIComponent(URL_)}&agentToken=stale`), history: { replaceState: vi.fn() }, sessionStorage: session, fetchImpl: fetchImpl as typeof fetch, maxAttempts: 1 });
    expect(result.state).toBe('auth_failed');
    expect(useAgentConnectionStore.getState()).toMatchObject({ status: 'auth_failed', issue: { kind: 'auth' } });
    expect(session.getItem(agentBootstrapStorageKeys.token)).toBeNull();
  });

  it('lets a fresh DSH bootstrap token supersede a stale session retry already in flight', async () => {
    const session = storage();
    session.setItem(agentBootstrapStorageKeys.url, URL_);
    session.setItem(agentBootstrapStorageKeys.token, 'stale-session');
    let releaseStale!: () => void;
    const staleGate = new Promise<void>(resolve => { releaseStale = resolve; });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const token = (init?.headers as Record<string, string> | undefined)?.['x-flovart-agent-token'];
      if (url.pathname === '/bootstrap/exchange') return json({ ok: true, sessionToken: 'fresh-session' });
      if (url.pathname === '/health') return json({ ok: true });
      if (token === 'stale-session') { await staleGate; return json({ ok: false, error: 'invalid token' }, 401); }
      return json({ ok: true, agents: [] });
    });
    // App start: implicit run picks up the stale session credential and stalls.
    const stale = bootstrapLocalAgentConnection({ location: location(''), history: { replaceState: vi.fn() }, sessionStorage: session, fetchImpl: fetchImpl as typeof fetch, maxAttempts: 1 });
    // DSH host posts a fresh one-time token meanwhile.
    const fresh = bootstrapLocalAgentConnection({ location: location(`agentUrl=${encodeURIComponent(URL_)}&bootstrapToken=fresh-once`), history: { replaceState: vi.fn() }, sessionStorage: session, fetchImpl: fetchImpl as typeof fetch, maxAttempts: 1 });
    expect(fresh).not.toBe(stale);
    await expect(fresh).resolves.toMatchObject({ state: 'ready' });
    releaseStale();
    await stale;
    // The late 401 for the stale token must not wipe the fresh, working link.
    expect(getBrowserWorkflowBinding()?.token).toBe('fresh-session');
    expect(useAgentConnectionStore.getState().status).not.toBe('auth_failed');
    expect(session.getItem(agentBootstrapStorageKeys.token)).toBe('fresh-session');
  });
});

describe('link status never sticks', () => {
  const connection = { state: 'ready' as const, url: URL_, token: 'tok', managed: false };

  function harness(diagnose: () => Promise<ReturnType<typeof agentLinkIssue> | null>, onCredentialRejected?: () => boolean) {
    let onStatus: ((status: 'connecting' | 'connected' | 'disconnected' | 'error', reason?: 'stream_error' | 'hello_timeout') => void) | undefined;
    const disconnect = vi.fn(() => onStatus?.('disconnected'));
    const pushSnapshot = vi.fn().mockResolvedValue({ ok: true });
    const adapter = new WorkflowWorkspaceAdapter({
      discover: async () => connection,
      diagnose,
      onCredentialRejected,
      createBridge: options => { onStatus = options.onStatus; return { connect: vi.fn(), disconnect, pushSnapshot, getClientId: () => 'client-1' }; },
    });
    return { adapter, emit: (...args: Parameters<NonNullable<typeof onStatus>>) => onStatus?.(...args), disconnect, pushSnapshot };
  }

  it('turns a stream error with an expired credential into auth_failed and stops the reconnect loop', async () => {
    const { adapter, emit, disconnect } = harness(async () => agentLinkIssue('auth', URL_, 'HTTP 401'));
    await adapter.start({ id: 'p1' });
    emit('connected');
    emit('error', 'stream_error');
    await vi.waitFor(() => expect(useAgentConnectionStore.getState().status).toBe('auth_failed'));
    expect(useAgentConnectionStore.getState().issue?.kind).toBe('auth');
    expect(disconnect).toHaveBeenCalled();
    // The bridge's own "disconnected" after halting must not overwrite the real cause.
    expect(useAgentConnectionStore.getState().status).toBe('auth_failed');
  });

  it('asks the DSH host for a fresh credential instead of ending on auth_failed', async () => {
    const rearm = vi.fn(() => true);
    const { adapter, emit } = harness(async () => agentLinkIssue('auth', URL_), rearm);
    await adapter.start({ id: 'p1' });
    emit('error', 'stream_error');
    await vi.waitFor(() => expect(rearm).toHaveBeenCalledOnce());
    expect(useAgentConnectionStore.getState().status).toBe('connecting');
  });

  it('keeps retrying a transient drop and clears the issue once the stream is back', async () => {
    const { adapter, emit } = harness(async () => agentLinkIssue('refused', URL_));
    await adapter.start({ id: 'p1' });
    emit('error', 'stream_error');
    await vi.waitFor(() => expect(useAgentConnectionStore.getState().issue?.kind).toBe('refused'));
    expect(useAgentConnectionStore.getState().status).toBe('error');
    emit('connecting');
    emit('connected');
    expect(useAgentConnectionStore.getState()).toMatchObject({ status: 'ready', issue: null });
  });

  it('recovers from a failed canvas sync on the next successful publish', async () => {
    const { adapter, emit, pushSnapshot } = harness(async () => null);
    pushSnapshot.mockRejectedValueOnce(new Error('Agent 请求失败：500'));
    await adapter.start({ id: 'p1' });
    emit('connected');
    await vi.waitFor(() => expect(useAgentConnectionStore.getState().issue?.kind).toBe('sync_failed'));
    expect(useAgentConnectionStore.getState().status).toBe('error');
    adapter.update({ id: 'p1', nodes: [{ id: 'n1' }] });
    await vi.waitFor(() => expect(useAgentConnectionStore.getState()).toMatchObject({ status: 'ready', issue: null }));
  });

  it('records distinct transitions in the link log without flooding it during backoff', () => {
    const store = useAgentConnectionStore.getState();
    store.setStatus('connecting', { url: URL_ });
    store.setStatus('error', { issue: agentLinkIssue('refused', URL_) });
    for (let i = 0; i < 5; i += 1) {
      useAgentConnectionStore.getState().setStatus('connecting');
      useAgentConnectionStore.getState().setStatus('error');
    }
    useAgentConnectionStore.getState().setStatus('ready');
    const events = useAgentConnectionStore.getState().events.map(event => `${event.status}:${event.issueKind ?? ''}`);
    expect(events).toEqual(['connecting:', 'error:refused', 'ready:']);
  });
});

describe('WorkflowAgentBridge hello timeout', () => {
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    onerror: (() => void) | null = null;
    closed = false;
    listeners = new Map<string, (event: Event) => void>();
    constructor(public url: URL) { FakeEventSource.instances.push(this); }
    addEventListener(type: string, listener: (event: Event) => void) { this.listeners.set(type, listener); }
    close() { this.closed = true; }
  }

  it('does not stay "connecting" when the stream opens but never says hello', () => {
    vi.useFakeTimers();
    const original = globalThis.EventSource;
    (globalThis as { EventSource: unknown }).EventSource = FakeEventSource;
    const statuses: string[] = [];
    try {
      const bridge = new WorkflowAgentBridge({ url: URL_, token: 'tok', helloTimeoutMs: 1000, onStatus: (status, reason) => statuses.push(reason ? `${status}:${reason}` : status) });
      bridge.connect();
      expect(statuses).toEqual(['connecting']);
      vi.advanceTimersByTime(1000);
      expect(statuses).toEqual(['connecting', 'error:hello_timeout']);
      expect(FakeEventSource.instances[0].closed).toBe(true);
      vi.advanceTimersByTime(500);
      expect(FakeEventSource.instances).toHaveLength(2);
      FakeEventSource.instances[1].listeners.get('hello')?.(new MessageEvent('hello', { data: '{"ok":true}' }));
      expect(statuses.at(-1)).toBe('connected');
      bridge.disconnect();
    } finally {
      (globalThis as { EventSource: unknown }).EventSource = original;
      FakeEventSource.instances = [];
    }
  });
});
