import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FlovartAgentPanel } from '../components/agent/FlovartAgentPanel';
import { createWorkflowProject } from '../components/workflow/store';
import { getManagedAgentConnection } from '../services/managedAgentConnection';
import type * as BrowserAgentKernelModule from '../services/browserAgentKernel';

// 「待发送」托盘（照 openai/codex）：Enter 插话、Tab 排队、空闲自动出队、取回编辑、停止退回、立即发送、删除、边界送达 / 未送达重提。
const spies = vi.hoisted(() => ({
  send: vi.fn(async (_text: string) => undefined as unknown),
  steer: vi.fn((_text: string, _images?: unknown, _id?: string) => true),
  withdrawSteer: vi.fn((_id: string) => true),
  takePendingSteers: vi.fn(() => [] as string[]),
  cancel: vi.fn(),
  listeners: new Set<(event: { type: string; [key: string]: unknown }) => void>(),
}));

vi.mock('../services/managedAgentConnection', () => ({ getManagedAgentConnection: vi.fn() }));

vi.mock('../services/browserAgentKernel', async importOriginal => {
  const actual = await importOriginal<typeof BrowserAgentKernelModule>();
  class StubKernel {
    constructor(options: { projectId: string }) {
      const base: Record<string, unknown> = {
        openSession: async () => undefined,
        snapshot: async () => ({ sessionId: 'session-queue', projectId: options.projectId, running: false, messages: [] }),
        subscribe: (listener: (event: { type: string }) => void) => { spies.listeners.add(listener); return () => spies.listeners.delete(listener); },
        close: async () => undefined,
        send: (text: string) => spies.send(text),
        steer: (text: string, images?: unknown, id?: string) => spies.steer(text, images, id),
        withdrawSteer: (id: string) => spies.withdrawSteer(id),
        takePendingSteers: () => spies.takePendingSteers(),
        cancel: () => spies.cancel(),
        listSessions: async () => [],
      };
      return new Proxy(base, { get: (target, prop) => (prop in target ? target[prop as string] : prop === 'then' ? undefined : async () => []) }) as unknown as StubKernel;
    }
  }
  return { ...actual, BrowserAgentKernel: StubKernel };
});

const key = {
  id: 'key-hark',
  provider: 'openai',
  key: 'sk-test',
  status: 'ok',
  routeMappings: [{ routeId: 'hark', order: 0, target: { kind: 'runtime-capability', capability: 'agent-text' } }],
  createdAt: 1,
  updatedAt: 1,
} as never;

const emit = (event: { type: string; [key: string]: unknown }) => act(() => { spies.listeners.forEach(listener => listener(event)); });

/** 让内核的 send 挂起，返回放行函数（每次 send 一个）。 */
function holdTurns() {
  const releases: Array<() => void> = [];
  spies.send.mockImplementation(() => new Promise(resolve => { releases.push(() => resolve(undefined)); }));
  return releases;
}

async function mountRunning(title: string) {
  const releases = holdTurns();
  const project = { ...createWorkflowProject(title), id: `project-${title}` };
  render(<FlovartAgentPanel project={project} onActivityChange={vi.fn()} onOpenSettings={vi.fn()} userApiKeys={[key]} />);
  const composer = await screen.findByLabelText('开始你的创作，或者 @ 引用工作流/节点/资源') as HTMLTextAreaElement;
  await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: '先做 A' } });
  fireEvent.keyDown(composer, { key: 'Enter' });
  await waitFor(() => expect(spies.send).toHaveBeenCalledTimes(1));
  await screen.findByRole('button', { name: '停止' });
  return { composer, releases };
}

function type(composer: HTMLTextAreaElement, text: string, keyName: 'Enter' | 'Tab') {
  fireEvent.change(composer, { target: { value: text } });
  fireEvent.keyDown(composer, { key: keyName });
}

const rows = () => screen.queryAllByTestId('agent-input-queue-row');
const rowTexts = () => rows().map(row => row.querySelector('.agent-input-queue__text')?.textContent);

