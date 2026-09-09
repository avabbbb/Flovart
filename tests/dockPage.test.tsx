// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockPage } from '../components/dock/DockPage';
import { DOCK_CHANNEL, DOCK_PROTOCOL_VERSION } from '../components/dock/protocol';
import { DockCrewClient, DockClientError, loadDockConnection, rememberDockConnection } from '../services/dockCrewClient';
import { useWorkflowStore } from '../components/workflow/store';

function mockAgentServer(overrides: Record<string, unknown> = {}) {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname + url.search, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    let payload: Record<string, unknown> = {};
    if (url.pathname === '/crew/protocol') payload = { ok: true, protocolVersion: '1', registryHash: '0'.repeat(64), capabilities: ['command', 'events', 'crew-intent'], limits: {} };
    else if (url.pathname === '/director/status') payload = { ok: true, binding: null, archivedCount: 0, projectId: null };
    else if (url.pathname === '/crew/events') payload = { ok: true, events: [], nextEventId: 0, hasMore: false };
    else if (url.pathname === '/crew/intent') payload = { ok: true, intent: { intentId: 'intent_1', projectId: 'project_1', goal: '把当前选中的三张图片建立为并行图生视频分支', status: 'completed', createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z' }, replayed: false, eventCursor: 5 };
    else payload = { ok: true, ...((overrides[url.pathname] && typeof overrides[url.pathname] === 'object' && !Array.isArray(overrides[url.pathname]) ? overrides[url.pathname] as Record<string, unknown> : {})) };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { fetchImpl, calls };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useWorkflowStore.setState({ projects: [], activeProjectId: null, hydrated: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dock crew client', () => {
  it('reads protocol, director status, intents, receipts and events over the loopback channel', async () => {
    const { fetchImpl, calls } = mockAgentServer({
      '/crew/intent/intent_1': { intent: { intentId: 'intent_1', projectId: 'project_1', goal: 'g', status: 'completed', createdAt: '', updatedAt: '' } },
      '/crew/receipt/intent_1': { receipt: { intentId: 'intent_1', status: 'completed', commands: [], eventCursor: 5 } },
    });
    const client = new DockCrewClient({ url: 'http://127.0.0.1:17372', token: 'secret-token' }, fetchImpl);
    await expect(client.protocol()).resolves.toMatchObject({ protocolVersion: '1' });
    await expect(client.directorStatus()).resolves.toMatchObject({ binding: null });
    const receipt = await client.getReceipt('intent_1');
    expect(receipt.receipt.status).toBe('completed');
    expect(calls[0].path).toBe('/crew/protocol');
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ headers: { 'x-flovart-agent-token': 'secret-token' } });
  });

  it('surfaces structured errors without leaking credentials', async () => {
    const { fetchImpl } = mockAgentServer();
    fetchImpl.mockImplementationOnce(async () => new Response(JSON.stringify({
      ok: false,
      error: { code: 'IDEMPOTENCY_CONFLICT', message: '相同 key 不同 payload', retryable: false },
    }), { status: 409, headers: { 'content-type': 'application/json' } }));
    const client = new DockCrewClient({ url: 'http://127.0.0.1:17372', token: 'secret' }, fetchImpl);
    const error = await client.submitIntent({
      goal: 'x', scope: { workspace: 'workflow', selectedObjectIds: [] }, constraints: {}, completion: {},
      idempotencyKey: 'k', projectId: 'p',
    }).catch(cause => cause);
    expect(error).toBeInstanceOf(DockClientError);
    expect(error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(String(error.message)).not.toContain('secret');
  });

  it('remembers and reloads the loopback connection', () => {
    rememberDockConnection('http://127.0.0.1:17372', 'token-abc');
    expect(loadDockConnection()).toEqual({ url: 'http://127.0.0.1:17372', token: 'token-abc' });
    localStorage.setItem('flovart.agent.url', 'https://evil.example.com');
    expect(loadDockConnection()).toBeNull();
  });
});

describe('dock plugin page', () => {
  it('renders the embedded production control surface with a stable rail', () => {
    render(<DockPage embedded />);
    expect(screen.getByTestId('dock-page')).toHaveAttribute('data-embedded', 'true');
    expect(screen.getByRole('navigation', { name: 'Flovart Dock' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /制作控制/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Workflow/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Table/ })).toBeInTheDocument();
  });

  it('shows the honest unbound director state and copyable bind command', () => {
    const { fetchImpl } = mockAgentServer();
    vi.stubGlobal('fetch', fetchImpl);
    render(<DockPage embedded />);

    expect(screen.getByRole('heading', { name: 'AI 协作' })).toBeInTheDocument();
    expect(screen.getByLabelText('Agent 地址')).not.toBeVisible();
    expect(screen.getByLabelText('Token')).not.toBeVisible();
    fireEvent.click(screen.getByText('高级连接设置 · Developer connection', { exact: true }));
    expect(screen.getByLabelText('Agent 地址')).toBeVisible();
    expect(screen.getByLabelText('Token')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Agent 地址'), { target: { value: 'http://127.0.0.1:17372' } });
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'token-abc' } });
    fireEvent.click(screen.getByRole('button', { name: '连接 Agent' }));
    return waitFor(() => expect(screen.getByRole('button', { name: '绑定' })).toBeInTheDocument()).then(() => {
    fireEvent.click(screen.getByRole('button', { name: '绑定' }));
    expect(screen.getByText('未绑定导演', { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/director\.bind --agent-identity deepseek-harness/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制绑定命令' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '绑定当前 Director Host' })).not.toBeInTheDocument();
  });
  });

  it('accepts handshake focus-surface messages from the harness host', async () => {
    render(<DockPage embedded />);
    window.postMessage({
      channel: DOCK_CHANNEL,
      version: DOCK_PROTOCOL_VERSION,
      type: 'focus-surface',
      data: { surface: 'table' },
    }, '*');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Flovart Dock · Table' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('accepts a Harness handshake and connects the local Workspace Operator', async () => {
    const { fetchImpl, calls } = mockAgentServer();
    vi.stubGlobal('fetch', fetchImpl);
    render(<DockPage embedded />);

    window.postMessage({
      channel: DOCK_CHANNEL,
      version: DOCK_PROTOCOL_VERSION,
      type: 'handshake',
      data: { agentUrl: 'http://127.0.0.1:17372', token: 'token-abc' },
    }, '*');

    await waitFor(() => expect(loadDockConnection()).toEqual({ url: 'http://127.0.0.1:17372', token: 'token-abc' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Intent' })).toBeInTheDocument());
    expect(calls.some(call => call.path === '/crew/protocol' || call.path === '/director/status')).toBe(true);
  });

  it('opens the full app in an independent window as degradation path', () => {
    const opener = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<DockPage embedded />);
    fireEvent.click(screen.getByRole('button', { name: 'Flovart Dock · Table' }));
    fireEvent.click(screen.getByRole('button', { name: /打开 Table 窗口/ }));
    expect(opener).toHaveBeenCalled();
    opener.mockRestore();
  });
});
