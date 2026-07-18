// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(dispose => dispose()));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'flovart-runtime-client-'));
  const discoveryPath = join(directory, 'control-v1.json');
  const token = 'ab'.repeat(32);
  const requests: Array<{ url?: string; authorization?: string; origin?: string; body: unknown }> = [];
  const status = {
    protocolVersion: '1',
    runtimeVersion: '0.3.0',
    runtimeInstanceId: 'runtime_test',
    registryHash: getCanonicalRegistry().registryHash,
    authority: 'desktop-runtime',
    state: 'ready',
  };
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      requests.push({
        url: request.url,
        authorization: request.headers.authorization,
        origin: request.headers.origin,
        body: text ? JSON.parse(text) : null,
      });
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(request.url === '/v1/status' ? status : status));
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
    runtimeInstanceId: status.runtimeInstanceId,
    runtimeVersion: status.runtimeVersion,
    registryHash: status.registryHash,
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
  return { discoveryPath, requests, status, token };
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

describe('FlovartRuntimeClient', () => {
  it('uses secure discovery for status and command envelopes without a browser bridge', async () => {
    const { discoveryPath, requests, status, token } = await fixture();
    const client = new FlovartRuntimeClient({
      discoveryPath,
      timeoutMs: 500,
      permissionVerifier: async () => 'test',
    });

    await expect(client.status()).resolves.toEqual(status);
    await expect(client.execute('runtime.status', {}, {
      kind: 'cli',
      instanceId: 'cli_test',
    })).resolves.toEqual(status);

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: '/v1/status',
      authorization: `Bearer ${token}`,
      origin: undefined,
    });
    expect(requests[1]).toMatchObject({
      url: '/v1/commands',
      authorization: `Bearer ${token}`,
      origin: undefined,
      body: {
        protocolVersion: '1',
        command: 'runtime.status',
        args: {},
        actor: { kind: 'cli', instanceId: 'cli_test' },
      },
    });
    expect((requests[1].body as { commandId: string }).commandId).toMatch(/^cmd_/);
  });

  it('fails closed on protocol drift before sending a request', async () => {
    const { discoveryPath, requests, token } = await fixture();
    const discovery = JSON.parse(await readFile(discoveryPath, 'utf8'));
    await writeFile(discoveryPath, JSON.stringify({ ...discovery, protocolVersion: '2' }));
    const client = new FlovartRuntimeClient({
      discoveryPath,
      permissionVerifier: async () => 'test',
    });

    await expect(client.status()).rejects.toMatchObject({
      code: 'PROTOCOL_MISMATCH',
    });
    expect(requests).toHaveLength(0);
    await expect(client.status()).rejects.not.toThrow(token);
  });

  it('rejects a stale discovery record when the live runtime instance differs', async () => {
    const { discoveryPath, requests } = await fixture();
    const discovery = JSON.parse(await readFile(discoveryPath, 'utf8'));
    await writeFile(discoveryPath, JSON.stringify({
      ...discovery,
      runtimeInstanceId: 'runtime_stale',
    }));
    const client = new FlovartRuntimeClient({
      discoveryPath,
      permissionVerifier: async () => 'test',
    });

    await expect(client.status()).rejects.toMatchObject({
      code: 'RUNTIME_UNAVAILABLE',
      message: expect.stringMatching(/stale/i),
    });
    expect(requests).toHaveLength(1);
  });

  it('reports an offline runtime in under two seconds without exposing its token', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flovart-runtime-offline-'));
    const discoveryPath = join(directory, 'control-v1.json');
    const token = 'cd'.repeat(32);
    await writeFile(discoveryPath, JSON.stringify({
      schemaVersion: '1',
      protocolVersion: '1',
      runtimeInstanceId: 'runtime_offline',
      runtimeVersion: '0.3.0',
      registryHash: getCanonicalRegistry().registryHash,
      pid: process.pid,
      port: 9,
      startedAt: new Date().toISOString(),
      token,
    }));
    await protectDiscovery(discoveryPath);
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const startedAt = performance.now();

    let error: unknown;
    try {
      await new FlovartRuntimeClient({ discoveryPath, timeoutMs: 300 }).status();
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'RUNTIME_UNAVAILABLE' });
    expect(String(error)).not.toContain(token);
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });

  it('rejects a discovery record with permissions inherited by other principals', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flovart-runtime-permissions-'));
    const discoveryPath = join(directory, 'control-v1.json');
    await writeFile(discoveryPath, '{}');
    if (process.platform !== 'win32') await chmod(discoveryPath, 0o644);
    cleanup.push(() => rm(directory, { recursive: true, force: true }));

    await expect(new FlovartRuntimeClient({ discoveryPath }).status()).rejects.toMatchObject({
      code: 'RUNTIME_UNAVAILABLE',
      message: expect.stringMatching(/permissions/i),
    });
  });

  it('routes CLI runtime.status through the authenticated Production Runtime', async () => {
    const { discoveryPath, requests, status } = await fixture();

    const result = await runCli(['runtime.status', '--json'], {
      FLOVART_RUNTIME_DISCOVERY: discoveryPath,
    });

    expect(result.code, JSON.stringify(result)).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: 'runtime.status',
      data: status,
      runtime: 'production-runtime',
    });
    expect(requests.map(request => request.url)).toEqual(['/v1/status']);
  });
});
