import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IrisAgentPanel } from '../components/agent/IrisAgentPanel';
import { createWorkflowProject } from '../components/workflow/store';
import { getManagedAgentConnection } from '../services/managedAgentConnection';
import type * as BrowserAgentKernelModule from '../services/browserAgentKernel';

const spies = vi.hoisted(() => ({
  send: vi.fn(async (_text: string) => undefined as unknown),
}));

vi.mock('../services/managedAgentConnection', () => ({ getManagedAgentConnection: vi.fn() }));

vi.mock('../services/browserAgentKernel', async importOriginal => {
  const actual = await importOriginal<typeof BrowserAgentKernelModule>();
  class StubKernel {
    constructor(options: { projectId: string }) {
      const base: Record<string, unknown> = {
        openSession: async () => undefined,
        snapshot: async () => ({
          sessionId: 'session-quote',
          projectId: options.projectId,
          running: false,
          messages: [
            { id: 'u1', role: 'user', text: '补三张会议图' },
            { id: 'a1', role: 'assistant', text: '已提交 Canvas 生成任务（3 个），尚不代表生成完成。' },
          ],
        }),
        subscribe: () => () => undefined,
        close: async () => undefined,
        send: (text: string) => spies.send(text),
        steer: () => true,
        cancel: () => undefined,
      };
      return new Proxy(base, { get: (target, prop) => (prop in target ? target[prop as string] : prop === 'then' ? undefined : async () => []) }) as unknown as StubKernel;
    }
  }
  return { ...actual, BrowserAgentKernel: StubKernel };
});

const key = {
  id: 'key-quote', provider: 'openai', key: 'sk-test', status: 'ok',
  routeMappings: [{ routeId: 'hark', order: 0, target: { kind: 'runtime-capability', capability: 'agent-text' } }],
  createdAt: 1, updatedAt: 1,
} as never;

describe('Iris Agent panel quote reply', () => {
  beforeEach(() => {
    spies.send.mockReset().mockResolvedValue(undefined);
    vi.mocked(getManagedAgentConnection).mockResolvedValue(null as never);
  });

  it('quotes an assistant message into the next user turn and clears the bar after sending', async () => {
    const project = { ...createWorkflowProject('引用'), id: 'project-quote' };
    render(<IrisAgentPanel project={project} onActivityChange={vi.fn()} onOpenSettings={vi.fn()} userApiKeys={[key]} />);
    const quoteButton = await screen.findByRole('button', { name: '引用回复' });
    fireEvent.click(quoteButton);
    const bar = screen.getByTestId('agent-quote-bar');
    expect(bar).toHaveTextContent('> 已提交 Canvas 生成任务（3 个）');

    // × 取消，再引用一次
    fireEvent.click(screen.getByRole('button', { name: '取消引用' }));
    expect(screen.queryByTestId('agent-quote-bar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '引用回复' }));

    const composer = await screen.findByLabelText('开始你的创作，或者 @ 引用工作流/节点/资源') as HTMLTextAreaElement;
    await waitFor(() => expect(composer).toBeEnabled());
    fireEvent.change(composer, { target: { value: '这三张改成竖版' } });
    fireEvent.keyDown(composer, { key: 'Enter' });
    await waitFor(() => expect(spies.send).toHaveBeenCalledTimes(1));
    expect(spies.send.mock.calls[0][0]).toContain('> 已提交 Canvas 生成任务（3 个），尚不代表生成完成。\n\n这三张改成竖版');
    expect(screen.queryByTestId('agent-quote-bar')).not.toBeInTheDocument();
  });
});
