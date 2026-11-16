import { describe, expect, it, vi } from 'vitest';
import { createAgentTaskLayer, TASKABLE_COMMANDS } from '../agent/task-layer.js';
import { WorkflowAgentSession } from '../agent/session.js';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('agent task layer', () => {
  it('returns a taskId immediately, then reports events and the result', async () => {
    const pending = deferred<unknown>();
    const run = vi.fn(() => pending.promise);
    let id = 0;
    const layer = createAgentTaskLayer({ run, createId: () => 'atask_' + (++id), taskTimeoutMs: 1234 });
    const started = layer.start({ command: 'agent.turn', args: { prompt: 'hi', policy: 'read-only', mutationId: 'm' }, idempotencyKey: 'k1' });
    expect(started).toMatchObject({ taskId: 'atask_1', status: 'queued', done: false });
    await Promise.resolve(); await Promise.resolve();
    expect(layer.get({ taskId: 'atask_1' }).status).toBe('running');
    expect(run).toHaveBeenCalledWith('agent.turn', { prompt: 'hi', policy: 'read-only', mutationId: 'm' }, 'agent', 'task:k1', expect.any(AbortSignal), undefined, { timeoutMs: 1234 });
    const mid = layer.get({ taskId: 'atask_1' });
    pending.resolve({ ok: true, result: { summary: 'done' } });
    await layer.settled('atask_1');
    const after = layer.get({ taskId: 'atask_1', afterSeq: mid.seq });
    expect(after).toMatchObject({ status: 'succeeded', done: true, result: { summary: 'done' } });
    expect(after.events.map((event: { type: string }) => event.type)).toEqual(['succeeded']);
  });

  it('replays the same task for the same idempotency key', () => {
    const layer = createAgentTaskLayer({ run: () => new Promise(() => {}) });
    const a = layer.start({ command: 'workflow.node.run', args: { nodeId: 'n1' }, idempotencyKey: 'same' });
    const b = layer.start({ command: 'workflow.node.run', args: { nodeId: 'n1' }, idempotencyKey: 'same' });
    expect(b.taskId).toBe(a.taskId);
    expect(b.replayed).toBe(true);
  });

  it('maps a failed command response and a thrown error to failed', async () => {
    const layer = createAgentTaskLayer({ run: vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'SEEDANCE_PREFLIGHT_FAILED', message: 'x' } })
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'COMMAND_TIMEOUT' })) });
    const a = layer.start({ command: 'workflow.node.run', args: {} });
    const b = layer.start({ command: 'workflow.export', args: {} });
    await layer.settled(a.taskId); await layer.settled(b.taskId);
    expect(layer.get({ taskId: a.taskId }).error.code).toBe('SEEDANCE_PREFLIGHT_FAILED');
    expect(layer.get({ taskId: b.taskId })).toMatchObject({ status: 'failed', error: { code: 'COMMAND_TIMEOUT' } });
  });

  it('cancels: aborts the session request and asks the canvas to stop the nodes', async () => {
    const stop = vi.fn(async () => ({ ok: true }));
    const run = vi.fn((_c, _a, _s, _k, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' })))));
    const layer = createAgentTaskLayer({ run, stop });
    const task = layer.start({ command: 'workflow.node.run', args: { projectId: 'p', nodeIds: ['a', 'b'] } });
    await Promise.resolve(); await Promise.resolve();
    const cancelled = await layer.cancel({ taskId: task.taskId, reason: '用户改主意' });
    expect(cancelled.stoppedNodeIds).toEqual(['a', 'b']);
    expect(stop).toHaveBeenCalledWith('workflow.node.stop', { nodeId: 'a', projectId: 'p' }, 'agent', undefined);
    await layer.settled(task.taskId);
    expect(layer.get({ taskId: task.taskId })).toMatchObject({ status: 'cancelled', error: { code: 'TASK_CANCELLED', message: '用户改主意' } });
    expect((await layer.cancel({ taskId: task.taskId })).alreadyFinished).toBe(true);
  });

  it('rejects commands that are not taskable and unknown task ids', async () => {
    const layer = createAgentTaskLayer({ run: async () => ({ ok: true }) });
    expect(await layer.handle('agent.task.start', { command: 'workflow.apply' })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(await layer.handle('agent.task.get', { taskId: 'nope' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await layer.handle('agent.task.start', { command: 'workflow.export', args: '{bad' })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(TASKABLE_COMMANDS).toContain('agent.turn');
  });
});

const ORIGIN = 'http' + '://127.0.0.1:5173';

describe('agent.task.* through the Agent session', () => {
  it('runs agent.turn past the 60s request timeout as a background task', async () => {
    vi.useFakeTimers();
    try {
      const session = new WorkflowAgentSession({ timeoutMs: 60_000, taskTimeoutMs: 10 * 60_000, webUrl: () => ORIGIN });
      let events = '';
      session.openEvents(new URL(ORIGIN + '/events?clientId=browser-1'), { writeHead() {}, write(value: string) { events += value; }, on() {} } as never);
      session.updateSnapshot({ id: 'project-1' } as never, 'browser-1');
      const calls = () => [...events.matchAll(/event: tool_call\ndata: (.+)\n\n/g)].map(match => JSON.parse(match[1]));

      const started = await session.callCommand('agent.task.start', { command: 'agent.turn', args: { prompt: '做一个分镜', policy: 'read-only', mutationId: 'turn-1' } }, 'cli', 'task-key-1');
      expect(started).toMatchObject({ ok: true, result: { status: 'queued' } });
      const taskId = started.result.taskId;
      await vi.advanceTimersByTimeAsync(0);
      expect(calls().at(-1).envelope.command).toBe('agent.turn');

      await vi.advanceTimersByTimeAsync(5 * 60_000); // 远超 60s 单次超时
      expect((await session.callCommand('agent.task.get', { taskId }, 'cli')).result.status).toBe('running');

      session.resolveResult({ requestId: calls().at(-1).requestId, clientId: 'browser-1', result: { ok: true, result: { summary: '已完成' } }, error: undefined });
      await vi.advanceTimersByTimeAsync(0);
      const done = await session.callCommand('agent.task.get', { taskId, afterSeq: 0 }, 'cli');
      expect(done.result).toMatchObject({ status: 'succeeded', result: { summary: '已完成' } });
    } finally {
      vi.useRealTimers();
    }
  });
});
