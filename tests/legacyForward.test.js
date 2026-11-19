import { describe, expect, it } from 'vitest';
import { imagesBatchInvocations, legacyForward } from '../tools/iris/legacy-forward.js';

describe('legacy command forwarding', () => {
  it('maps video.status to task.get and export.project to workflow.inspect', () => {
    expect(legacyForward('video.status', { jobId: 'task_1' })).toMatchObject({ command: 'task.get', args: { taskId: 'task_1' } });
    expect(legacyForward('video.status', { 'job-id': 'task_2' }).args.taskId).toBe('task_2');
    expect(legacyForward('export.project', { projectId: 'p1' })).toEqual({ command: 'workflow.inspect', args: { projectId: 'p1' } });
    expect(legacyForward('generate.image', {})).toBeNull();
  });

  it('splits generate.images-batch into generate.image calls with derived idempotency keys', () => {
    const calls = imagesBatchInvocations({ items: [{ prompt: 'a', aspectRatio: '1:1', layout: 'grid' }, 'b'], idempotencyKey: 'batch-1' });
    expect(calls).toEqual([
      { commandArgs: { prompt: 'a', aspectRatio: '1:1' }, options: { idempotencyKey: 'batch-1:0' } },
      { commandArgs: { prompt: 'b' }, options: { idempotencyKey: 'batch-1:1' } },
    ]);
  });

  it('refuses a batch without an idempotency key or prompts', () => {
    expect(() => imagesBatchInvocations({ items: ['a'] })).toThrow(/idempotency-key/);
    expect(() => imagesBatchInvocations({ items: [{}], idempotencyKey: 'k' })).toThrow(/prompt/);
    expect(() => imagesBatchInvocations({ items: [], idempotencyKey: 'k' })).toThrow(/items/);
  });
});
