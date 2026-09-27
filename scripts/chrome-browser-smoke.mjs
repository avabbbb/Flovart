import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildBrowserBootstrapUrl, issueBrowserBootstrapToken, probeWebUi, redactBootstrapUrl } from '../tools/flovart/local-agent.js';
import { resolveTestTempRoot } from './test-temp-root.mjs';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = resolveTestTempRoot(projectDir);
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

function describeWaitValue(value) {
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

async function waitFor(stage, check, timeoutMs = 45_000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let lastValue = null;
  let attempts = 0;
  while (Date.now() <= deadline) {
    attempts += 1;
    try {
      const value = await check();
      if (value) return value;
      lastValue = value;
    } catch (error) {
      lastError = error;
      lastValue = error;
    }
    await sleep(intervalMs);
  }
  const detail = `stage=${stage} attempts=${attempts} last=${describeWaitValue(lastValue)}`;
  if (lastError) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Chrome smoke 等待本地服务超时 (${detail}): ${message}`);
  }
  throw new Error(`Chrome smoke 等待本地服务超时 (${detail})。`);
}

async function waitForWebDiscovery(env, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let lastObservation = 'discovery-file-missing';
  let attempts = 0;
  while (Date.now() <= deadline) {
    attempts += 1;
    try {
      if (!existsSync(env.FLOVART_WEB_DISCOVERY)) {
        lastObservation = 'discovery-file-missing';
      } else {
        const discovery = readJson(env.FLOVART_WEB_DISCOVERY);
        const origin = await probeWebUi(discovery.url, { timeoutMs: 800 }).catch(() => null);
        if (origin) return origin;
        // The probe keeps returning null; keep the redacted discovery file so a
        // stale-URL race is visible in the timeout output.
        lastObservation = { probe: 'null', discovery: { url: redactBootstrapUrl(discovery.url), pid: discovery.pid ?? null, startedAt: discovery.startedAt ?? null } };
      }
    } catch (error) {
      lastError = error;
      lastObservation = error;
    }
    await sleep(250);
  }
  const detail = `stage=web-discovery attempts=${attempts} last=${describeWaitValue(lastObservation)}`;
  if (lastError) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Chrome smoke 等待本地服务超时 (${detail}): ${message}`);
  }
  throw new Error(`Chrome smoke 等待本地服务超时 (${detail})。`);
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

