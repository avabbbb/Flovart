import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeWebUi } from '../tools/flovart/local-agent.js';
import { assertTestPath, resolveTestTempRoot } from './test-temp-root.mjs';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const externalTargetUrl = process.env.FLOVART_TEST_URL?.trim() || null;
const chromeExecutable = process.env.FLOVART_CHROME_PATH || chromium.executablePath();
if (!existsSync(chromeExecutable)) throw new Error(`Chrome for Testing executable was not found: ${chromeExecutable}`);

const testTempRoot = resolveTestTempRoot(projectDir);
const outputDir = assertTestPath(
  process.env.FLOVART_RESPONSIVE_ARTIFACT_DIR || resolve(testTempRoot, 'responsive-agent-link-artifacts'),
  'Responsive Agent artifacts',
);
await mkdir(testTempRoot, { recursive: true });
await mkdir(outputDir, { recursive: true });
const profileDir = await mkdtemp(resolve(testTempRoot, 'flovart-responsive-agent-link-'));
const serviceDir = externalTargetUrl ? null : await mkdtemp(resolve(testTempRoot, 'flovart-responsive-agent-link-service-'));
process.env.TEMP = profileDir;
process.env.TMP = profileDir;
process.env.TMPDIR = profileDir;

const viewports = [
  ['2560x1440', 2560, 1440], ['1920x1080', 1920, 1080], ['1600x900', 1600, 900],
  ['1366x768', 1366, 768], ['1280x720', 1280, 720], ['1024x768', 1024, 768],
  ['768x1024', 768, 1024], ['640x900', 640, 900], ['480x800', 480, 800], ['390x844', 390, 844],
];

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

async function waitFor(stage, check, timeoutMs = 60_000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let lastValue = null;
  let attempts = 0;
  while (Date.now() <= deadline) {
    attempts += 1;
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
      lastValue = error;
    }
    await sleep(intervalMs);
  }
  const detail = `stage=${stage} attempts=${attempts} last=${describeWaitValue(lastValue)}`;
  if (lastError) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`等待 Flovart WebUI 超时 (${detail}): ${message}`);
  }
  throw new Error(`等待 Flovart WebUI 超时 (${detail})。`);
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
      // The managed CLI may already have exited after reporting a startup failure.
    }
    return;
  }
  try { child.kill('SIGTERM'); } catch {}
}

async function checkAppAgent(page, width, height) {
  const result = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      shellBottom: shell?.getBoundingClientRect().bottom || 0,
      mainVisible: Boolean(document.querySelector('[data-testid="agent-main-workspace"]')?.getBoundingClientRect().width),
      hasSeparator: Boolean(document.querySelector('[role="separator"]')),
    };
  });
  if (result.scrollWidth > width + 1 || result.shellBottom < height - 2 || !result.mainVisible || result.hasSeparator) {
    throw new Error(`App Agent ${width}x${height}: ${JSON.stringify(result)}`);
  }
  return result;
}

async function assertTopLevelModes(page) {
  for (const label of ['工作流', 'Table', 'Agent']) {
    const modeButton = page.getByRole('button', { name: label, exact: true });
    await modeButton.waitFor({ state: 'visible', timeout: 30_000 });
  }
}

function assertDefaultAgentCopy(bodyText) {
  if (!bodyText.includes('外部 Agent 优先')) throw new Error('External Agent priority copy is missing.');
  if (/Production Crew|Director|Writer|Projection|Token/i.test(bodyText)) {
    throw new Error('Advanced Agent implementation terms leaked into the default user path.');
  }
}

