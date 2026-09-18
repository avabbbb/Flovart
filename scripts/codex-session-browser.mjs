// Persistent Browser Workflow client for Real Codex Golden Task trials.
// Launches a headless Chrome-for-Testing page, completes the one-time
// bootstrap, becomes the workspace writer, then stays alive so an external
// Codex CLI session can inspect/apply/run against the real visible Workflow.
//
// Usage: node scripts/codex-session-browser.mjs [--check] [--visible]
// Prints one JSON line on stdout when the browser is connected and is the
// workspace writer, then keeps the process (and page) alive until killed.
// --check: query the Agent /health endpoint, print
// {ok, clients, activeWriter, activeHostWriter} and exit 0/1 without
// launching a browser — lets trial harnesses verify the session writer.
// --visible: launch a real (non-headless) Chrome window instead of headless,
// so a human (or a screen recording) can watch the live Workflow while an
// external agent drives it.

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildBrowserBootstrapUrl, issueBrowserBootstrapToken, probeWebUi, redactBootstrapUrl } from '../tools/flovart/local-agent.js';
import { resolveTestTempRoot } from './test-temp-root.mjs';
const checkOnly = process.argv.includes('--check');
const visible = process.argv.includes('--visible');
// --auto-approve: pre-approve the Workflow confirmation gate (paid generation
// runs). A headless page cannot click the confirm dialog, so paid node.run
// trials drive a session that accepts the dialog programmatically. This models
// the task's declared approval — the safety ledger still records the action.
const autoApprove = process.argv.includes('--auto-approve');
if (checkOnly) {
  const homeDir = (await import('node:os')).homedir();
  const agentConfigPath = process.env.FLOVART_AGENT_CONFIG || join(homeDir, '.flovart', 'agent.json');
  try {
    const agent = JSON.parse(readFileSync(agentConfigPath, 'utf8'));
    const response = await fetch(new URL('/health', agent.url));
    const health = response.ok ? await response.json() : {};
    const ok = response.ok && health.ok !== false;
    console.log(JSON.stringify({
      ok,
      clients: Number(health.clients || 0),
      activeWriter: health.activeWriter ?? null,
      activeHostWriter: health.activeHostWriter ?? null,
    }));
    process.exit(ok ? 0 : 1);
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      clients: 0,
      activeWriter: null,
      activeHostWriter: null,
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exit(1);
  }
}


const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = resolveTestTempRoot(projectDir);
await mkdir(tempRoot, { recursive: true });
const testRoot = await mkdtemp(join(tempRoot, 'flovart-codex-session-'));

process.env.TEMP = testRoot;
process.env.TMP = testRoot;
process.env.TMPDIR = testRoot;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(check, timeoutMs = 90_000, intervalMs = 300) {
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
  throw lastError || new Error('Timed out waiting for Flovart services.');
}

const chromeExecutable = process.env.FLOVART_CHROME_PATH || chromium.executablePath();
if (!existsSync(chromeExecutable)) {
  throw new Error(`Chrome for Testing executable not found: ${chromeExecutable}`);
}

