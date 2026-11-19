// P2-G：视频 / 整组 / 大批量运行自动走后台任务，短运行照常同步返回。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { createBrowserAgentTools, shouldRunInBackground, BACKGROUND_MIN_BATCH } from '../services/browserAgentKernel';
import { resetBrowserAgentTasks } from '../services/browserAgentTasks';
import { setWorkflowExecutor } from '../services/workflowDispatcher';
import { createWorkflowExecutor } from '../services/workflowExecutor';

const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
};

const setup = (inlineWaitMs = 30) => {
  const project = createWorkflowProject('后台');
  project.nodes = [
    createWorkflowNode('img', 'image', { x: 0, y: 0 }, { prompt: '一张图' }),
    createWorkflowNode('vid', 'video', { x: 400, y: 0 }, { prompt: '一段视频' }),
  ];
  useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
  const pending = deferred();
  const runNode = vi.fn((command: { nodeId: string }) => (command.nodeId === 'vid' ? pending.promise : Promise.resolve()).then(() => ({ artifact: { artifactId: 'a-' + command.nodeId, kind: command.nodeId === 'vid' ? 'video' : 'image', mimeType: 'image/png' } })));
  setWorkflowExecutor(createWorkflowExecutor({ runNode: runNode as never, stopNode: vi.fn() }, { createRunId: () => 'run' }));
  const confirm = vi.fn(async () => true);
  const tools = createBrowserAgentTools({ projectId: project.id, confirm, activeChangeSetId: 'turn-1', getApproval: () => ({ mode: 'yolo' }), backgroundInlineWaitMs: inlineWaitMs });
  // 按命令找工具（工具名随品牌改名，命令不变）。
  const call = async (command: string, params: Record<string, unknown>) => {
    const tool = tools.find(item => item.label === command)!;
    const out = await tool.execute('call', params as never, new AbortController().signal);
    return JSON.parse((out.content[0] as { text: string }).text);
  };
  return { project, pending, runNode, confirm, call };
};

afterEach(() => {
  resetBrowserAgentTasks();
  setWorkflowExecutor(undefined);
});

describe('auto background for long runs', () => {
  it('classifies which calls are long-running', () => {
    const nodes = [createWorkflowNode('img', 'image', { x: 0, y: 0 }), createWorkflowNode('vid', 'video', { x: 0, y: 0 })];
    expect(shouldRunInBackground('workflow.node.run', { nodeId: 'img' }, nodes)).toBe(false);
    expect(shouldRunInBackground('workflow.node.run', { nodeId: 'vid' }, nodes)).toBe(true);
    expect(shouldRunInBackground('workflow.node.run', { nodeIds: Array.from({ length: BACKGROUND_MIN_BATCH }, (_, index) => 'n' + index) }, nodes)).toBe(true);
    expect(shouldRunInBackground('workflow.group.run', { groupId: 'g' }, nodes)).toBe(true);
    expect(shouldRunInBackground('workflow.generate', { type: 'video', prompt: 'x' }, nodes)).toBe(false);
    expect(shouldRunInBackground('workflow.generate', { type: 'video', prompt: 'x', run: true }, nodes)).toBe(true);
    expect(shouldRunInBackground('workflow.generate', { nodeId: 'vid', prompt: 'x', run: true, dryRun: true }, nodes)).toBe(false);
    expect(shouldRunInBackground('workflow.generate', { nodeId: 'img', prompt: 'x', run: true }, nodes)).toBe(false);
  });

  it('a video node.run returns a taskId instead of blocking, after the same single approval', async () => {
    const { pending, runNode, confirm, call } = setup();
    const started = await call('workflow.node.run', { nodeId: 'vid' });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(started).toMatchObject({ backgrounded: true, command: 'workflow.node.run', done: false });
    expect(started.taskId).toBeTruthy();
    await vi.waitFor(() => expect(runNode).toHaveBeenCalledTimes(1));
    pending.resolve(undefined);
    await vi.waitFor(async () => expect(await call('agent.task.get', { taskId: started.taskId })).toMatchObject({ status: 'succeeded', done: true }));
  });

  it('a background run that finishes within the wait window returns its result inline', async () => {
    const { pending, call } = setup(2_000);
    pending.resolve(undefined);
    const result = await call('workflow.node.run', { nodeId: 'vid' });
    expect(result.backgrounded).toBeUndefined();
    expect(result).toMatchObject({ nodeId: 'vid' });
  });

  it('a single image run stays synchronous', async () => {
    const { runNode, call } = setup();
    const result = await call('workflow.node.run', { nodeId: 'img' });
    expect(result.taskId).toBeUndefined();
    expect(result).toMatchObject({ nodeId: 'img' });
    expect(runNode).toHaveBeenCalledTimes(1);
  });
});