describe('Flovart Agent panel pending input tray', () => {
  beforeEach(() => {
    spies.send.mockReset().mockResolvedValue(undefined);
    spies.steer.mockReset().mockReturnValue(true);
    spies.withdrawSteer.mockReset().mockReturnValue(true);
    spies.takePendingSteers.mockReset().mockReturnValue([]);
    spies.cancel.mockReset();
    spies.listeners.clear();
    vi.mocked(getManagedAgentConnection).mockResolvedValue(null as never);
  });

  it('Enter steers and Tab queues while running; the tray lists steers first and the edit hint only with queued items', async () => {
    const { composer } = await mountRunning('route');
    type(composer, '先写脚本', 'Enter');
    expect(spies.steer).toHaveBeenCalledTimes(1);
    expect(spies.steer.mock.calls[0][0]).toContain('先写脚本');
    expect(screen.getByTestId('agent-input-queue')).toHaveTextContent('1 条待发送');
    expect(screen.getByText('下一步工具结束后送达')).toBeInTheDocument();
    expect(screen.queryByText(/取回最后一条编辑/)).not.toBeInTheDocument();
    expect(composer.value).toBe('');

    type(composer, '排队一', 'Tab');
    expect(spies.steer).toHaveBeenCalledTimes(1);
    type(composer, '插话二', 'Enter');
    expect(spies.steer).toHaveBeenCalledTimes(2);
    expect(rowTexts()).toEqual(['先写脚本', '插话二', '排队一']);
    expect(screen.getByTestId('agent-input-queue')).toHaveTextContent('3 条待发送');
    expect(screen.getByText(/取回最后一条编辑/)).toBeInTheDocument();
    // 插话行只有删除，排队行有 ↑ 与删除。
    expect(within(rows()[0]).queryByRole('button', { name: /立即发送/ })).toBeNull();
    expect(within(rows()[2]).getByRole('button', { name: /立即发送/ })).toBeInTheDocument();
    // 只有一轮在跑：插话不开新一轮。
    expect(spies.send).toHaveBeenCalledTimes(1);
  });

  it('queues Enter instead of steering while the answer is streaming', async () => {
    const { composer } = await mountRunning('streaming');
    emit({ type: 'message_start', message: { role: 'assistant' } });
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '最终回复正在写…' } });
    type(composer, '别插进去', 'Enter');
    expect(spies.steer).not.toHaveBeenCalled();
    expect(rowTexts()).toEqual(['别插进去']);
    expect(within(rows()[0]).getByRole('button', { name: /立即发送/ })).toBeInTheDocument();
  });

  it('shows a steer in the transcript only once the loop picks it up at the boundary', async () => {
    const { composer } = await mountRunning('pickup');
    type(composer, '顺便做 B', 'Enter');
    const steerId = String(spies.steer.mock.calls[0][2]);
    expect(steerId).toBeTruthy();
    expect(screen.queryByText('顺便做 B', { selector: '.workflow-agent__messages *' })).toBeNull();
    emit({ type: 'message_start', message: { role: 'user' } });
    emit({ type: 'steer_delivered', steerId });
    await waitFor(() => expect(screen.queryByTestId('agent-input-queue')).not.toBeInTheDocument());
    expect(screen.getAllByText('顺便做 B').length).toBeGreaterThan(0);
  });

  it('drains queued items FIFO, one turn at a time, once the run goes idle', async () => {
    const { composer, releases } = await mountRunning('drain');
    type(composer, '第一条', 'Tab');
    type(composer, '第二条', 'Tab');
    expect(rowTexts()).toEqual(['第一条', '第二条']);
    await act(async () => { releases[0](); });
    await waitFor(() => expect(spies.send).toHaveBeenCalledTimes(2));
    expect(spies.send.mock.calls[1][0]).toContain('第一条');
    expect(rowTexts()).toEqual(['第二条']);
    await act(async () => { releases[1](); });
    await waitFor(() => expect(spies.send).toHaveBeenCalledTimes(3));
    expect(spies.send.mock.calls[2][0]).toContain('第二条');
    await waitFor(() => expect(screen.queryByTestId('agent-input-queue')).not.toBeInTheDocument());
  });

  it('resubmits a steer that the run never picked up as the next turn', async () => {
    const { composer, releases } = await mountRunning('fallback');
    type(composer, '没赶上的插话', 'Enter');
    type(composer, '排队的', 'Tab');
    const steerId = String(spies.steer.mock.calls[0][2]);
    spies.takePendingSteers.mockReturnValue([steerId]);
    await act(async () => { releases[0](); });
    await waitFor(() => expect(spies.send).toHaveBeenCalledTimes(2));
    expect(spies.takePendingSteers).toHaveBeenCalled();
    // 没送达的插话排在原有排队消息之前。
    expect(spies.send.mock.calls[1][0]).toContain('没赶上的插话');
    expect(rowTexts()).toEqual(['排队的']);
  });

  it('pops the last queued item back into the composer with Alt+↑ and Shift+←', async () => {
    const { composer } = await mountRunning('pop');
    type(composer, '排队一', 'Tab');
    type(composer, '排队二', 'Tab');
    fireEvent.change(composer, { target: { value: '' } });
    fireEvent.keyDown(composer, { key: 'ArrowUp', altKey: true });
    expect(composer.value).toBe('排队二');
    expect(rowTexts()).toEqual(['排队一']);
    fireEvent.change(composer, { target: { value: '' } });
    composer.setSelectionRange(0, 0);
    fireEvent.keyDown(composer, { key: 'ArrowLeft', shiftKey: true });
    expect(composer.value).toBe('排队一');
    expect(screen.queryByTestId('agent-input-queue')).not.toBeInTheDocument();
  });

  it('stop puts every pending item back into the composer and sends none of them', async () => {
    const { composer, releases } = await mountRunning('stop');
    type(composer, '插话', 'Enter');
    type(composer, '排队', 'Tab');
    fireEvent.change(composer, { target: { value: '还在写' } });
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(spies.cancel).toHaveBeenCalledTimes(1);
    expect(composer.value).toBe('插话\n\n排队\n\n还在写');
    expect(screen.queryByTestId('agent-input-queue')).not.toBeInTheDocument();
    await act(async () => { releases[0](); });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(spies.send).toHaveBeenCalledTimes(1);
  });

  it('send-now turns a queued item into a steer while running; delete removes items and withdraws steers', async () => {
    const { composer } = await mountRunning('send-now');
    type(composer, '稍后', 'Tab');
    type(composer, '再说', 'Tab');
    fireEvent.click(within(rows()[1]).getByRole('button', { name: /立即发送/ }));
    expect(spies.steer).toHaveBeenCalledTimes(1);
    expect(spies.steer.mock.calls[0][0]).toContain('再说');
    expect(rowTexts()).toEqual(['再说', '稍后']);
    expect(within(rows()[0]).getByText('下一步工具结束后送达')).toBeInTheDocument();

    fireEvent.click(within(rows()[1]).getByRole('button', { name: /删除/ }));
    expect(rowTexts()).toEqual(['再说']);
    fireEvent.click(within(rows()[0]).getByRole('button', { name: /删除/ }));
    expect(spies.withdrawSteer).toHaveBeenCalledWith(String(spies.steer.mock.calls[0][2]));
    expect(screen.queryByTestId('agent-input-queue')).not.toBeInTheDocument();

    // 已经到边界被取走的插话撤不回：留在托盘里，等送达。
    type(composer, '来不及撤', 'Enter');
    spies.withdrawSteer.mockReturnValue(false);
    fireEvent.click(within(rows()[0]).getByRole('button', { name: /删除/ }));
    expect(rowTexts()).toEqual(['来不及撤']);
  });

  it('folds the tray with its chevron header (keyboard-operable button with aria-expanded)', async () => {
    const { composer } = await mountRunning('fold');
    type(composer, '留着', 'Tab');
    const toggle = screen.getByRole('button', { name: '1 条待发送' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(rows()).toHaveLength(0);
    fireEvent.click(toggle);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].querySelector('.agent-input-queue__text')).toHaveAttribute('title', '留着');
  });
});