async function auditWorkflowToolbar(page, outputDir) {
  await page.getByRole('button', { name: /新建工作流|New workflow/ }).first().click();
  await page.locator('.workflow-toolbar').waitFor({ state: 'visible', timeout: 30_000 });

  const cases = [
    { key: 'add', trigger: { zh: '添加节点', en: 'Add node' }, popup: { zh: '[role="menu"][aria-label="添加节点"]', en: '[role="menu"][aria-label="Add nodes"]' }, minWidth: 150 },
    { key: 'tools', trigger: { zh: '工具箱', en: 'Tools' }, popup: { zh: '[role="menu"][aria-label="画布工具箱"]', en: '[role="menu"][aria-label="Canvas tools"]' }, minWidth: 150 },
    { key: 'shared-media', trigger: { zh: '共享素材', en: 'Shared media' }, popup: '[data-testid="workflow-toolbar-library"]', minWidth: 240 },
    { key: 'history', trigger: { zh: '历史', en: 'History' }, popup: { zh: '[role="menu"][aria-label="历史操作"]', en: '[role="menu"][aria-label="History actions"]' }, minWidth: 150 },
    { key: 'shortcuts', trigger: { zh: '快捷键', en: 'Keyboard shortcuts' }, popup: { zh: '[role="dialog"][aria-label="画布快捷键"]', en: '[role="dialog"][aria-label="Canvas shortcuts"]' }, minWidth: 180 },
  ];
  const audit = [];
  const runLocale = async (locale, widths) => {
    for (const width of widths) {
      const height = width === 280 ? 700 : 900;
      await page.setViewportSize({ width, height });
      const layout = await page.evaluate(() => {
        const controls = document.querySelector('.workflow-canvas-controls')?.getBoundingClientRect();
        const toolbar = document.querySelector('.workflow-toolbar')?.getBoundingClientRect();
        const overlap = controls && toolbar ? {
          width: Math.max(0, Math.min(controls.right, toolbar.right) - Math.max(controls.left, toolbar.left)),
          height: Math.max(0, Math.min(controls.bottom, toolbar.bottom) - Math.max(controls.top, toolbar.top)),
        } : null;
        return { documentWidth: document.documentElement.scrollWidth, controls: controls && { x: controls.x, y: controls.y, right: controls.right, bottom: controls.bottom }, toolbar: toolbar && { x: toolbar.x, y: toolbar.y, right: toolbar.right, bottom: toolbar.bottom }, overlap };
      });
      await page.screenshot({ path: join(outputDir, `workflow-toolbar-${locale}-${width}.png`), fullPage: true });
      assert.ok(layout.documentWidth <= width + 1, `${locale} ${width}px: document overflows to ${layout.documentWidth}px`);
      assert.ok(!layout.overlap || layout.overlap.width === 0 || layout.overlap.height === 0, `${locale} ${width}px: bottom controls overlap (${JSON.stringify(layout)})`);

      const viewportCases = [...cases, {
        key: 'zoom',
        trigger: { zh: '重置缩放', en: 'Reset zoom' },
        toolbar: { zh: '画布控制', en: 'Canvas controls' },
        popup: { zh: '[role="menu"][aria-label="画布控制"]', en: '[role="menu"][aria-label="Canvas controls"]' },
        minWidth: 150,
      }];
      for (const item of viewportCases) {
        const toolbarName = item.toolbar?.[locale] || (locale === 'zh' ? '工作流工具栏' : 'Workflow toolbar');
        const trigger = page.getByRole('toolbar', { name: toolbarName }).getByRole('button', { name: item.trigger[locale] });
        assert.ok(await trigger.isVisible(), `${locale} ${width}px: ${item.key} trigger is not visible`);
        await trigger.click();
        const selector = typeof item.popup === 'string' ? item.popup : item.popup[locale];
        const popup = page.locator(selector);
        await popup.waitFor({ state: 'visible', timeout: 3_000 });
        await page.waitForTimeout(100);
        const geometry = await popup.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const clippedBy = [];
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            const clipsX = /(hidden|clip|auto|scroll)/.test(style.overflowX);
            const clipsY = /(hidden|clip|auto|scroll)/.test(style.overflowY);
            if (!clipsX && !clipsY) continue;
            const parentRect = parent.getBoundingClientRect();
            if ((clipsX && (rect.left < parentRect.left || rect.right > parentRect.right)) || (clipsY && (rect.top < parentRect.top || rect.bottom > parentRect.bottom))) clippedBy.push(parent.className || parent.tagName);
          }
          return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, clippedBy, focusInside: element.contains(document.activeElement) };
        });
        assert.ok(geometry.x >= -1 && geometry.y >= -1 && geometry.right <= width + 1 && geometry.bottom <= height + 1, `${locale} ${width}px: ${item.key} popup outside viewport (${JSON.stringify(geometry)})`);
        assert.ok(geometry.width >= Math.min(item.minWidth, width - 16) - 1, `${locale} ${width}px: ${item.key} popup collapsed to ${geometry.width}px`);
        assert.deepEqual(geometry.clippedBy, [], `${locale} ${width}px: ${item.key} popup clipped by an ancestor`);
        assert.ok(geometry.focusInside, `${locale} ${width}px: ${item.key} did not receive keyboard focus`);
        await page.screenshot({ path: join(outputDir, `workflow-toolbar-${locale}-${width}-${item.key}.png`) });
        await page.keyboard.press('Escape');
        await popup.waitFor({ state: 'detached', timeout: 3_000 });
        assert.ok(await trigger.evaluate(element => element === document.activeElement), `${locale} ${width}px: ${item.key} did not restore focus after Escape`);
        audit.push({ locale, width, key: item.key, ...geometry });
      }
    }
  };

  await runLocale('zh', [1440, 768, 280]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Switch to English' }).click();
  await runLocale('en', [1440, 768, 280]);
  return audit;
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
  const web = await waitForWebDiscovery(env);
  const discovery = readJson(env.FLOVART_WEB_DISCOVERY);
  const agent = await waitFor('agent-config', () => {
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
  // Navigate with domcontentloaded (not commit) so the module script runs and
  // Vite finishes compiling before we assert. Then wait for the React-mount
  // marker — not the static data-flovart-webui HTML attribute, which is
  // present in index.html before any script executes and would pass a bare
  // fetch on a cold compile (Vite cold start measured 26–48s).
  await page.goto(bootstrapUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.locator('body[data-flovart-mounted="1"]').waitFor({ state: 'attached', timeout: 60_000 });
  let lastHealthObservation = 'no-response';
  let health = null;
  try {
    health = await waitFor('browser-health', async () => {
      const response = await fetch(new URL('/health', agent.url));
      if (!response.ok) {
        lastHealthObservation = `http-${response.status}`;
        return null;
      }
      const value = await response.json();
      if (Number(value.clients || 0) > 0 && value.hasWorkflow) return value;
      lastHealthObservation = { probe: 'not-ready', health: value };
      return null;
    }, 30_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} healthLast=${describeWaitValue(lastHealthObservation)}`);
  }
  const uiAuditDir = join(projectDir, '.tmp', 'ui-audit');
  await mkdir(uiAuditDir, { recursive: true });
  const workflowToolbarAudit = await auditWorkflowToolbar(page, uiAuditDir);
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
    workflowToolbarAudit,
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
