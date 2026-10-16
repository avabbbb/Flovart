import { describe, expect, it, vi } from 'vitest';

const runtimeExecute = vi.hoisted(() => vi.fn());

vi.mock('../services/flovartRuntime', () => ({
  getFlovartRuntimeApi: () => ({ execute: runtimeExecute }),
}));
vi.mock('../services/runtimeArtifacts', () => ({
  loadRuntimeArtifactBlob: vi.fn(async () => new Blob(['img'], { type: 'image/png' })),
}));

import { runRuntimeMediaGeneration } from '../services/runtimeGeneration';

interface Envelope {
  command: string;
  args: Record<string, unknown>;
  idempotencyKey?: string;
}

const sentCommands = () => runtimeExecute.mock.calls.map(([envelope]) => envelope as Envelope);

describe('runRuntimeMediaGeneration', () => {
  it('停止后发送带 idempotencyKey 的 task.cancel，并以 AbortError 结束', async () => {
    const controller = new AbortController();
    runtimeExecute.mockReset();
    runtimeExecute.mockImplementation(async (envelope: Envelope) => {
      if (envelope.command === 'generate.image') return { taskId: 'rt-1' };
      if (envelope.command === 'task.get') {
        controller.abort();
        return { status: 'running' };
      }
      return { ok: true };
    });

    await expect(runRuntimeMediaGeneration({ command: 'generate.image', args: { prompt: 'cat' }, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(sentCommands().find(envelope => envelope.command === 'task.cancel')).toMatchObject({
      idempotencyKey: 'cancel:rt-1',
      args: { taskId: 'rt-1', reason: 'user_abort' },
    });
  });

  it('上游失败（非停止）不发送 task.cancel', async () => {
    runtimeExecute.mockReset();
    runtimeExecute.mockImplementation(async (envelope: Envelope) => envelope.command === 'generate.image'
      ? { taskId: 'rt-2' }
      : { status: 'failed', error: { message: 'boom' } });

    await expect(runRuntimeMediaGeneration({ command: 'generate.image', args: {} })).rejects.toThrow('Runtime 生成失败');
    expect(sentCommands().some(envelope => envelope.command === 'task.cancel')).toBe(false);
  });
});
