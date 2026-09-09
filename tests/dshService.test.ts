import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '../dsh-plugin/node_modules/@deepseek-ai/cordis';
import { describe, expect, it } from 'vitest';
import { artifactFromTask } from '../dsh-plugin/src/service';
import { FlovartService } from '../dsh-plugin/src/service';

describe('DeepSeek Harness Flovart service', () => {
  it('projects the real Runtime task Artifact instead of the legacy asset list', () => {
    expect(artifactFromTask({
      id: 'task-1',
      status: 'completed',
      result: {
        provider: 'local-fixture',
        artifact: {
          kind: 'image',
          mimeType: 'image/png',
          storeRelpath: 'runtime-artifacts/task-1.png',
          sha256: 'hash',
          byteSize: 12,
        },
      },
    }, 'task-1')).toEqual({
      taskId: 'task-1',
      kind: 'image',
      mimeType: 'image/png',
      storeRelpath: 'runtime-artifacts/task-1.png',
      sha256: 'hash',
      byteSize: 12,
    });
  });

  it('does not manufacture an Artifact when the task has no media result', () => {
    expect(artifactFromTask({ id: 'task-2', status: 'failed', result: { message: 'failed' } }, 'task-2')).toBeNull();
    expect(artifactFromTask(null, 'task-2')).toBeNull();
  });

  it('disposes and reactivates Cordis dependents when the CLI disappears and returns', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'flovart-dsh-health-'));
    const stateFile = join(directory, 'state');
    const cliFile = join(directory, 'cli.mjs');
    writeFileSync(stateFile, 'ready');
    writeFileSync(cliFile, [
      "import { readFileSync } from 'node:fs'",
      `const state = readFileSync(${JSON.stringify(stateFile)}, 'utf8').trim()` ,
      "const command = process.argv[2]",
      "if (command !== 'command.list' || state !== 'ready') process.exit(1)",
      "console.log(JSON.stringify({ ok: true, data: { commands: { status: { summary: 'status', args: {}, availability: 'stable' } }, registryHash: 'test' } }))",
    ].join('\n'));

    const context = new Context();
    let mounted = 0;
    let disposed = 0;
    const waitFor = async (predicate: () => boolean) => {
      const deadline = Date.now() + 2_000;
      while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      expect(predicate()).toBe(true);
    };
    try {
      const fiber = context.plugin(ctx => {
        const service = new FlovartService(ctx, {
          cli: JSON.stringify(process.execPath) + ' ' + JSON.stringify(cliFile),
          toolTimeoutMs: 2_000,
          workspaceMode: 'browser',
          workspaceUrl: 'http://127.0.0.1:17372',
          workspaceToken: '',
        });
        service.probe();
        ctx.effect(() => service.startHealthMonitor(20), 'test health monitor');
        ctx.inject(['flovart'], dependent => {
          dependent.effect(() => {
            mounted += 1;
            return () => { disposed += 1 };
          }, 'test dependent');
        });
      });
      await fiber;
      await waitFor(() => mounted === 1);

      writeFileSync(stateFile, 'offline');
      await waitFor(() => disposed === 1);

      writeFileSync(stateFile, 'ready');
      await waitFor(() => mounted === 2);
    } finally {
      await context.fiber.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