let context = null;
let managedCli = null;
let managedCliOutput = '';
try {
  let targetUrl = externalTargetUrl;
  if (!targetUrl) {
    const serviceEnv = {
      ...process.env,
      TEMP: serviceDir,
      TMP: serviceDir,
      TMPDIR: serviceDir,
      FLOVART_PROJECT_DIR: projectDir,
      FLOVART_AGENT_CONFIG: join(serviceDir, 'agent.json'),
      FLOVART_WEB_DISCOVERY: join(serviceDir, 'web.json'),
      FLOVART_BROWSER_LAUNCH_STATE: join(serviceDir, 'browser-launch.json'),
    };
    managedCli = spawn(process.execPath, [
      'tools/flovart/cli.js',
      'start', '--source', '--web',
      '--web-port=0', '--agent-port=0', '--no-open',
    ], {
      cwd: projectDir,
      env: serviceEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    managedCli.stdout.on('data', chunk => { managedCliOutput += String(chunk); });
    managedCli.stderr.on('data', chunk => { managedCliOutput += String(chunk); });
    let lastWebObservation = 'discovery-file-missing';
    try {
      targetUrl = await waitFor('web-discovery', async () => {
        if (managedCli.exitCode !== null) {
          throw new Error(`托管 Flovart 启动失败: ${managedCliOutput.slice(-2000)}`);
        }
        const discoveryFile = serviceEnv.FLOVART_WEB_DISCOVERY;
        if (!existsSync(discoveryFile)) {
          lastWebObservation = 'discovery-file-missing';
          return null;
        }
        const discovery = readJson(discoveryFile);
        const origin = await probeWebUi(discovery.url, { timeoutMs: 800 }).catch(() => null);
        if (origin) return origin;
        // Probe keeps returning null; keep the redacted discovery file so a
        // stale-URL race is visible in the timeout output.
        lastWebObservation = { probe: 'null', discovery: { url: discovery.url, pid: discovery.pid ?? null } };
        return null;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message} webLast=${describeWaitValue(lastWebObservation)}`);
    }
  }

  context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    executablePath: chromeExecutable,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));

  const appUrl = new URL(targetUrl);
  appUrl.searchParams.set('responsive-reset', String(Date.now()));
  appUrl.hash = '/app';
  // domcontentloaded + the React-mount marker so a cold Vite compile cannot
  // time out at the navigation step before the app has executed.
  await page.goto(appUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForSelector('body[data-flovart-mounted="1"]', { timeout: 60_000 });
  await page.waitForSelector('.app-shell', { timeout: 45_000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('body[data-flovart-mounted="1"]', { timeout: 60_000 });
  await assertTopLevelModes(page);

  await page.getByRole('button', { name: '工作流', exact: true }).click();
  const createWorkflow = page.locator('button[aria-label="新建工作流"]');
  await page.waitForSelector('[data-testid="workflow-editor"], button[aria-label="新建工作流"]', { timeout: 30_000 });
  if (await page.locator('[data-testid="workflow-editor"]').count() === 0) {
    await createWorkflow.first().click();
  }
  await page.waitForSelector('[data-testid="workflow-editor"]', { timeout: 30_000 });

  const workflowAgentButton = page.getByRole('button', { name: '打开 Agent', exact: true });
  if (!(await workflowAgentButton.isVisible())) throw new Error('Workflow Agent action is not visible.');
  await workflowAgentButton.click();
  await page.waitForSelector('[data-testid="agent-main-workspace"]', { timeout: 15_000 });
  await page.waitForSelector('section[aria-label="外部 Agent"]', { timeout: 15_000 });

  if (await page.locator('.workflow-agent').count() > 0) throw new Error('Embedded Flovart Assistant mounted by default.');
  assertDefaultAgentCopy(await page.locator('body').innerText());

  for (const [name, width, height] of viewports) {
    await page.setViewportSize({ width, height });
    const result = await checkAppAgent(page, width, height);
    await page.screenshot({ path: resolve(outputDir, `app-agent-default-${name}.png`) });
    console.log(JSON.stringify({ surface: 'app-agent-default', name, ...result }));
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  const embeddedAssistantButton = page.getByRole('button', { name: '打开可选内置助手', exact: true });
  if (!(await embeddedAssistantButton.isVisible())) throw new Error('Optional embedded Assistant action is not visible.');
  await embeddedAssistantButton.click();
  await page.waitForSelector('.workflow-agent', { state: 'visible', timeout: 15_000 });
  await page.screenshot({ path: resolve(outputDir, 'app-agent-embedded-1280x720.png') });
  console.log(JSON.stringify({ surface: 'app-agent-embedded', visible: true }));

  if (consoleErrors.length || pageErrors.length) throw new Error(`Browser errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
  console.log(JSON.stringify({ ok: true, viewports: viewports.length, artifacts: outputDir }));
} finally {
  await context?.close().catch(() => {});
  stopProcessTree(managedCli);
  await sleep(500);
  await rm(profileDir, { recursive: true, force: true });
  if (serviceDir) await rm(serviceDir, { recursive: true, force: true });
}
