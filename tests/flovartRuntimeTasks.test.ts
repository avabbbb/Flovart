// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FlovartRuntimeClient } from '../tools/flovart/runtime-client.js';
import { getCanonicalRegistry } from '../tools/flovart/registry.js';

const cleanup: Array<() => Promise<void>> = [];
const execFileAsync = promisify(execFile);

async function protectDiscovery(path: string) {
  if (process.platform !== 'win32') {
    await chmod(path, 0o600);
    return;
  }
  const system32 = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const { stdout } = await execFileAsync(join(system32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
    windowsHide: true,
  });
  const sid = stdout.match(/S-\d(?:-\d+)+/)?.[0];
  if (!sid) throw new Error('test SID unavailable');
  await execFileAsync(join(system32, 'icacls.exe'), [
    path,
    '/inheritance:r',
    '/grant:r',
    `*${sid}:(F)`,
    '/grant:r',
    '*S-1-5-18:(F)',
    '/q',
  ], { windowsHide: true });
}

function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'tools', 'flovart', 'cli.js'), ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(dispose => dispose()));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'flovart-runtime-tasks-'));
  const discoveryPath = join(directory, 'control-v1.json');
  const token = 'ef'.repeat(32);
  const requests: unknown[] = [];
  const httpRequests: Array<{ url?: string; lastEventId?: string }> = [];
  const receipt = {
    kind: 'task',
    commandId: 'cmd_test',
    taskId: 'task_test',
    status: 'queued',
    pollIntervalMs: 100,
    eventId: 1,
    links: {
      task: '/v1/tasks/task_test',
      events: '/v1/events?taskId=task_test',
    },
  };
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      requests.push(text ? JSON.parse(text) : null);
      httpRequests.push({
        url: request.url,
        lastEventId: request.headers['last-event-id'] as string | undefined,
      });
      if (request.url?.startsWith('/v1/events')) {
        response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        response.end([
          'retry: 250',
          '',
          'id: 2',
          'event: task.working',
          `data: ${JSON.stringify({
            eventId: 2,
            eventVersion: '1',
            eventType: 'task.working',
            taskId: 'task_test',
            occurredAt: 1,
            data: { status: 'working' },
          })}`,
          '',
          '',
        ].join('\n'));
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(receipt));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test address');
  await writeFile(discoveryPath, JSON.stringify({
    schemaVersion: '1',
    protocolVersion: '1',
    runtimeInstanceId: 'runtime_test',
    runtimeVersion: '0.3.0',
    registryHash: getCanonicalRegistry().registryHash,
    pid: process.pid,
    port: address.port,
    startedAt: new Date().toISOString(),
    token,
  }));
  await protectDiscovery(discoveryPath);
  cleanup.push(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  return { discoveryPath, httpRequests, receipt, requests };
}

describe('Flovart Runtime tasks', () => {
  it('puts the caller-stable idempotency key on the command envelope', async () => {
    const { discoveryPath, receipt, requests } = await fixture();
    const client = new FlovartRuntimeClient({
      discoveryPath,
      permissionVerifier: async () => 'test',
    });

    await expect(client.execute(
      'runtime.test.delay',
      { delayMs: 25 },
      { kind: 'cli', instanceId: 'cli_test' },
      { idempotencyKey: 'stable-delay-key' },
    )).resolves.toEqual(receipt);

    expect(requests).toEqual([expect.objectContaining({
      command: 'runtime.test.delay',
      args: { delayMs: 25 },
      actor: { kind: 'cli', instanceId: 'cli_test' },
      idempotencyKey: 'stable-delay-key',
    })]);
  });

  it('routes a typed delay task through the Production Runtime CLI', async () => {
    const { discoveryPath, receipt, requests } = await fixture();

    const result = await runCli([
      'runtime.test.delay',
      '--delay-ms', '25',
      '--idempotency-key', 'cli-stable-delay',
      '--json',
    ], {
      FLOVART_RUNTIME_DISCOVERY: discoveryPath,
    });

    expect(result.code, JSON.stringify(result)).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'runtime.test.delay',
      data: receipt,
      runtime: 'production-runtime',
    });
    expect(requests).toEqual([expect.objectContaining({
      command: 'runtime.test.delay',
      args: { delayMs: 25 },
      actor: { kind: 'cli', instanceId: 'cli_local' },
      idempotencyKey: 'cli-stable-delay',
    })]);
  });

  it('resumes the Runtime SSE ledger with Last-Event-ID', async () => {
    const { discoveryPath, httpRequests } = await fixture();
    const client = new FlovartRuntimeClient({
      discoveryPath,
      permissionVerifier: async () => 'test',
    });

    await expect(client.streamEvents({
      afterEventId: 1,
      taskId: 'task_test',
    })).resolves.toMatchObject({
      nextEventId: 2,
      events: [{
        eventId: 2,
        eventType: 'task.working',
        taskId: 'task_test',
      }],
    });
    expect(httpRequests).toEqual([{
      url: '/v1/events?taskId=task_test',
      lastEventId: '1',
    }]);
  });
});
