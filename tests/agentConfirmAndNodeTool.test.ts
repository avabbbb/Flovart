import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { confirmGrantKey, confirmScopesFor, describeAgentConfirmation } from '../components/agent/agentConfirmCopy';
import { agentToolLabel, displayUserTurnText } from '../components/agent/agentTurnText';
import { createBrowserAgentTools, NODE_TOOL_TOOL_NAME } from '../services/browserAgentKernel';
import { setWorkflowNodeToolRunner } from '../services/workflowDispatcher';

const video = createWorkflowNode('video-1', 'video', { x: 0, y: 0 }, { storageKey: 'video-key', mimeType: 'video/mp4', name: 'dragon.mp4' });
video.title = '视频 1';

describe('Agent confirmation copy', () => {
  it('describes a canvas tool in plain words with node titles instead of IDs', () => {
    const copy = describeAgentConfirmation(
      { kind: 'other', command: 'workflow.node.tool', args: { nodeId: 'video-1', tool: 'video-extract-frame', position: 'current', currentTimeSec: 10 } },
      [video], 'zho', 'workflow.node.tool：video-1',
    );
    expect(copy.title).toBe('导出视频帧「视频 1」');
    expect(copy.detail).toBe('当前帧 10.0s');
    expect(JSON.stringify(copy)).not.toContain('video-1');
  });

  it('never shows raw command text as the sentence', () => {
    expect(describeAgentConfirmation(undefined, [], 'zho', 'workflow.node.create：abc').title).toBe('执行一个画布操作');
    expect(describeAgentConfirmation({ kind: 'other', command: 'workflow.node.create', risk: 'write' }, [], 'en').title).toBe('Edit the canvas');
  });

  it('limits approval scope by risk: deletes ask every time, paid tools stop at this chat', () => {
    expect(confirmScopesFor({ kind: 'destructive', command: 'workflow.node.delete' })).toEqual(['once']);
    expect(confirmScopesFor({ kind: 'generation', command: 'workflow.node.run' }, { offerMandate: true })).toEqual(['once', 'session']);
    expect(confirmScopesFor({ kind: 'other', command: 'workflow.node.tool', args: { tool: 'upscale' } })).toEqual(['once', 'session']);
    expect(confirmScopesFor({ kind: 'other', command: 'workflow.node.tool', args: { tool: 'video-extract-frame' }, risk: 'write' })).toEqual(['once', 'session', 'always']);
    expect(confirmGrantKey({ kind: 'destructive', command: 'workflow.node.delete' })).toBeNull();
    expect(confirmGrantKey({ kind: 'other', command: 'workflow.node.tool', args: { tool: 'video-trim' }, risk: 'write' })).toBe('workflow.node.tool:video-trim:write');
  });
});

describe('Agent transcript text', () => {
  it('hides model-only context such as node IDs from the user bubble', () => {
    const stored = '[创作模式: 视频创作]\n抽第十秒的帧\n\n引用上下文：\n- @视频 1（工作流节点 nodeId=Aj1Rv7vsBZ9CPa5icN-Li）\n\n已附带画面：\nAj1Rv7vsBZ9CPa5icN-Li：视频「视频 1」首/中/尾帧';
    expect(displayUserTurnText(stored)).toBe('抽第十秒的帧\n\n引用：@视频 1');
    expect(agentToolLabel('flovart_workflow_inspect', 'zho')).toBe('读取画布');
    expect(agentToolLabel('plugin_tool', 'zho')).toBe('plugin_tool');
  });
});

describe('built-in Agent canvas tools', () => {
  afterEach(() => setWorkflowNodeToolRunner(undefined));

  it('exposes every registry node tool to the built-in Agent and extracts a frame at a given second', async () => {
    const project = { ...createWorkflowProject('抽帧'), id: 'project-frame', nodes: [video] };
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
    const runner = vi.fn(async () => {
      const frame = createWorkflowNode('frame-1', 'image', { x: 400, y: 0 }, { storageKey: 'frame-key', mimeType: 'image/png' });
      const next = { ...useWorkflowStore.getState().projects[0], nodes: [video, frame] };
      useWorkflowStore.getState().updateProject(project.id, { nodes: next.nodes });
      return { status: 'committed', project: next };
    });
    setWorkflowNodeToolRunner(runner);
    const tools = createBrowserAgentTools({ projectId: project.id, confirm: vi.fn(async () => true), activeChangeSetId: 'turn-1' });
    const tool = tools.find(item => item.name === NODE_TOOL_TOOL_NAME)!;
    expect(tool).toBeDefined();
    // 工具清单来自 Operation 注册表：后来接入的工具自动可用。
    expect(tool.description).toContain('video-extract-frame');
    expect(tool.description).toContain('audio-stem-split');

    const result = await tool.execute('call-1', { nodeId: 'video-1', tool: 'video-extract-frame', position: 'current', currentTimeSec: 10 } as never, undefined as never);
    expect(runner).toHaveBeenCalledWith(project.id, 'video-1', 'video-extract-frame', { position: 'current', currentTimeSec: 10 });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ committed: true, outputNodeIds: ['frame-1'] });
  });
});
