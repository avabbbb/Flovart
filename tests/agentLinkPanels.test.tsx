import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentLinkStatus } from '../components/agent/AgentLinkStatus';
import { AgentRunLog, activityLine, linkLine, runLogText } from '../components/agent/AgentRunLog';
import { useAgentActivityStore, type AgentActivityEntry } from '../stores/useAgentActivityStore';
import { useAgentConnectionStore } from '../stores/useAgentConnectionStore';

const URL_ = 'http://127.0.0.1:17372';
const entry = (id: string, at: string, patch: Partial<AgentActivityEntry> = {}): AgentActivityEntry => ({
  id, at, command: 'workflow.apply', source: 'mcp', agentIdentity: 'deepseek-harness', projectId: 'p', summary: '新增 1 个节点', status: 'ok', durationMs: 12, error: null, ...patch,
});

beforeEach(() => {
  useAgentConnectionStore.getState().reset();
  useAgentActivityStore.getState().clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('连接状态 panel', () => {
  it('shows a badge with text, the classified cause, the next step and a copyable command', () => {
    useAgentConnectionStore.getState().setStatus('error', { url: URL_, issue: { kind: 'refused', at: new Date().toISOString(), url: URL_ } });
    render(<AgentLinkStatus />);
    expect(screen.getByTestId('agent-link-badge')).toHaveTextContent('连接中断');
    const issue = screen.getByTestId('agent-link-issue');
    expect(issue).toHaveAttribute('role', 'alert');
    expect(issue).toHaveTextContent('本机 Agent 没有运行');
    expect(issue).toHaveTextContent('下一步');
    expect(within(issue).getByText('npm run dsh:start')).toBeInTheDocument();
    expect(screen.getByTitle(URL_)).toBeInTheDocument();
  });

  it('Reconnect requests a restart and English copy carries no Chinese', () => {
    useAgentConnectionStore.getState().setStatus('auth_failed', { url: URL_, issue: { kind: 'auth', at: new Date().toISOString(), url: URL_ } });
    const { container } = render(<AgentLinkStatus language="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(useAgentConnectionStore.getState().reconnectNonce).toBe(1);
    expect(container.textContent).not.toMatch(/[\u4e00-\u9fff]/);
    expect(screen.getByTestId('agent-link-badge')).toHaveTextContent('Credential expired');
  });

  it('a ready link shows no stale issue', () => {
    useAgentConnectionStore.getState().setStatus('error', { issue: { kind: 'timeout', at: new Date().toISOString(), url: URL_ } });
    useAgentConnectionStore.getState().setStatus('ready', { url: URL_ });
    render(<AgentLinkStatus />);
    expect(screen.queryByTestId('agent-link-issue')).toBeNull();
    expect(screen.getByTestId('agent-link-badge')).toHaveTextContent('已连接');
  });
});

describe('运行日志 panel', () => {
  it('merges link transitions and agent steps chronologically with levels and timestamps', () => {
    useAgentActivityStore.getState().upsert(entry('a1', '2026-11-15T10:00:01.000Z'));
    useAgentActivityStore.getState().upsert(entry('a2', '2026-11-15T10:00:03.000Z', { status: 'error', summary: null, error: { code: 'REVISION_CONFLICT', message: '修订不一致' } }));
    render(<AgentRunLog />);
    act(() => { useAgentConnectionStore.getState().setStatus('error', { url: URL_, issue: { kind: 'refused', at: new Date().toISOString(), url: URL_ } }); });
    const feed = screen.getByTestId('agent-activity-feed');
    const items = within(feed).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute('data-level', 'ok');
    expect(items[1]).toHaveAttribute('data-level', 'error');
    expect(items[1]).toHaveTextContent('REVISION_CONFLICT: 修订不一致');
    expect(items[2]).toHaveTextContent('本机 Agent 没有运行');
    expect(items[0].querySelector('time')?.textContent).toMatch(/^\d\d:\d\d:\d\d$/);
  });

  it('filters by channel, clears without the history sync re-adding old lines', () => {
    useAgentActivityStore.getState().upsert(entry('a1', '2020-01-01T00:00:00.000Z'));
    useAgentConnectionStore.getState().setStatus('connecting', { url: URL_ });
    render(<AgentRunLog />);
    fireEvent.change(screen.getByRole('combobox', { name: '筛选' }), { target: { value: 'link' } });
    expect(within(screen.getByTestId('agent-activity-feed')).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '清空日志' }));
    expect(screen.queryByTestId('agent-activity-feed')).toBeNull();
    act(() => { useAgentActivityStore.getState().replace([entry('a1', '2020-01-01T00:00:00.000Z')], []); });
    expect(useAgentActivityStore.getState().entries).toHaveLength(0);
  });

  it('pauses auto-scroll when the reader scrolls up and offers a jump to the newest lines', () => {
    for (let i = 0; i < 5; i += 1) useAgentActivityStore.getState().upsert(entry(`a${i}`, `2026-11-15T10:00:0${i}.000Z`));
    render(<AgentRunLog />);
    const feed = screen.getByTestId('agent-activity-feed');
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(feed, 'clientHeight', { configurable: true, value: 200 });
    feed.scrollTop = 100;
    fireEvent.scroll(feed);
    act(() => { useAgentActivityStore.getState().upsert(entry('new', '2026-11-15T10:00:09.000Z')); });
    expect(feed.scrollTop).toBe(100);
    const jump = screen.getByTestId('agent-run-log-jump');
    expect(jump).toHaveTextContent('1 条新日志');
    fireEvent.click(jump);
    expect(feed.scrollTop).toBe(1000);
    expect(screen.queryByTestId('agent-run-log-jump')).toBeNull();
  });

  it('copies plain text lines without tokens', () => {
    const lines = [activityLine(entry('a1', '2026-11-15T10:00:01.000Z'), 'en'), linkLine({ id: 'l', at: '2026-11-15T10:00:02.000Z', status: 'auth_failed', issueKind: 'auth', url: URL_ }, 'en')];
    const text = runLogText(lines);
    expect(text).toMatch(/OK   \[deepseek-harness\] Apply canvas changes · 12 ms/);
    expect(text).toMatch(/ERR  \[Link\] Credential expired · The connection credential expired/);
    expect(text).not.toMatch(/token/i);
  });
});
