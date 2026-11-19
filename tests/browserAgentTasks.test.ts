import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { createBrowserAgentTools } from '../services/browserAgentKernel';
import { resetBrowserAgentTasks, BROWSER_TASKABLE_COMMANDS } from '../services/browserAgentTasks';
import { setWorkflowExecutor } from '../services/workflowDispatcher';
import { createWorkflowExecutor } from '../services/workflowExecutor';
import { getAgentToolSpecs } from '../tools/iris/agent-tools.js';

const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
};

const setup = () => {
  const project = createWorkflowProject('后台');
  project.nodes = [
    createWorkflowNode('s1', 'image', { x: 0, y: 0 }, { prompt: '第一镜' }),
    createWorkflowNode('s2', 'image', { x: 400, y: 0 }, { prompt: '第二镜' }),
  ];
  useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
  const pending = deferred();
  const runNode = vi.fn(() => pending.promise.then(() => ({ artifact: { artifactId: 'a', kind: 'image', mimeType: 'image/png' } })));
  const stopNode = vi.fn();
  setWorkflowExecutor(createWorkflowExecutor({ runNode: runNode as never, stopNode }, { createRunId: () => 'run' }));
  const confirm = vi.fn(async (_summary: string, _request?: unknown) => true);
  const tools = (turn: string) => createBrowserAgentTools({ projectId: project.id, confirm, activeChangeSetId: turn, getApproval: () => ({ mode: 'yolo' }) });
  const call = async (list: ReturnType<typeof tools>, name: string, params: Record<string, unknown>) => {
    const tool = list.find(item => item.name === name);
    if (!tool) throw new Error('missing tool ' + name);
    const out = await tool.execute('call', params as never, new AbortController().signal);
    return JSON.parse((out.content[0] as { text: string }).text);
  };
  return { project, pending, runNode, stopNode, confirm, tools, call };
};

afterEach(() => {
  resetBrowserAgentTasks();
  setWorkflowExecutor(undefined);
});

describe('built-in Agent background tasks', () => {
  it('exposes the same task tools as external hosts, narrowed to browser commands', () => {
    const { tools } = setup();
    const list = tools('t1');
    for (const name of ['iris_task_start', 'iris_task_get', 'iris_task_cancel']) {
      expect(list.some(tool => tool.name === name)).toBe(true);
      expect(getAgentToolSpecs('builtin').some((spec: { name: string }) => spec.name === name)).toBe(true);
    }
    const start = list.find(tool => tool.name === 'iris_task_start')!;
    const enumValues = (start.parameters as unknown as { properties: { command: { enum: string[] } } }).properties.command.enum;
    expect(enumValues).toEqual([...BROWSER_TASKABLE_COMMANDS]);
    expect(enumValues).not.toContain('agent.turn');
    expect(enumValues).toContain('workflow.group.run');
  });

  it('confirms the cost up front, returns a taskId without waiting, and reports the result in a later turn', async () => {
    const { pending, runNode, confirm, tools, call } = setup();
    const started = await call(tools('t1'), 'iris_task_start', { command: 'workflow.node.run', args: { nodeIds: ['s1', 's2'] } });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][1]).toMatchObject({ kind: 'generation', command: 'workflow.node.run' });
    expect(started).toMatchObject({ command: 'workflow.node.run', done: false });
    expect(started.taskId).toBeTruthy();
    await vi.waitFor(() => expect(runNode).toHaveBeenCalledTimes(2));
    const mid = await call(tools('t2'), 'iris_task_get', { taskId: started.taskId });
    expect(mid).toMatchObject({ status: 'running', done: false });
    pending.resolve(undefined);
    await vi.waitFor(async () => expect((await call(tools('t2'), 'iris_task_get', { taskId: started.taskId })).done).toBe(true));
    const done = await call(tools('t2'), 'iris_task_get', { taskId: started.taskId });
    expect(done.status).toBe('succeeded');
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('starts nothing when the user declines the cost card', async () => {
    const { runNode, tools } = setup();
    const list = createBrowserAgentTools({ projectId: useWorkflowStore.getState().activeProjectId!, confirm: vi.fn(async () => false), activeChangeSetId: 't', getApproval: () => ({ mode: 'yolo' }) });
    const start = list.find(tool => tool.name === 'iris_task_start')!;
    await expect(start.execute('c', { command: 'workflow.node.run', args: { nodeIds: ['s1'] } } as never, new AbortController().signal)).rejects.toThrow();
    expect(runNode).not.toHaveBeenCalled();
    void tools;
  });

  it('replays the same task when the model retries the same call in one turn', async () => {
    const { confirm, tools, call } = setup();
    const list = tools('t1');
    const a = await call(list, 'iris_task_start', { command: 'workflow.node.run', args: { nodeIds: ['s1'] } });
    const b = await call(list, 'iris_task_start', { command: 'workflow.node.run', args: { nodeIds: ['s1'] } });
    expect(b).toMatchObject({ taskId: a.taskId, replayed: true });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('rejects commands the browser cannot background', async () => {
    const { tools } = setup();
    const start = tools('t1').find(tool => tool.name === 'iris_task_start')!;
    await expect(start.execute('c', { command: 'agent.turn', args: {} } as never, new AbortController().signal)).rejects.toThrow(/不能放到后台/);
  });

  it('cancel stops the nodes the task started', async () => {
    const { stopNode, tools, call } = setup();
    const started = await call(tools('t1'), 'iris_task_start', { command: 'workflow.node.run', args: { nodeIds: ['s1', 's2'] } });
    const cancelled = await call(tools('t2'), 'iris_task_cancel', { taskId: started.taskId });
    expect(cancelled.stoppedNodeIds).toEqual(['s1', 's2']);
    expect(stopNode).toHaveBeenCalledTimes(2);
  });
});
