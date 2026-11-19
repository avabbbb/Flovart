import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAgentTaskLayer as createLayer,
  createMemoryTaskStore,
  reconcileTaskFromNodes,
  stableStringify,
  taskArgsHash,
} from '../agent/task-layer.js';
import { createFileTaskStore } from '../agent/task-store.js';
import { WorkflowAgentSession } from '../agent/session.js';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { createBrowserAgentTools } from '../services/browserAgentKernel';
import { browserAgentTaskLayer, resetBrowserAgentTasks } from '../services/browserAgentTasks';
import { createBrowserAgentTaskStore } from '../services/agentTaskStore';
import { setWorkflowExecutor } from '../services/workflowDispatcher';
import { createWorkflowExecutor } from '../services/workflowExecutor';

// task-layer.js 是 JS，参数类型由默认值推断得过窄；测试里按 any 调用。
const createAgentTaskLayer = createLayer as unknown as (options: Record<string, unknown>) => any;
const never = () => new Promise(() => {});
const tick = async (count = 4) => { for (let i = 0; i < count; i += 1) await Promise.resolve(); };

describe('stable idempotency key', () => {
  it('ignores key order and nodeIds encoding, but not values', () => {
    expect(stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe('{"a":{"d":[1,{"x":1,"y":2}]},"b":1}');
    const a = taskArgsHash('workflow.node.run', { nodeIds: ['s1', 's2'], projectId: 'p', options: { seed: 1, quality: 'hd' } });
    const b = taskArgsHash('workflow.node.run', { options: { quality: 'hd', seed: 1 }, projectId: 'p', nodeIds: 's1, s2' });
    expect(a).toBe(b);
    expect(taskArgsHash('workflow.node.run', { nodeIds: ['s2', 's1'] })).not.toBe(taskArgsHash('workflow.node.run', { nodeIds: ['s1', 's2'] }));
    expect(taskArgsHash('workflow.group.run', { nodeIds: ['s1', 's2'] })).not.toBe(taskArgsHash('workflow.node.run', { nodeIds: ['s1', 's2'] }));
    expect(taskArgsHash('workflow.node.run', { nodeIds: ['s1'], options: { seed: 2 } })).not.toBe(taskArgsHash('workflow.node.run', { nodeIds: ['s1'], options: { seed: 1 } }));
  });

  it('replays across key order: same task, run called once', async () => {
    const run = vi.fn(never);
    const layer = createAgentTaskLayer({ run });
    const first = layer.start({ command: 'workflow.node.run', args: { nodeIds: ['n1'], options: { a: 1, b: 2 } } });
    const second = layer.start({ command: 'workflow.node.run', args: { options: { b: 2, a: 1 }, nodeIds: ['n1'] } });
    expect(second).toMatchObject({ taskId: first.taskId, replayed: true });
    expect(second.resubmitRequiresConfirmation).toBeUndefined();
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('agent task ledger: restart', () => {
  it('persists submitting before running, and a new layer over the same store still knows the task', async () => {
    const store = createMemoryTaskStore();
    const run = vi.fn(async () => {
      // 子命令被调用时台账里已经是「提交中」。
      expect([...store.records.values()][0]).toMatchObject({ status: 'running', submitState: 'submitting' });
      return never();
    });
    const before = createAgentTaskLayer({ run, store });
    await before.ready;
    const started = before.start({ command: 'workflow.group.run', args: { groupId: 'g1' }, idempotencyKey: 'k1' });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await before.flush();
    before.close();

    const run2 = vi.fn(never);
    const after = createAgentTaskLayer({ run: run2, store });
    await after.ready;
    const record = after.get({ taskId: started.taskId });
    expect(record).toMatchObject({ taskId: started.taskId, command: 'workflow.group.run', status: 'unknown_submit', done: false, recovered: true });
    expect(record.attention.code).toBe('UNKNOWN_SUBMIT');
    expect((await after.handle('agent.task.get', { taskId: started.taskId })).ok).toBe(true);

    // 同参数、新的幂等键（新回合 / 新进程）：返回旧任务，不重新提交。
    const again = after.start({ command: 'workflow.group.run', args: { groupId: 'g1' }, idempotencyKey: 'k2' });
    expect(again).toMatchObject({ taskId: started.taskId, replayed: true, resubmitRequiresConfirmation: true });
    // 同一个幂等键：同样不提交。
    expect(after.start({ command: 'workflow.group.run', args: { groupId: 'g1' }, idempotencyKey: 'k1' })).toMatchObject({ taskId: started.taskId, resubmitRequiresConfirmation: true });
    await tick();
    expect(run2).not.toHaveBeenCalled();

    // 用户明确确认后才重新提交：旧任务标为被取代（可能已扣费）。
    const fresh = after.start({ command: 'workflow.group.run', args: { groupId: 'g1' }, idempotencyKey: 'k2', resubmit: true });
    expect(fresh.taskId).not.toBe(started.taskId);
    await vi.waitFor(() => expect(run2).toHaveBeenCalledTimes(1));
    expect(after.get({ taskId: started.taskId })).toMatchObject({ status: 'cancelled', error: { code: 'TASK_SUPERSEDED', details: { billingUnknown: true } } });
    after.close();
  });

  it('a task that never started executing is safe to rerun after restart', async () => {
    const store = createMemoryTaskStore();
    store.records.set('atask_q', { v: 1, taskId: 'atask_q', command: 'workflow.node.run', args: { nodeIds: ['n1'] }, argsHash: taskArgsHash('workflow.node.run', { nodeIds: ['n1'] }), owner: 'agent', status: 'queued', submitState: 'not_submitted', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), seq: 1, events: [], nodeIds: ['n1'], providerJobs: [] });
    const run = vi.fn(never);
    const layer = createAgentTaskLayer({ run, store });
    await layer.ready;
    expect(layer.get({ taskId: 'atask_q' })).toMatchObject({ status: 'failed', done: true, error: { code: 'TASK_INTERRUPTED', details: { retryable: true, submitted: false } } });
    const rerun = layer.start({ command: 'workflow.node.run', args: { nodeIds: ['n1'] } });
    expect(rerun.taskId).not.toBe('atask_q');
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    layer.close();
  });

  it('records provider job ids while running, then resumes polling them after restart until the node finishes', async () => {
    const store = createMemoryTaskStore();
    const nodes = [{ id: 'v1', metadata: { status: 'loading', generationProviderTaskId: 'prov-1' } }];
    const inspect = vi.fn(() => nodes);
    const before = createAgentTaskLayer({ run: never, store, inspect, pollMs: 0 });
    await before.ready;
    const started = before.start({ command: 'workflow.node.run', args: { nodeId: 'v1', projectId: 'p' } });
    await tick();
    await before.reconcile();
    expect([...store.records.values()][0].providerJobs).toEqual([{ nodeId: 'v1', providerTaskId: 'prov-1', status: 'loading' }]);
    before.close();

    const after = createAgentTaskLayer({ run: never, store, inspect, pollMs: 0 });
    await after.ready;
    expect(after.get({ taskId: started.taskId })).toMatchObject({ status: 'running', recovered: true, providerJobs: [{ providerTaskId: 'prov-1' }] });
    nodes[0].metadata = { status: 'success', generationProviderTaskId: 'prov-1' };
    await after.reconcile();
    expect(after.get({ taskId: started.taskId })).toMatchObject({ status: 'succeeded', done: true, result: { nodeIds: ['v1'], recovered: true } });
    expect(store.records.get(started.taskId).status).toBe('succeeded');
    after.close();
  });

  it('treats an interrupted node as possibly billed unless it was refunded', () => {
    const record = { nodeIds: ['a', 'b'], providerJobs: [] };
    expect(reconcileTaskFromNodes(record, [{ id: 'a', metadata: { status: 'success' } }, { id: 'b', metadata: { status: 'error' } }]).status).toBe('unknown_submit');
    expect(reconcileTaskFromNodes(record, [{ id: 'a', metadata: { status: 'success' } }, { id: 'b', metadata: { status: 'error', generationBillableState: 'refunded' } }]).status).toBe('failed');
    expect(reconcileTaskFromNodes(record, [{ id: 'a', metadata: { status: 'loading' } }, { id: 'b', metadata: { status: 'loading' } }]).status).toBe('unknown_submit');
    expect(reconcileTaskFromNodes(record, [{ id: 'a', metadata: { status: 'loading', generationProviderTaskId: 't' } }, { id: 'b', metadata: { status: 'success' } }]).status).toBe('running');
  });

  it('cancel works on a reloaded task: stops its nodes and keeps the billing warning', async () => {
    const store = createMemoryTaskStore();
    const before = createAgentTaskLayer({ run: never, store });
    await before.ready;
    const started = before.start({ command: 'workflow.node.run', args: { nodeIds: ['a', 'b'], projectId: 'p' } });
    await tick();
    await before.flush();
    before.close();

    const stop = vi.fn(async () => ({ ok: true }));
    const after = createAgentTaskLayer({ run: never, stop, store });
    await after.ready;
    const cancelled = await after.cancel({ taskId: started.taskId, reason: '不要了' });
    expect(cancelled).toMatchObject({ status: 'cancelled', done: true, stoppedNodeIds: ['a', 'b'], error: { code: 'TASK_CANCELLED', details: { billingUnknown: true } } });
    expect(stop).toHaveBeenCalledWith('workflow.node.stop', { nodeId: 'a', projectId: 'p' }, 'agent', undefined);
    await after.flush();
    // 取消即「用户已知情」：之后同参数可以重新启动。
    const run = vi.fn(never);
    const third = createAgentTaskLayer({ run, store });
    await third.ready;
    expect(third.get({ taskId: started.taskId }).status).toBe('cancelled');
    expect(third.start({ command: 'workflow.node.run', args: { nodeIds: ['a', 'b'], projectId: 'p' } }).taskId).not.toBe(started.taskId);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    third.close();
  });

  it('drops finished tasks past retention, keeps recent ones', async () => {
    const store = createMemoryTaskStore();
    let clock = Date.parse('2026-11-01T00:00:00Z');
    const layer = createAgentTaskLayer({ run: async () => ({ ok: true, result: 1 }), store, now: () => clock });
    await layer.ready;
    const old = layer.start({ command: 'workflow.export', args: { a: 1 } });
    await layer.settled(old.taskId);
    clock += 6 * 24 * 3_600_000;
    const recent = layer.start({ command: 'workflow.export', args: { a: 2 } });
    await layer.settled(recent.taskId);
    await layer.flush();
    clock += 2 * 24 * 3_600_000;
    const reopened = createAgentTaskLayer({ run: never, store, now: () => clock });
    await reopened.ready;
    await reopened.flush();
    expect(() => reopened.get({ taskId: old.taskId })).toThrow(/不存在/);
    expect(reopened.get({ taskId: recent.taskId }).status).toBe('succeeded');
    expect(store.records.has(old.taskId)).toBe(false);
  });
});

describe('Node file task store', () => {
  it('round-trips the ledger through agent-tasks.json and survives a corrupt file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'flo-tasks-'));
    const file = path.join(dir, 'agent-tasks.json');
    const before = createAgentTaskLayer({ run: never, store: createFileTaskStore({ file }) });
    await before.ready;
    const started = before.start({ command: 'workflow.video.tool', args: { nodeId: 'v', tool: 'video-upscale' } });
    await tick();
    await before.flush();
    expect(JSON.parse(readFileSync(file, 'utf8')).tasks[0]).toMatchObject({ taskId: started.taskId, status: 'running', submitState: 'submitting' });

    const after = createAgentTaskLayer({ run: never, store: createFileTaskStore({ file }) });
    await after.ready;
    expect(after.get({ taskId: started.taskId }).status).toBe('unknown_submit');

    writeFileSync(file, '{ torn');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fresh = createAgentTaskLayer({ run: never, store: createFileTaskStore({ file }) });
    await fresh.ready;
    expect(fresh.list()).toEqual([]);
    expect(readdirSync(dir).some(name => name.endsWith('.corrupt'))).toBe(true);
    errors.mockRestore();
  });

  it('agent.task.get after a local Agent restart returns the record, reconciled from the browser snapshot', async () => {
    const store = createMemoryTaskStore();
    const ORIGIN = 'http' + '://127.0.0.1:5173';
    const session = new WorkflowAgentSession({ taskStore: store, webUrl: () => ORIGIN } as never);
    session.openEvents(new URL(ORIGIN + '/events?clientId=b1'), { writeHead() {}, write() {}, on() {} } as never);
    session.updateSnapshot({ id: 'p1', nodes: [{ id: 'n1', metadata: { status: 'idle' } }] } as never, 'b1');
    const started = await session.callCommand('agent.task.start', { command: 'workflow.node.run', args: { nodeId: 'n1', projectId: 'p1' } }, 'cli', 'key-1');
    expect(started.ok).toBe(true);
    await tick(8);
    await (session as unknown as { tasks: { flush(): Promise<void>; close(): void } }).tasks.flush();
    (session as unknown as { tasks: { close(): void } }).tasks.close();

    const restarted = new WorkflowAgentSession({ taskStore: store, webUrl: () => ORIGIN } as never);
    const got = await restarted.callCommand('agent.task.get', { taskId: started.result.taskId }, 'cli');
    expect(got).toMatchObject({ ok: true, result: { taskId: started.result.taskId, status: 'unknown_submit' } });
    // 浏览器重连并推送快照：节点已成功 → 对账为 succeeded。
    restarted.openEvents(new URL(ORIGIN + '/events?clientId=b2'), { writeHead() {}, write() {}, on() {} } as never);
    restarted.updateSnapshot({ id: 'p1', nodes: [{ id: 'n1', metadata: { status: 'success' } }] } as never, 'b2');
    const tasks = (restarted as unknown as { tasks: { reconcile(): Promise<void>; close(): void } }).tasks;
    await tasks.reconcile();
    expect((await restarted.callCommand('agent.task.get', { taskId: started.result.taskId }, 'cli')).result.status).toBe('succeeded');
    tasks.close();
  });
});

describe('browser task ledger (IndexedDB)', () => {
  afterEach(() => {
    resetBrowserAgentTasks();
    setWorkflowExecutor(undefined);
  });

  it('get after a page refresh returns the task; a same-args restart asks the user before resubmitting', async () => {
    const project = createWorkflowProject('刷新');
    project.nodes = [createWorkflowNode('s1', 'image', { x: 0, y: 0 }, { prompt: '第一镜' })];
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
    const runNode = vi.fn(never);
    setWorkflowExecutor(createWorkflowExecutor({ runNode: runNode as never, stopNode: vi.fn() }, { createRunId: () => 'run' }));
    const confirm = vi.fn(async (_summary: string, _request?: { kind?: string }) => true);
    const tools = (turn: string) => createBrowserAgentTools({ projectId: project.id, confirm, activeChangeSetId: turn, getApproval: () => ({ mode: 'yolo' }) });
    const call = async (name: string, params: Record<string, unknown>, turn = 't1') => {
      const tool = tools(turn).find(item => item.name === name)!;
      const out = await tool.execute('c', params as never, new AbortController().signal);
      return JSON.parse((out.content[0] as { text: string }).text);
    };
    const started = await call('iris_task_start', { command: 'workflow.node.run', args: { nodeIds: ['s1'] } });
    await vi.waitFor(() => expect(runNode).toHaveBeenCalledTimes(1));
    await browserAgentTaskLayer(project.id, vi.fn() as never).reconcile();
    expect(confirm).toHaveBeenCalledTimes(1);

    resetBrowserAgentTasks(); // 页面刷新：内存任务层没了，IndexedDB 台账还在
    const got = await call('iris_task_get', { taskId: started.taskId }, 't2');
    expect(got).toMatchObject({ taskId: started.taskId, recovered: true, done: false });
    expect(['unknown_submit', 'running']).toContain(got.status);

    confirm.mockResolvedValueOnce(false);
    const again = await call('iris_task_start', { command: 'workflow.node.run', args: { nodeIds: ['s1'] } }, 't2');
    expect(again).toMatchObject({ taskId: started.taskId, resubmitRequiresConfirmation: true });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1][1]).toMatchObject({ kind: 'other', command: 'workflow.node.run' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(runNode).toHaveBeenCalledTimes(1);

    const cancelled = await call('iris_task_cancel', { taskId: started.taskId }, 't3');
    expect(cancelled).toMatchObject({ status: 'cancelled', done: true });
  });

  it('stores records per project prefix', async () => {
    const a = createBrowserAgentTaskStore('pa');
    const b = createBrowserAgentTaskStore('pb');
    await a.put({ taskId: 't1', status: 'running' });
    await b.put({ taskId: 't2', status: 'running' });
    expect((await a.load()).map(record => record.taskId)).toEqual(['t1']);
    await a.remove('t1');
    expect(await a.load()).toEqual([]);
    expect((await b.load()).map(record => record.taskId)).toEqual(['t2']);
  });
});
