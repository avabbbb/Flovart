import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildBrowserBootstrapUrl, issueBrowserBootstrapToken, probeWebUi, redactBootstrapUrl } from '../tools/flovart/local-agent.js';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = resolve(process.env.FLOVART_TEST_TMP_ROOT || resolve(projectDir, '.tmp'));
if (parse(tempRoot).root.toUpperCase() !== 'H:\\') throw new Error(`Chrome smoke tests must use an H: temp root: ${tempRoot}`);
await mkdir(tempRoot, { recursive: true });
const testRoot = await mkdtemp(join(tempRoot, 'flovart-chrome-smoke-'));
const env = {
  ...process.env,
  TEMP: testRoot,
  TMP: testRoot,
  TMPDIR: testRoot,
  FLOVART_PROJECT_DIR: projectDir,
  FLOVART_AGENT_CONFIG: join(testRoot, 'agent.json'),
  FLOVART_WEB_DISCOVERY: join(testRoot, 'web.json'),
  FLOVART_BROWSER_LAUNCH_STATE: join(testRoot, 'browser-launch.json'),
};
// Playwright inherits the parent environment, so keep Chromium's own crash,
// cache, and temporary writes beside the H: test profile as well.
process.env.TEMP = testRoot;
process.env.TMP = testRoot;
process.env.TMPDIR = testRoot;
const cliArgs = [
  'tools/flovart/cli.js',
  'start', '--source', '--web',
  '--web-port=0', '--agent-port=0', '--no-open',
];
const chromeExecutable = process.env.FLOVART_CHROME_PATH || chromium.executablePath();
if (!existsSync(chromeExecutable)) {
  throw new Error(`Chrome for Testing executable was not found: ${chromeExecutable}`);
}

const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));

async function waitFor(check, timeoutMs = 45_000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw lastError || new Error('Chrome smoke 等待本地服务超时。');
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      // The CLI may already have exited after reporting a startup failure.
    }
    return;
  }
  try { child.kill('SIGTERM'); } catch {}
}

const cli = spawn(process.execPath, cliArgs, {
  cwd: projectDir,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: false,
  windowsHide: true,
});
let cliOutput = '';
cli.stdout.on('data', chunk => { cliOutput += String(chunk); });
cli.stderr.on('data', chunk => { cliOutput += String(chunk); });

let browser = null;
let page = null;
let result = null;
try {
  const web = await waitFor(async () => {
    if (!existsSync(env.FLOVART_WEB_DISCOVERY)) return null;
    const discovery = readJson(env.FLOVART_WEB_DISCOVERY);
    return await probeWebUi(discovery.url, { timeoutMs: 800 }).catch(() => null);
  });
  const discovery = readJson(env.FLOVART_WEB_DISCOVERY);
  const agent = await waitFor(() => {
    if (!existsSync(env.FLOVART_AGENT_CONFIG)) return null;
    const connection = readJson(env.FLOVART_AGENT_CONFIG);
    return connection?.url && connection?.token ? connection : null;
  });
  const bootstrapToken = await issueBrowserBootstrapToken(agent);
  const bootstrapUrl = buildBrowserBootstrapUrl(web, { ...agent, bootstrapToken }, '#/app');
  const profileDir = join(testRoot, 'chrome-profile');
  await mkdir(profileDir, { recursive: true });
  browser = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    executablePath: chromeExecutable,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  // The Vite/WebUI page owns long-lived HMR and Agent connections. Waiting for
  // the browser's full DOMContentLoaded lifecycle can therefore be flaky even
  // after the document has committed and rendered its WebUI marker.
  await page.goto(bootstrapUrl, { waitUntil: 'commit', timeout: 15_000 });
  await page.locator('body[data-flovart-webui="1"]').waitFor({ state: 'attached', timeout: 15_000 });
  const health = await waitFor(async () => {
    const response = await fetch(new URL('/health', agent.url));
    if (!response.ok) return null;
    const value = await response.json();
    return Number(value.clients || 0) > 0 && value.hasWorkflow ? value : null;
  }, 30_000);
  const finalUrl = page.url();
  if (/[?&](agentToken|token)=/i.test(finalUrl)) throw new Error('Bootstrap secret remained in the browser URL.');
  result = {
    ok: true,
    browser: 'managed Chromium',
    webUrl: discovery.url,
    agentUrl: agent.url,
    browserConnected: true,
    clients: Number(health.clients || 0),
    hasWorkflow: Boolean(health.hasWorkflow),
    finalUrl,
    consoleErrors,
    pageErrors,
  };
} catch (error) {
  result = {
    ok: false,
    browser: 'managed Chromium',
    error: redactBootstrapUrl(error instanceof Error ? error.message : String(error)),
    cliOutput: redactBootstrapUrl(cliOutput.slice(-4000)),
  };
} finally {
  try { await page?.screenshot({ path: join(testRoot, 'chrome-smoke.png'), fullPage: true }); } catch {}
  try { await browser?.close(); } catch {}
  stopProcessTree(cli);
  await sleep(500);
  await rm(testRoot, { recursive: true, force: true });
}

console.log(JSON.stringify(result));
if (!result?.ok) process.exitCode = 1;
