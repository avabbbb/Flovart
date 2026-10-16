import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// HTTP-level guard for the /api/tools forwarder: the trusted local CLI
// (no Origin + persistent token) may reach granular canonical commands, while
// any request carrying an Origin stays on the stable public Agent surface.
const ROOT = resolve(import.meta.dirname, '..');
let child;
let home;
let baseUrl;
let token;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'flovart-tools-gate-'));
  child = spawn(process.execPath, [join(ROOT, 'agent', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, FLOVART_AGENT_HOME: home, FLOVART_AGENT_CONFIG: join(home, 'agent.json'), FLOVART_AGENT_PORT: '0', FLOVART_WORKSPACE_ONLY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  baseUrl = await new Promise((done, fail) => {
    let out = '';
    const timer = setTimeout(() => fail(new Error('agent did not start: ' + out)), 20_000);
    const onData = chunk => {
      out += chunk;
      const match = out.match(/Local URL: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); done(match[1]); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', code => { clearTimeout(timer); fail(new Error('agent exited ' + code + ': ' + out)); });
  });
  // saveAgentConfig is async: the listen callback logs before the write lands.
  const deadline = Date.now() + 10_000;
  while (!token) {
    try {
      const saved = JSON.parse(readFileSync(join(home, 'agent.json'), 'utf8'));
      if (saved.url === baseUrl) token = saved.token;
    } catch { /* not written yet */ }
    if (!token) {
      if (Date.now() > deadline) throw new Error('agent.json was not written');
      await new Promise(r => setTimeout(r, 100));
    }
  }
}, 30_000);

afterAll(() => {
  child?.kill();
  if (home) rmSync(home, { recursive: true, force: true });
});

async function callTools(command, headers = {}) {
  const response = await fetch(baseUrl + '/api/tools', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ command, args: {}, source: 'cli' }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

describe('/api/tools command gate', () => {
  it('lets the trusted local CLI reach granular commands', async () => {
    const result = await callTools('workflow.project.list', { 'x-flovart-agent-token': token });
    expect(result.body?.error?.code).not.toBe('UNKNOWN_COMMAND');
  });

  it('keeps origin-bearing callers on the public surface even with the token', async () => {
    const origin = { 'x-flovart-agent-token': token, origin: ['http', '//127.0.0.1:37522'].join(':') };
    const granular = await callTools('workflow.project.create', origin);
    expect(granular.status).toBe(400);
    expect(granular.body?.error?.code).toBe('UNKNOWN_COMMAND');
    const pub = await callTools('workflow.inspect', origin);
    expect(pub.body?.error?.code).not.toBe('UNKNOWN_COMMAND');
  });

  it('rejects granular commands without the persistent token', async () => {
    const result = await callTools('workflow.project.create');
    expect(result.status).not.toBe(200);
  });
});
