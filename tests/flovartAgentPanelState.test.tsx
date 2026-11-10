import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FlovartAgentPanel } from '../components/agent/FlovartAgentPanel';
import { createWorkflowProject } from '../components/workflow/store';
import { getManagedAgentConnection } from '../services/managedAgentConnection';

vi.mock('../services/managedAgentConnection', () => ({
  getManagedAgentConnection: vi.fn(),
}));

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('Flovart Agent panel explicit state', () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.mocked(getManagedAgentConnection).mockResolvedValue({ state: 'ready', url: '', token: 'desktop-token', managed: true });
  });

  it('copies the whole conversation as markdown from the header', async () => {
    const project = { ...createWorkflowProject('复制对话'), id: 'project-copy' };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => (
      String(input).includes('/agent/flovart/session')
        ? json({
          sessionId: 'session-copy', projectId: project.id, running: false,
          messages: [
            { id: 'm1', role: 'user', text: '把时长改成 15 秒' },
            { id: 'm2', role: 'assistant', text: '已改好。' },
          ],
        })
        : json({ ok: true })
    )));
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<FlovartAgentPanel project={project} onActivityChange={vi.fn()} onOpenSettings={vi.fn()} />);

    await screen.findByText('已改好。');
    fireEvent.click(screen.getByRole('button', { name: '复制整个对话' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied).toContain('## 你\n把时长改成 15 秒');
    expect(copied).toContain('## Agent\n已改好。');
    expect(await screen.findByRole('status')).toHaveTextContent('已复制对话');
  });

  it('returns the composer to idle after Stop even when the turn never settles', async () => {
    const project = { ...createWorkflowProject('停止项目'), id: 'project-stop' };
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/agent/flovart/turn')) return new Promise<Response>(() => undefined);
      if (url.includes('/agent/flovart/cancel')) { cancel(); return json({ ok: true }); }
      return json({ sessionId: 'session-stop', projectId: project.id, running: false, messages: [] });
    }));
    const onActivityChange = vi.fn();
    render(<FlovartAgentPanel project={project} onActivityChange={onActivityChange} onOpenSettings={vi.fn()} />);

    const input = await screen.findByPlaceholderText('告诉 Flovart Agent 你想制作什么');
    fireEvent.change(input, { target: { value: '写一个分镜' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    fireEvent.click(await screen.findByRole('button', { name: '停止' }));

    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: '发送' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();
    expect(onActivityChange).toHaveBeenLastCalledWith('idle');
  });

  it('keeps only one composer popover open at a time and Escape closes it', async () => {
    const project = { ...createWorkflowProject('浮层项目'), id: 'project-layers' };
    vi.stubGlobal('fetch', vi.fn(async () => json({ sessionId: 'session-layers', projectId: project.id, running: false, messages: [] })));
    render(<FlovartAgentPanel project={project} onActivityChange={vi.fn()} onOpenSettings={vi.fn()} />);

    const input = await screen.findByPlaceholderText('告诉 Flovart Agent 你想制作什么');
    fireEvent.click(screen.getByRole('button', { name: '生成模式' }));
    expect(screen.getByRole('menu', { name: '生成模式' })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '参考 @' } });
    expect(screen.getByRole('listbox', { name: '@ 引用节点和资产' })).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: '生成模式' })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox', { name: '@ 引用节点和资产' })).not.toBeInTheDocument());
  });
});
