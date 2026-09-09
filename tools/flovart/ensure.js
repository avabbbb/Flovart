import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLocalStatus } from './local-status.js';
import { toLocalLinkPublicStatus } from './public-status.js';

function cliPath() {
  try { return fileURLToPath(new URL('./cli.js', import.meta.url)); }
  catch { return join(process.cwd(), 'tools', 'flovart', 'cli.js'); }
}

function parseJsonOutput(output) {
  const text = String(output || '');
  let depth = 0;
  let start = -1;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === '{') { if (depth === 0) start = index; depth += 1; continue; }
    if (character !== '}') continue;
    depth -= 1;
    if (depth === 0 && start >= 0) {
      try { return JSON.parse(text.slice(start, index + 1)); } catch { start = -1; }
    }
  }
  return null;
}

function startArguments(cwd, open) {
  const source = existsSync(join(cwd, 'agent', 'index.js')) && existsSync(join(cwd, 'vite.config.ts'));
  return ['start', ...(source ? ['--source', '--web'] : []), '--json', ...(open ? ['--open'] : ['--no-open'])];
}

function runStart(args, { cwd = process.cwd(), env = process.env, spawnImpl = spawn } = {}) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    const child = spawnImpl(process.execPath, [cliPath(), ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.once('error', error => resolve({ code: -1, stdout, stderr: `${stderr}${error instanceof Error ? error.message : String(error)}` }));
    child.once('close', code => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function ensureResponse(status, fallbackError) {
  const publicStatus = toLocalLinkPublicStatus(status);
  const response = {
    ok: publicStatus.state === 'ready',
    state: publicStatus.state,
    frontend: status.frontend?.status === 'ready' ? 'ready' : 'offline',
    agent: status.agent?.status === 'ready' ? 'ready' : publicStatus.state === 'needs_login' ? 'needs_login' : publicStatus.state === 'needs_setup' ? 'needs_setup' : 'offline',
    browser: status.browserConnected ? 'ready' : 'offline',
    projectId: status.projectId || null,
    revision: status.revision ?? null,
  };
  if (!response.ok) response.error = { code: publicStatus.state === 'needs_login' ? 'HOST_NEEDS_LOGIN' : publicStatus.state === 'needs_setup' ? 'HOST_NEEDS_SETUP' : 'LINK_OFFLINE', message: fallbackError || publicStatus.message, action: publicStatus.action };
  return response;
}

export async function ensureFlovart({ open = true, cwd = process.cwd(), env = process.env, statusReader = getLocalStatus, startRunner = runStart } = {}) {
  let status = await statusReader({ env });
  if (status.ready) return ensureResponse(status);
  if (!startRunner) return ensureResponse(status);
  const started = await startRunner(startArguments(cwd, open), { cwd, env });
  status = await statusReader({ env });
  if (status.ready) return ensureResponse(status);
  const startResult = parseJsonOutput(started.stdout);
  const startError = startResult?.error?.message || startResult?.agent?.error || startResult?.frontend?.error || (started.code !== 0 ? 'Flovart 本地服务未能就绪。' : undefined);
  return ensureResponse(status, startError);
}

export { ensureResponse, parseJsonOutput, startArguments };