let browser = null;
let page = null;
try {
  // Agent + Web are assumed already running (via `flovart ensure`). Read the
  // default config locations the CLI writes to (~/.flovart).
  const homeDir = (await import('node:os')).homedir();
  const agentConfigPath = join(homeDir, '.flovart', 'agent.json');
  const webDiscoveryPath = join(homeDir, '.flovart', 'web.json');

  const agent = await waitFor(() => {
    const file = process.env.FLOVART_AGENT_CONFIG || agentConfigPath;
    if (!existsSync(file)) return null;
    const c = JSON.parse(readFileSync(file, 'utf8'));
    return c?.url && c?.token ? c : null;
  });

  const web = await waitFor(async () => {
    const file = process.env.FLOVART_WEB_DISCOVERY || webDiscoveryPath;
    if (!existsSync(file)) return null;
    const d = JSON.parse(readFileSync(file, 'utf8'));
    return await probeWebUi(d.url, { timeoutMs: 1200 }).catch(() => null);
  });
  const webDiscovery = JSON.parse(readFileSync(process.env.FLOVART_WEB_DISCOVERY || webDiscoveryPath, 'utf8'));

  // Initial connect retry: a dropped WebSocket/page during bootstrap used to
  // kill the script silently. Retry the launch+goto+mount handshake up to 3
  // times with 5s backoff, using a fresh profile dir per attempt. No watchdog
  // — once connected, the harness owns the process lifetime.
  async function connectBrowser(attempt) {
    const bootstrapToken = await issueBrowserBootstrapToken(agent);
    const bootstrapUrl = buildBrowserBootstrapUrl(web, { ...agent, bootstrapToken }, '#/app');
    const profileDir = join(testRoot, `chrome-profile-${attempt}`);
    await mkdir(profileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: !visible,
      executablePath: chromeExecutable,
      args: ['--no-first-run', '--no-default-browser-check'],
    });
    try {
      const nextPage = await context.newPage({ viewport: { width: 1440, height: 900 } });
      if (autoApprove) {
        // Accept every window.confirm dialog the confirmation gate raises, and
        // force window.confirm() true for synchronous code paths. Paid runs are
        // still submitted through the real provider — this only bypasses the
        // un-clickable headless dialog, not the approval ledger.
        nextPage.on('dialog', dialog => dialog.accept());
        await nextPage.addInitScript(() => { window.confirm = () => true; });
      }
      await nextPage.goto(bootstrapUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await nextPage.locator('body[data-flovart-mounted="1"]').waitFor({ state: 'attached', timeout: 60_000 });
      if (autoApprove) {
        // Belt-and-suspenders: the init script runs before app scripts, but a
        // post-load evaluate guarantees the override landed on the live window
        // even if the bundle re-wrapped or shadowed window.confirm at mount.
        await nextPage.evaluate(() => { window.confirm = () => true; });
      }
      return { context, page: nextPage };
    } catch (error) {
      try { await context.close(); } catch {}
      throw error;
    }
  }

  const maxConnectAttempts = 3;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const connected = await connectBrowser(attempt);
      browser = connected.context;
      page = connected.page;
      break;
    } catch (error) {
      if (attempt >= maxConnectAttempts) throw error;
      console.log(JSON.stringify({
        ok: false,
        role: 'session-browser',
        retrying: true,
        attempt,
        error: redactBootstrapUrl(error instanceof Error ? error.message : String(error)),
      }));
      await sleep(5_000);
    }
  }

  const health = await waitFor(async () => {
    const response = await fetch(new URL('/health', agent.url));
    if (!response.ok) return null;
    const value = await response.json();
    return Number(value.clients || 0) > 0 && value.hasWorkflow ? value : null;
  }, 45_000);

  console.log(JSON.stringify({
    ok: true,
    role: 'session-browser',
    webUrl: webDiscovery.url,
    agentUrl: agent.url,
    clients: Number(health.clients || 0),
    hasWorkflow: Boolean(health.hasWorkflow),
    pageUrl: page.url(),
  }));

  // Stay alive. The process is killed by the harness when the trial ends.
  // Node >=21 exits on an unsettled top-level await even with a live timer, so
  // do NOT await a never-resolving promise — keep the event loop open with a
  // handle and let module evaluation finish instead.
  setInterval(() => {}, 1 << 30);
  process.stdin.resume();
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    role: 'session-browser',
    error: redactBootstrapUrl(error instanceof Error ? error.message : String(error)),
  }));
  process.exitCode = 1;
} finally {
  // Only reached on startup failure; the success path parks above.
  if (process.exitCode) {
    try { await browser?.close(); } catch {}
    await rm(testRoot, { recursive: true, force: true }).catch(() => {});
  }
}

process.on('SIGTERM', async () => {
  try { await browser?.close(); } catch {}
  await rm(testRoot, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
});
process.on('SIGINT', async () => {
  try { await browser?.close(); } catch {}
  await rm(testRoot, { recursive: true, force: true }).catch(() => {});
  process.exit(0);
});
