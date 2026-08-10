import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FlovartAgentPanel } from '../components/agent/FlovartAgentPanel';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { getManagedAgentConnection } from '../services/managedAgentConnection';
import { queuePendingProductionSkill } from '../stores/useProductionSkillComposerStore';

vi.mock('../services/managedAgentConnection', () => ({
  getManagedAgentConnection: vi.fn(),
}));

class StubEventSource {
  static current?: StubEventSource;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<(event: Event) => void>>();

  constructor() { StubEventSource.current = this; }
  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.forEach(listener => listener(new MessageEvent(type, { data: JSON.stringify(data) })));
  }
  close() {}
}

describe('Flovart Agent panel', () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.mocked(getManagedAgentConnection).mockResolvedValue({
      state: 'ready',
      url: 'http://127.0.0.1:17372',
      token: 'desktop-token',
      managed: true,
    });
  });

  it('shows a localized configuration state while keeping retry available', async () => {
    const onOpenSettings = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
        sessionId: 'session-1',
        projectId: 'project-1',
        running: false,
        messages: [{
          id: 'assistant-error',
          role: 'assistant',
          text: '',
          error: 'No agent-text route is configured',
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })));

    render(<FlovartAgentPanel project={{ ...createWorkflowProject('Agent 项目'), id: 'project-1' }} onActivityChange={vi.fn()} onOpenSettings={onOpenSettings} />);

    expect(await screen.findByText('需要配置')).toBeInTheDocument();
    expect(screen.getByText('请在设置的“模型映射”中为 Agent 文本能力配置可用线路。')).toBeInTheDocument();
    expect(screen.queryByText('No agent-text route is configured')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开模型映射' }));
    expect(onOpenSettings).toHaveBeenCalledOnce();

    const composer = screen.getByPlaceholderText('请先配置 Agent 文本模型映射');
    expect(composer).toBeEnabled();
    fireEvent.change(composer, { target: { value: '配置完成后重试' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled());
  });

  it('applies reversible Agent edits directly and confirms only irreversible deletes', async () => {
    const project = { ...createWorkflowProject('Agent 项目'), id: 'project-1' };
    const onActivityChange = vi.fn();
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
    vi.stubGlobal('EventSource', StubEventSource);
    vi.stubGlobal('fetch', vi.fn(async input => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('/agent/flovart/session')
        ? { sessionId: 'session-1', projectId: project.id, running: false, messages: [] }
        : { ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    render(<FlovartAgentPanel project={project} onActivityChange={onActivityChange} onOpenSettings={vi.fn()} />);
    await waitFor(() => expect(StubEventSource.current).toBeDefined());
    StubEventSource.current!.emit('tool_call', {
      requestId: 'request-1',
      envelope: {
        id: 'command-1',
        command: 'workflow.node.create',
        args: { type: 'text', title: '脚本大纲' },
        source: 'agent',
        idempotencyKey: 'agent-create-outline-v1',
      },
    });

    await waitFor(() => expect(useWorkflowStore.getState().projects[0].nodes).toHaveLength(1));
    expect(screen.queryByText('Agent 请求确认')).not.toBeInTheDocument();

    const createdId = useWorkflowStore.getState().projects[0].nodes[0].id;
    StubEventSource.current!.emit('tool_call', {
      requestId: 'request-2',
      envelope: {
        id: 'command-2',
        command: 'workflow.node.delete',
        args: { nodeId: createdId },
        source: 'agent',
        idempotencyKey: 'agent-delete-outline-v1',
      },
    });

    expect(await screen.findByText('Agent 请求确认')).toBeInTheDocument();
    expect(onActivityChange).toHaveBeenCalledWith('waiting');
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    await waitFor(() => expect(screen.queryByText('Agent 请求确认')).not.toBeInTheDocument());
    expect(useWorkflowStore.getState().projects[0].nodes).toHaveLength(1);
  });

  it('sends a selected Production Skill as a typed attachment to the main PI turn', async () => {
    const project = { ...createWorkflowProject('Agent 项目'), id: 'project-1' };
    const turnBodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input);
      if (url.includes('/agent/flovart/turn')) {
        turnBodies.push(JSON.parse(String(init?.body)));
        return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({
        sessionId: 'session-1',
        projectId: project.id,
        running: false,
        messages: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    render(<FlovartAgentPanel project={project} onActivityChange={vi.fn()} onOpenSettings={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '选择制作 Skill' }));
    fireEvent.click(screen.getByRole('button', { name: '添加 VOX Skill' }));
    expect(await screen.findByRole('button', { name: '移除 VOX Skill' })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('告诉 Flovart Agent 你想制作什么'), {
      target: { value: '制作一个 30 秒中文剪纸解释视频' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(turnBodies).toEqual([expect.objectContaining({
      projectId: project.id,
      prompt: '制作一个 30 秒中文剪纸解释视频',
      skillAttachment: expect.objectContaining({
        id: 'community.vox-director',
        version: '1.0.0',
        contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    })]));
  });

  it('keeps a queued Production Skill when the restored session snapshot arrives later', async () => {
    const project = { ...createWorkflowProject('VOX 排队项目'), id: 'project-queued-skill' };
    let resolveSession!: () => void;
    const sessionResponse = new Promise<Response>(resolve => {
      resolveSession = () => resolve(new Response(JSON.stringify({
        sessionId: 'session-queued',
        projectId: project.id,
        running: false,
        messages: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });
    vi.stubGlobal('fetch', vi.fn((input) => (
      String(input).includes('/agent/flovart/session')
        ? sessionResponse
        : Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    )));
    queuePendingProductionSkill({
      projectId: project.id,
      skillId: 'community.vox-director',
      skillVersion: '1.0.0',
      skillName: 'VOX Skill',
      prompt: '从当前画布制作 VOX 短片',
    });

    render(<FlovartAgentPanel project={project} onActivityChange={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(await screen.findByRole('button', { name: '移除 VOX Skill' })).toBeInTheDocument();
    resolveSession();
    await screen.findByPlaceholderText('告诉 Flovart Agent 你想制作什么');

    expect(screen.getByRole('button', { name: '移除 VOX Skill' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('从当前画布制作 VOX 短片')).toBeInTheDocument();
  });
});
