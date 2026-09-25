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
  ['280x700', 280, 700], ['320x700', 320, 700], ['360x700', 360, 700], ['400x700', 400, 700],
  ['480x800', 480, 800], ['560x800', 560, 800], ['768x700', 768, 700], ['1024x768', 1024, 768],
  ['1280x800', 1280, 800], ['1440x900', 1440, 900], ['1920x1080', 1920, 1080], ['1280x600', 1280, 600],
];

const tableViewports = [
  ['280x700', 280, 700], ['320x700', 320, 700], ['480x800', 480, 800],
  ['768x700', 768, 700], ['1024x768', 1024, 768], ['1280x800', 1280, 800],
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
      mainVisible: Boolean(document.querySelector('[data-testid="agent-connections-page"]')?.getBoundingClientRect().width),
      separators: [...document.querySelectorAll('[role="separator"]')].map(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { className: String(element.className), width: rect.width, height: rect.height, display: style.display, visibility: style.visibility, opacity: style.opacity };
      }),
    };
  });
  const visibleSeparator = result.separators.some(item => item.width > 0 && item.height > 0 && item.display !== 'none' && item.visibility !== 'hidden' && item.opacity !== '0');
  if (result.scrollWidth > width + 1 || result.shellBottom < height - 2 || !result.mainVisible || visibleSeparator) {
    throw new Error(`App Agent ${width}x${height}: ${JSON.stringify(result)}`);
  }
  return result;
}

async function assertTopLevelModes(page) {
  for (const label of ['画布', 'Table', 'Agent']) {
    const modeButton = page.getByRole('tab', { name: label, exact: true });
    await modeButton.waitFor({ state: 'visible', timeout: 30_000 });
  }
}

