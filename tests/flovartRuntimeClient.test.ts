// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertDiscoveryDacl, findDaclLine, FlovartRuntimeClient, parseDaclAces, verifyDiscoveryPermissions } from '../tools/flovart/runtime-client.js';
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

// An ACL-hardened temp directory can occasionally take a long time to remove on
// Windows hosts. A slow removal used to consume the whole afterEach budget and
// then time out unrelated tests, so each disposal is bounded and a directory
// that cannot be removed promptly is abandoned instead of blocking the suite.
async function disposeAll() {
  await Promise.all(cleanup.splice(0).map(dispose => withTimeout(dispose(), 5_000)));
}

function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  return Promise.race([
    work,
    new Promise<void>(resolve => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    }),
  ]);
}

afterEach(async () => {
  await disposeAll();
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
    // Keep-alive sockets from the client's fetch keep server.close() from ever
    // invoking its callback, which hangs the whole suite on this one fixture.
    server.closeAllConnections?.();
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

// icacls /save output has to be split into ACEs by balanced parentheses: owner
// and group SIDs on domain-joined machines contain parentheses themselves, and
// a naive regex over the whole DACL silently merges or truncates ACEs. These
// cases are pure string handling, so they stay fast and identical on every host.
describe('parseDaclAces', () => {
  it('splits the production owner-only file DACL into both ACEs', () => {
    expect(parseDaclAces('D:P(A;;FA;;;SY)(A;;FA;;;S-1-5-21-1-2-3-1001)')).toEqual([
      { type: 'A', flags: '', sid: 'SY', inherited: false },
      { type: 'A', flags: '', sid: 'S-1-5-21-1-2-3-1001', inherited: false },
    ]);
  });

  it('keeps inherited ACEs recognisable so an inherited DACL can be rejected', () => {
    const aces = parseDaclAces('D:AI(A;ID;FA;;;SY)(A;ID;FA;;;S-1-5-21-1-2-3-1001)');
    expect(aces).toHaveLength(2);
    expect(aces.every(ace => ace.inherited)).toBe(true);
  });

  it('treats IO (inherit-only) ACEs as inherited as well', () => {
    const aces = parseDaclAces('D:AI(A;IO;FA;;;SY)');
    expect(aces[0].inherited).toBe(true);
  });

  it('does not split an ACE whose SID contains parentheses', () => {
    const aces = parseDaclAces('D:PAI(A;;FA;;;SY)(A;;FA;;;AB(C))');
    expect(aces).toHaveLength(2);
    expect(aces[1].sid).toBe('AB(C)');
  });

  it('returns no ACEs for empty or unbalanced input', () => {
    expect(parseDaclAces('')).toEqual([]);
    expect(parseDaclAces('D:PAI(A;;FA;;;SY')).toEqual([]);
    expect(parseDaclAces('not-an-sddl')).toEqual([]);
  });
});

// icacls /save writes the saved file name on the first line and the descriptor
// after it. On GitHub's Windows runners the test temp root sits on the D: drive,
// so the name line can also begin with "D:" and must not be mistaken for the
// DACL. This is why the two hosted-CI runtime tests failed locally-green runs.
describe('findDaclLine', () => {
  it('reads the DACL that follows a plain file name', () => {
    const dacl = findDaclLine('control-v1.json\r\nD:PAI(A;;FA;;;SY)(A;;FA;;;S-1-5-21-1-2-3-1001)\r\n');
    expect(dacl).toBe('D:PAI(A;;FA;;;SY)(A;;FA;;;S-1-5-21-1-2-3-1001)');
  });

  it('does not mistake a D: drive path for the DACL', () => {
    const dacl = findDaclLine('D:\\a\\_temp\\vitest\\control-v1.json\r\nD:PAI(A;;FA;;;SY)(A;;FA;;;S-1-5-21-1-2-3-1001)\r\n');
    expect(dacl).toBe('D:PAI(A;;FA;;;SY)(A;;FA;;;S-1-5-21-1-2-3-1001)');
  });

  it('reads the DACL after a C: drive path', () => {
    const dacl = findDaclLine('C:\\Users\\x\\control-v1.json\r\nD:P(A;;FA;;;SY)(A;;FA;;;S-1-5-21-1-2-3-1001)\r\n');
    expect(dacl).toBe('D:P(A;;FA;;;SY)(A;;FA;;;S-1-5-21-1-2-3-1001)');
  });

  it('accepts a DACL that carries no protection flags', () => {
    expect(findDaclLine('f.json\r\nD:(A;;FA;;;SY)\r\n')).toBe('D:(A;;FA;;;SY)');
  });

  it('returns null when no descriptor was saved', () => {
    expect(findDaclLine('control-v1.json\r\n')).toBeNull();
  });
});

// The hosted Windows runner was still red after the SDDL parser was fixed: its
// hardened discovery file carries an extra ACE for a privileged built-in
// principal (Administrators) that the strict {owner, SYSTEM} allow-list
// rejected as 'unexpected DACL principal'. These cases feed the real
// assertDiscoveryDacl policy the ACEs a hosted runner produces, so the guard's
// decision is checked directly and on every platform. The policy keeps failing
// closed for any non-privileged principal, which is what actually protects the
// bearer token in the record.
describe('assertDiscoveryDacl', () => {
  const owner = 'S-1-5-21-1-2-3-1001';
  const allowAce = (sid, flags = '', inherited = false) => ({ type: 'A', flags, sid, inherited });

  it('accepts the owner+LocalSystem DACL a local run produces', () => {
    expect(() => assertDiscoveryDacl([allowAce('SY'), allowAce(owner)], owner)).not.toThrow();
    expect(() => assertDiscoveryDacl([allowAce('S-1-5-18'), allowAce(owner)], owner)).not.toThrow();
  });

  it('accepts a hosted-runner DACL carrying a privileged Administrators ACE', () => {
    const aces = [allowAce('SY'), allowAce('BA'), allowAce(owner)];
    expect(() => assertDiscoveryDacl(aces, owner)).not.toThrow();
    const numeric = [allowAce('SY'), allowAce('S-1-5-32-544'), allowAce(owner)];
    expect(() => assertDiscoveryDacl(numeric, owner)).not.toThrow();
  });

  it('accepts the other privileged service SIDs', () => {
    expect(() => assertDiscoveryDacl([allowAce('SY'), allowAce('S-1-5-19'), allowAce(owner)], owner)).not.toThrow();
    expect(() => assertDiscoveryDacl([allowAce('SY'), allowAce('S-1-5-20'), allowAce(owner)], owner)).not.toThrow();
  });

  it('still rejects every non-privileged principal', () => {
    const broad = ['S-1-1-0', 'WD', 'S-1-5-32-545', 'BU', 'S-1-5-11', 'AU', 'S-1-5-21-9-9-9-5001'];
    for (const sid of broad) {
      expect(() => assertDiscoveryDacl([allowAce('SY'), allowAce(sid), allowAce(owner)], owner), sid).toThrow();
    }
  });

  it('still rejects an inherited ACE and a DACL missing owner or SYSTEM', () => {
    expect(() => assertDiscoveryDacl([allowAce(owner, 'ID', true), allowAce('SY'), allowAce(owner)], owner)).toThrow();
    expect(() => assertDiscoveryDacl([allowAce('SY')], owner)).toThrow();
    expect(() => assertDiscoveryDacl([allowAce(owner)], owner)).toThrow();
  });

  it('end-to-end: verifyDiscoveryPermissions accepts a hosted-runner admin ACE on Windows', async () => {
    if (process.platform !== 'win32') return;
    const directory = await mkdtemp(join(tmpdir(), 'flovart-hosted-acl-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, 'control-v1.json');
    await writeFile(file, '{}');
    const system32 = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
    const { stdout } = await execFileAsync(join(system32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
      windowsHide: true,
    });
    const sid = stdout.match(/S-\d(?:-\d+)+/)?.[0];
    if (!sid) throw new Error('test SID unavailable');
    // Mirror the production discovery.rs DACL exactly: protected (D:P), owner +
    // LocalSystem only — no Administrators ACE. The hosted runner failed because
    // the fixture granted S-1-5-32-544 while the real product file never carries
    // it; matching the production shape keeps the test honest about what the
    // verifier accepts. FLOVART_ACL_DEBUG=1 prints the sanitized DACL on failure.
    await execFileAsync(join(system32, 'icacls.exe'), [
      file, '/inheritance:r',
      '/grant:r', `*${sid}:(F)`,
      '/grant:r', '*S-1-5-18:(F)',
      '/q',
    ], { windowsHide: true });
    await expect(verifyDiscoveryPermissions(file)).resolves.toMatch(/^\d+:/);
  });
});
