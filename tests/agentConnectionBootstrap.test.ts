import { afterEach, describe, expect, it, vi } from 'vitest';
import { setBrowserWorkflowBinding } from '../services/browserWorkflowBinding';
import {
  agentBootstrapStorageKeys,
  bootstrapLocalAgentConnection,
  consumeBrowserWriterAutoActivation,
  resetAgentConnectionBootstrapForTests,
} from '../services/agentConnectionBootstrap';
import { useAgentConnectionStore } from '../stores/useAgentConnectionStore';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

afterEach(() => {
  setBrowserWorkflowBinding(null);
  useAgentConnectionStore.getState().reset();
  resetAgentConnectionBootstrapForTests();
});

describe('AgentConnectionBootstrap', () => {
  it('exchanges a one-time browser credential before authenticating and never stores the launcher token', async () => {
    const session = storage();
    const replaceState = vi.fn();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/bootstrap/exchange') {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({ 'x-flovart-bootstrap-token': 'one-time-bootstrap' });
        return response({ ok: true, sessionToken: 'short-lived-session', expiresAt: Date.now() + 60_000 });
      }
      if (url.pathname === '/health') return response({ ok: true, clients: 0 });
      expect(init?.headers).toMatchObject({ 'x-flovart-agent-token': 'short-lived-session' });
      return response({ ok: true, protocolVersion: '1' });
    });
    const location = {
      href: 'http://127.0.0.1:37522/?agentUrl=http%3A%2F%2F127.0.0.1%3A17373&bootstrapToken=one-time-bootstrap#/app',
      search: '?agentUrl=http%3A%2F%2F127.0.0.1%3A17373&bootstrapToken=one-time-bootstrap',
      hash: '#/app',
      pathname: '/',
    };

    const result = await bootstrapLocalAgentConnection({ location, history: { replaceState }, sessionStorage: session, fetchImpl, maxAttempts: 1 });

    expect(result.state).toBe('ready');
    expect(result.connection?.token).toBe('short-lived-session');
    expect(session.getItem(agentBootstrapStorageKeys.token)).toBe('short-lived-session');
    expect(session.getItem(agentBootstrapStorageKeys.expiresAt)).toBeTruthy();
    expect(replaceState).toHaveBeenCalledWith(null, expect.any(String), '/#/app');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('authenticates from launcher parameters, binds the browser, and scrubs the URL', async () => {
    const session = storage();
    const replaceState = vi.fn();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/health') return response({ ok: true, clients: 0 });
      expect(init?.headers).toMatchObject({ 'x-flovart-agent-token': 'bootstrap-secret' });
      return response({ ok: true, protocolVersion: '1' });
    });
    const location = {
      href: 'http://127.0.0.1:37522/?agentUrl=http%3A%2F%2F127.0.0.1%3A17373&agentToken=bootstrap-secret#/app',
      search: '?agentUrl=http%3A%2F%2F127.0.0.1%3A17373&agentToken=bootstrap-secret',
      hash: '#/app',
      pathname: '/',
    };

    const result = await bootstrapLocalAgentConnection({ location, history: { replaceState }, sessionStorage: session, fetchImpl, maxAttempts: 1 });

    expect(result.state).toBe('ready');
    expect(replaceState).toHaveBeenCalledWith(null, expect.any(String), '/#/app');
    expect(session.getItem(agentBootstrapStorageKeys.url)).toBe('http://127.0.0.1:17373');
    expect(session.getItem(agentBootstrapStorageKeys.token)).toBe('bootstrap-secret');
    expect(consumeBrowserWriterAutoActivation(session)).toBe(false);
    expect(useAgentConnectionStore.getState()).toMatchObject({ status: 'connecting', url: 'http://127.0.0.1:17373' });
    expect(JSON.stringify(useAgentConnectionStore.getState())).not.toContain('bootstrap-secret');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('arms only launcher pages for one-shot Browser Writer activation and scrubs the flag', async () => {
    const session = storage();
    const replaceState = vi.fn();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname === '/health'
      ? response({ ok: true })
      : response({ ok: true, protocolVersion: '1' }));
    const location = {
      href: 'http://127.0.0.1:37522/?agentUrl=http%3A%2F%2F127.0.0.1%3A17373&agentToken=bootstrap-secret&activateBrowserWriter=1#/app',
      search: '?agentUrl=http%3A%2F%2F127.0.0.1%3A17373&agentToken=bootstrap-secret&activateBrowserWriter=1',
      hash: '#/app',
      pathname: '/',
    };

    await expect(bootstrapLocalAgentConnection({ location, history: { replaceState }, sessionStorage: session, fetchImpl, maxAttempts: 1 })).resolves.toMatchObject({ state: 'ready' });
    expect(session.getItem(agentBootstrapStorageKeys.autoActivate)).toBe('1');
    expect(replaceState).toHaveBeenCalledWith(null, expect.any(String), '/#/app');
    expect(consumeBrowserWriterAutoActivation(session)).toBe(true);
    expect(session.getItem(agentBootstrapStorageKeys.autoActivate)).toBeNull();
    expect(consumeBrowserWriterAutoActivation(session)).toBe(false);
  });

  it('reports auth failure, clears bootstrap credentials, and does not create a binding', async () => {
    const session = storage();
    const replaceState = vi.fn();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      return pathname === '/health' ? response({ ok: true }) : response({ ok: false, error: 'invalid token' }, 401);
    });
    const location = {
      href: 'http://127.0.0.1:37522/?agentUrl=http%3A%2F%2F127.0.0.1%3A17373&agentToken=wrong#/app',
      search: '?agentUrl=http%3A%2F%2F127.0.0.1%3A17373&agentToken=wrong',
      hash: '#/app',
      pathname: '/',
    };

    const result = await bootstrapLocalAgentConnection({ location, history: { replaceState }, sessionStorage: session, fetchImpl, maxAttempts: 1 });

    expect(result.state).toBe('auth_failed');
    expect(useAgentConnectionStore.getState().status).toBe('auth_failed');
    expect(session.getItem(agentBootstrapStorageKeys.token)).toBeNull();
    expect(session.getItem(agentBootstrapStorageKeys.autoActivate)).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(null, expect.any(String), '/#/app');
  });
});