function assertDefaultAgentCopy(bodyText) {
  if (!bodyText.includes('协作 Agent')) throw new Error('Agent connection surface heading is missing.');
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

  await page.getByRole('tab', { name: '画布', exact: true }).click();
  const createWorkflow = page.locator('button[aria-label="新建工作流"]');
  await page.waitForSelector('[data-testid="workflow-editor"], button[aria-label="新建工作流"]', { timeout: 30_000 });
  if (await page.locator('[data-testid="workflow-editor"]').count() === 0) {
    await createWorkflow.first().click();
  }
  await page.waitForSelector('[data-testid="workflow-editor"]', { timeout: 30_000 });

  const canvasViewports = [
    ['768x700', 768, 700], ['1024x768', 1024, 768], ['1280x800', 1280, 800], ['1440x900', 1440, 900],
    ['1920x1080', 1920, 1080], ['1280x600', 1280, 600],
  ];
  for (const [name, width, height] of canvasViewports) {
    await page.setViewportSize({ width, height });
    const result = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      editor: document.querySelector('[data-testid="workflow-editor"]')?.getBoundingClientRect().toJSON() || null,
    }));
    if (result.scrollWidth > width + 1 || !result.editor || result.editor.width <= 0) {
      throw new Error(`Canvas ${width}x${height}: ${JSON.stringify(result)}`);
    }
    await page.screenshot({ path: resolve(outputDir, `canvas-${name}.png`) });
  }

  await page.setViewportSize({ width: 768, height: 700 });
  const toolboxTrigger = page.getByRole('button', { name: '工具箱', exact: true });
  await toolboxTrigger.click();
  const toolboxMenu = page.getByRole('menu', { name: '画布工具箱' });
  await toolboxMenu.waitFor({ state: 'visible' });
  const toolboxBounds = await toolboxMenu.evaluate(menu => {
    const rect = menu.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  if (toolboxBounds.left < 0 || toolboxBounds.top < 0 || toolboxBounds.right > toolboxBounds.viewportWidth || toolboxBounds.bottom > toolboxBounds.viewportHeight) {
    throw new Error(`Canvas toolbox overflow: ${JSON.stringify(toolboxBounds)}`);
  }
  await page.getByRole('menuitem', { name: '适应视图' }).click();

  // PromptBar is attached to a selected generation node. Create a deterministic
  // image node so this assertion exercises the mounted surface, not an empty canvas.
  await page.getByRole('button', { name: '添加节点', exact: true }).click();
  await page.getByRole('menuitem', { name: '图片', exact: true }).click();
  const imageNode = page.locator('.workflow-node--image').last();
  await imageNode.waitFor({ state: 'visible' });
  await imageNode.click();
  await page.locator('[data-testid="workflow-node-prompt-bar"]').waitFor({ state: 'visible' });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  const longEnglishNodeTitle = 'Generate another variation from the current selected timeline clip — rhart-video/sparkvideo-2.0/multimodal-video';
  await imageNode.locator('.workflow-node__title').dblclick();
  const nodeTitleInput = imageNode.locator('.workflow-node__title input');
  await nodeTitleInput.fill(longEnglishNodeTitle);
  await nodeTitleInput.press('Enter');
  const englishTitleMetrics = await imageNode.locator('.workflow-node__title-text').evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  if (englishTitleMetrics.scrollWidth <= englishTitleMetrics.clientWidth || englishTitleMetrics.documentWidth > englishTitleMetrics.viewportWidth + 1) {
    throw new Error(`Long English node title did not stay contained with ellipsis: ${JSON.stringify(englishTitleMetrics)}`);
  }
  await page.screenshot({ path: resolve(outputDir, 'canvas-stress-en-1280x800.png') });
  await page.screenshot({ path: resolve(outputDir, 'canvas-en-1280x800.png') });
  const promptMoreOptions = page.getByRole('button', { name: 'More options', exact: true });
  await promptMoreOptions.waitFor({ state: 'visible' });
  await promptMoreOptions.click();
  const promptOptionsDialog = page.getByRole('dialog', { name: 'More options', exact: true });
  await promptOptionsDialog.waitFor({ state: 'visible' });
  const promptOptionsText = await promptOptionsDialog.innerText();
  if (!promptOptionsText.toLowerCase().includes('more options') || /\p{Script=Han}/u.test(promptOptionsText)) {
    throw new Error(`Prompt options English copy is incomplete: ${JSON.stringify(promptOptionsText)} Han=${JSON.stringify(promptOptionsText.match(/\p{Script=Han}/gu) || [])}`);
  }
  await page.keyboard.press('Escape');
  await promptMoreOptions.waitFor({ state: 'visible' });
  if (!(await promptMoreOptions.evaluate(button => document.activeElement === button))) {
    throw new Error('Prompt popover did not restore focus to its trigger after Escape.');
  }
  await page.screenshot({ path: resolve(outputDir, 'canvas-prompt-options-en-1280x800.png') });
  const englishToolboxTrigger = page.getByRole('button', { name: 'Tools', exact: true });
  await englishToolboxTrigger.click();
  const englishToolbox = page.getByRole('menu', { name: 'Canvas tools', exact: true });
  const englishToolboxText = await englishToolbox.innerText();
  if (/\p{Script=Han}/u.test(englishToolboxText)) throw new Error(`Canvas toolbox English copy is incomplete: ${JSON.stringify(englishToolboxText)}`);
  await page.keyboard.press('Escape');
  if (!(await englishToolboxTrigger.evaluate(button => document.activeElement === button))) throw new Error('Canvas toolbox did not restore focus after Escape.');
  await page.getByRole('button', { name: '切换到中文', exact: true }).click();
  await page.getByRole('tab', { name: '画布', exact: true }).waitFor();
  const longChineseNodeTitle = '根据当前选中的时间线片段生成一个新的场景版本；供应商已收到任务，但暂时没有拿到最终回执，请先查询原任务后再重试';
  await imageNode.locator('.workflow-node__title').dblclick();
  await imageNode.locator('.workflow-node__title input').fill(longChineseNodeTitle);
  await imageNode.locator('.workflow-node__title input').press('Enter');
  const chineseTitleMetrics = await imageNode.locator('.workflow-node__title-text').evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    viewportWidth: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  if (chineseTitleMetrics.scrollWidth <= chineseTitleMetrics.clientWidth || chineseTitleMetrics.documentWidth > chineseTitleMetrics.viewportWidth + 1) {
    throw new Error(`Long Chinese node title did not stay contained with ellipsis: ${JSON.stringify(chineseTitleMetrics)}`);
  }
  await page.screenshot({ path: resolve(outputDir, 'canvas-stress-zh-1280x800.png') });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await page.waitForSelector('.table-workspace', { timeout: 15_000 });
  await page.screenshot({ path: resolve(outputDir, 'table-zh-1280x800.png') });
  await page.setViewportSize({ width: 280, height: 700 });
  if ((await page.evaluate(() => document.documentElement.scrollWidth)) > 281) throw new Error('Table Chinese surface overflows at 280x700.');
  await page.screenshot({ path: resolve(outputDir, 'table-zh-280x700.png') });
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await page.getByText('Single-asset workspace', { exact: true }).waitFor();
  for (const [name, width, height] of tableViewports) {
    await page.setViewportSize({ width, height });
    const result = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      table: document.querySelector('.table-workspace')?.getBoundingClientRect().toJSON() || null,
    }));
    if (result.scrollWidth > width + 1 || !result.table || result.table.width <= 0) {
      throw new Error(`Table ${width}x${height}: ${JSON.stringify(result)}`);
    }
    await page.screenshot({ path: resolve(outputDir, `table-${name}.png`) });
  }
  await page.getByRole('button', { name: '切换到中文', exact: true }).click();
  await page.getByText('单素材工作台', { exact: true }).waitFor();

  await page.getByRole('tab', { name: 'Agent', exact: true }).click();
  await page.waitForSelector('[data-testid="agent-connections-page"]', { timeout: 15_000 });
  await page.waitForSelector('[data-testid="agent-host-picker"]', { timeout: 15_000 });

  const assistantDrawer = page.locator('.workflow-agent');
  if (await assistantDrawer.count() > 0 && await assistantDrawer.isVisible()) {
    throw new Error('The canvas-only assistant drawer is visible on the dedicated Agent surface.');
  }
  assertDefaultAgentCopy(await page.locator('body').innerText());

  for (const [name, width, height] of viewports) {
    await page.setViewportSize({ width, height });
    const result = await checkAppAgent(page, width, height);
    await page.screenshot({ path: resolve(outputDir, `app-agent-default-${name}.png`) });
    console.log(JSON.stringify({ surface: 'app-agent-default', name, ...result }));
  }

  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await page.getByRole('heading', { name: 'Connect a local Agent', exact: true }).waitFor();
  for (const [name, width, height] of [['1280x800', 1280, 800], ['280x700', 280, 700]]) {
    await page.setViewportSize({ width, height });
    const result = await checkAppAgent(page, width, height);
    const bodyText = await page.locator('[data-testid="agent-connections-page"]').innerText();
    if (!bodyText.includes('Collaborating agent') || bodyText.includes('连接本地 Agent')) {
      throw new Error(`Agent English locale mismatch at ${width}x${height}`);
    }
    await page.screenshot({ path: resolve(outputDir, `app-agent-en-${name}.png`) });
    console.log(JSON.stringify({ surface: 'app-agent-en', name, ...result }));
  }
  await page.getByRole('button', { name: '切换到中文', exact: true }).click();
  await page.getByRole('heading', { name: '连接本地 Agent', exact: true }).waitFor();

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('tab', { name: '画布', exact: true }).click();
  const workflowAgentButton = page.getByRole('button', { name: /^(打开 Agent|收起 Agent)$/ }).first();
  if (!(await workflowAgentButton.isVisible())) throw new Error('Workflow Agent action is not visible.');
  if (await workflowAgentButton.getAttribute('aria-pressed') === 'true') await workflowAgentButton.click();
  await page.getByRole('button', { name: '打开 Agent', exact: true }).click();
  await page.waitForSelector('.compact-right-panel[data-open="true"]', { timeout: 15_000 });
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
