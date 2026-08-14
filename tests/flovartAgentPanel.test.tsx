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

  it('mirrors the Agent opening flow with a Skill card, searchable picker, and autonomy menu', async () => {
    const project = { ...createWorkflowProject('Agent 空态'), id: 'project-empty' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sessionId: 'session-empty', projectId: project.id, running: false, messages: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    render(<FlovartAgentPanel project={project} onActivityChange={vi.fn()} onOpenSettings={vi.fn()} />);

    expect(await screen.findByText('每个 Skill，都是一个开场')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '选择制作 Skill' }));
    expect(screen.getByRole('dialog', { name: 'Skill' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '搜索 Skill' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭 Skill' }));

    fireEvent.click(screen.getByRole('button', { name: '生成模式' }));
    expect(screen.getByText('每个写操作前询问')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /自动模式/ }));
    expect(screen.getByRole('button', { name: '生成模式' })).toHaveTextContent('自动');

    fireEvent.click(screen.getByRole('button', { name: '使用 Skill VOX Skill' }));
    expect(await screen.findByRole('button', { name: '移除 VOX Skill' })).toBeInTheDocument();
    expect((screen.getByLabelText('开始你的创作，或者 @ 引用工作流/节点/资源') as HTMLTextAreaElement).value).toContain('$vox-director');
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

  it('pauses reversible writes in manual mode without bypassing high-risk confirmation', async () => {
    const project = { ...createWorkflowProject('手动 Agent 项目'), id: 'project-manual' };
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
    vi.stubGlobal('EventSource', StubEventSource);
    vi.stubGlobal('fetch', vi.fn(async input => new Response(JSON.stringify(String(input).includes('/agent/flovart/session')
      ? { sessionId: 'session-manual', projectId: project.id, running: false, messages: [] }
      : { ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    render(<FlovartAgentPanel project={project} onActivityChange={vi.fn()} onOpenSettings={vi.fn()} />);
    await waitFor(() => expect(StubEventSource.current).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '生成模式' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /手动模式/ }));
    StubEventSource.current!.emit('tool_call', {
      requestId: 'request-manual-create',
      envelope: {
        id: 'command-manual-create', command: 'workflow.node.create',
        args: { type: 'text', title: '待确认大纲' }, source: 'agent', idempotencyKey: 'manual-create-v1',
      },
    });

    expect(await screen.findByText('Agent 请求确认')).toBeInTheDocument();
    expect(useWorkflowStore.getState().projects[0].nodes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '允许' }));
    await waitFor(() => expect(useWorkflowStore.getState().projects[0].nodes).toHaveLength(1));
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

  it('selects @ workflow and asset references, focuses node chips, and sends bound context', async () => {
    const project = { ...createWorkflowProject('引用项目'), id: 'project-reference', nodes: [
      { ...createWorkflowProject('临时').nodes[0], id: 'video-node', type: 'video' as const, title: '主视频' },
    ] };
    const onFocusNode = vi.fn();
    const turnBodies: Array<{ prompt?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      if (String(input).includes('/agent/flovart/turn')) {
        turnBodies.push(JSON.parse(String(init?.body)));
        return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ sessionId: 'session-ref', projectId: project.id, running: false, messages: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    render(<FlovartAgentPanel project={project} onActivityChange={vi.fn()} onOpenSettings={vi.fn()} onFocusNode={onFocusNode} assetLibrary={{ folders: [], items: [{ id: 'asset-1', name: '角色定帧', folderIds: [], tags: [], dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png', width: 512, height: 512, createdAt: 1 }] }} />);
    const input = await screen.findByPlaceholderText('告诉 Flovart Agent 你想制作什么');
    fireEvent.change(input, { target: { value: '参考 @主' } });
    fireEvent.click(screen.getByRole('option', { name: /主视频/ }));
    fireEvent.click(screen.getByRole('button', { name: '定位节点 主视频' }));
    expect(onFocusNode).toHaveBeenCalledWith('video-node');
    fireEvent.change(input, { target: { value: '和 @角色' } });
    fireEvent.click(screen.getByRole('option', { name: /角色定帧/ }));
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(turnBodies[0]?.prompt).toContain('@主视频（工作流节点 nodeId=video-node）'));
    expect(turnBodies[0]?.prompt).toContain('@角色定帧（我的素材 assetId=asset-1）');
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
