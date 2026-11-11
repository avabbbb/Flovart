#!/usr/bin/env node
// Start DSH Desktop with a ready Workspace Operator.
//
// DSH Desktop itself never starts the Flovart Workspace Operator, so the
// embedded Flovart pane shows "bootstrap 仅接受同源页面请求" / "连接失败"
// until one is running. This launcher adopts an already-healthy Operator
// (same borrow semantics as dsh-plugin/scripts/workspace-supervisor.mjs);
// otherwise it owns one for the lifetime of the DSH window.
//
// Usage:
//   node scripts/dsh-desktop.mjs               # ensure operator, open DSH Desktop
//   node scripts/dsh-desktop.mjs --ensure-only # only ensure/start the operator, then exit
// Options:
//   --exe <path>   DSH Desktop executable (default: DSH_DESKTOP_EXE or common install paths)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const option = name => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const workspaceDir = process.env.FLOVART_AGENT_HOME || join(homedir(), '.dsh', 'workspace');
const configFile = process.env.FLOVART_AGENT_CONFIG || join(workspaceDir, 'agent.json');
const operatorEnv = {
  ...process.env,
  FLOVART_WORKSPACE_ONLY: '1',
  FLOVART_AGENT_HOME: workspaceDir,
  FLOVART_AGENT_CONFIG: configFile,
  FLOVART_CREW_DIR: process.env.FLOVART_CREW_DIR || join(workspaceDir, 'crew'),
};

function readConfig() {
  try {
    const config = JSON.parse(readFileSync(configFile, 'utf8'));
    return typeof config?.url === 'string' && typeof config?.token === 'string' && config.url && config.token ? config : null;
  } catch {
    return null;
  }
}

async function probe(url) {
  try {
    const response = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(1500) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

async function waitForOperator(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const config = readConfig();
    if (config && await probe(config.url)) return config;
    await new Promise(resolveWait => setTimeout(resolveWait, 300));
  }
  throw new Error('Workspace Operator 未在 ' + timeoutMs + 'ms 内就绪；检查 ' + configFile);
}

function findDesktopExe() {
  if (option('--exe')) return option('--exe');
  if (process.env.DSH_DESKTOP_EXE) return process.env.DSH_DESKTOP_EXE;
  const candidates = [
    'H:/Dsh/DeepSeek Harness.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe'),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'DeepSeek Harness', 'DeepSeek Harness.exe'),
  ].filter(Boolean);
  return candidates.find(candidate => existsSync(candidate));
}

async function main() {
  let owned = null;
  const existing = readConfig();
  if (existing && await probe(existing.url)) {
    console.log('[flovart] 复用已运行的 Workspace Operator：' + existing.url);
  } else {
    owned = spawn(process.execPath, [join(REPO_ROOT, 'agent', 'index.js')], {
      cwd: REPO_ROOT,
      env: operatorEnv,
      // The Operator must outlive this launcher: DSH Desktop is single-instance,
      // so the process we spawn may hand off to an existing window and exit
      // immediately. Keeping the child attached would kill the Operator with it.
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    owned.once('error', error => { console.error('[flovart] 启动 Workspace Operator 失败：' + error.message); });
    const config = await waitForOperator();
    console.log('[flovart] Workspace Operator 已就绪：' + config.url + (flag('--ensure-only') ? '（后台保留）' : ''));
  }

  if (flag('--ensure-only')) {
    if (owned) owned.unref();
    return;
  }

  const desktop = findDesktopExe();
  if (!desktop) {
    if (owned) owned.kill();
    throw new Error('找不到 DSH Desktop。用 --exe <path> 或设置 DSH_DESKTOP_EXE。');
  }
  console.log('[flovart] 启动 DSH Desktop：' + desktop);
  const app = spawn(desktop, [], { stdio: 'ignore', windowsHide: false, detached: true });
  app.unref();
  if (owned) owned.unref();
}

main().catch(error => {
  console.error('[flovart] ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
