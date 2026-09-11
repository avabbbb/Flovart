import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertTestPath, resolveTestTempRoot } from './test-temp-root.mjs';

const targetUrl = process.env.FLOVART_TEST_URL || 'http://127.0.0.1:7410';
const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chromeExecutable = process.env.FLOVART_CHROME_PATH || chromium.executablePath();
if (!existsSync(chromeExecutable)) throw new Error(`Chrome for Testing executable was not found: ${chromeExecutable}`);
const tempRoot = resolveTestTempRoot(projectDir);
const outputDir = assertTestPath(process.env.FLOVART_RESPONSIVE_ARTIFACT_DIR || resolve(tempRoot, 'responsive-artifacts'), 'Responsive UI artifacts');
await mkdir(tempRoot, { recursive: true });
const profileDir = await mkdtemp(resolve(tempRoot, 'flovart-responsive-ui-'));
process.env.TEMP = profileDir;
process.env.TMP = profileDir;
process.env.TMPDIR = profileDir;
const viewports = [
  ['2560x1440', 2560, 1440], ['1920x1080', 1920, 1080], ['1600x900', 1600, 900],
  ['1440x900', 1440, 900], ['1366x768', 1366, 768], ['1280x720', 1280, 720],
  ['1024x768', 1024, 768], ['820x1180', 820, 1180], ['768x1024', 768, 1024],
  ['640x900', 640, 900], ['480x800', 480, 800], ['430x932', 430, 932],
  ['390x844', 390, 844], ['360x800', 360, 800], ['320x800', 320, 800],
];
const shortViewports = [['1280x600', 1280, 600], ['1024x600', 1024, 600], ['768x500', 768, 500]];

const sleep = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

async function viewport(page, width, height) {
  await page.setViewportSize({ width, height });
  await sleep(120);
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const isEffectivelyVisible = element => {
      let current = element;
      while (current && current !== document.documentElement) {
        const style = getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        current = current.parentElement;
      }
      return true;
    };
    const visibleOutOfBounds = Array.from(document.body.querySelectorAll('*'))
      .filter(element => {
        if (!isEffectivelyVisible(element)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
      })
      .slice(0, 8)
      .map(element => ({ tag: element.tagName, className: typeof element.className === 'string' ? element.className : '', rect: element.getBoundingClientRect().toJSON() }));
    return {
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      shell: document.querySelector('.app-shell, .dock-page')?.getBoundingClientRect().toJSON() || null,
      visibleOutOfBounds,
    };
  });
}

async function assertPageFits(page, label, { allowCanvasChildren = false } = {}) {
  const metrics = await layoutMetrics(page);
  const outOfBounds = allowCanvasChildren
    ? metrics.visibleOutOfBounds.filter(item => !/workflow|canvas|konva/i.test(item.className))
    : metrics.visibleOutOfBounds;
  if (metrics.documentWidth > metrics.viewport.width + 1 || metrics.bodyWidth > metrics.viewport.width + 1 || outOfBounds.length) {
    throw new Error(`${label}: horizontal overflow ${JSON.stringify(metrics)}`);
  }
  if (metrics.shell && metrics.shell.bottom < metrics.viewport.height - 2) {
    throw new Error(`${label}: shell does not fill viewport ${JSON.stringify(metrics)}`);
  }
  return metrics;
}

async function assertVisibleRect(page, selector, label) {
  const rect = await page.locator(selector).first().evaluate(element => element.getBoundingClientRect().toJSON());
  const { width, height } = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  if (rect.left < -1 || rect.top < -1 || rect.right > width + 1 || rect.bottom > height + 1) {
    throw new Error(`${label}: element is outside viewport ${JSON.stringify({ rect, width, height })}`);
  }
  return rect;
}

async function capture(page, surface, [name, width, height], selector, options = {}) {
  await viewport(page, width, height);
  if (selector) await page.waitForSelector(selector, { state: 'visible', timeout: 15_000 });
  const metrics = await assertPageFits(page, `${surface}/${name}`, options);
  if (options.visibleSelector) await assertVisibleRect(page, options.visibleSelector, `${surface}/${name}`);
  await page.screenshot({ path: resolve(outputDir, surface, `${name}.png`), fullPage: false });
  console.log(JSON.stringify({ surface, name, ...metrics }));
}

async function captureMatrix(page, surface, selector, options = {}) {
  for (const item of viewports) await capture(page, surface, item, selector, options);
}

async function captureShortMatrix(page, surface, selector, options = {}) {
  for (const item of shortViewports) await capture(page, surface, item, selector, options);
}

async function openApp(page) {
  await page.goto(`${targetUrl}/#/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.studio-top-menu', { timeout: 15_000 });
  await sleep(1200);
}

await mkdir(outputDir, { recursive: true });
await mkdir(resolve(outputDir, 'agent-link'), { recursive: true });
await mkdir(resolve(outputDir, 'settings'), { recursive: true });
await mkdir(resolve(outputDir, 'ai-services'), { recursive: true });
await mkdir(resolve(outputDir, 'workflow-shell'), { recursive: true });
await mkdir(resolve(outputDir, 'table'), { recursive: true });

let context = null;

try {
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

  await page.goto(`${targetUrl}/#/dock`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="production-control"]', { timeout: 15_000 });
  await sleep(600);
  await captureMatrix(page, 'agent-link', '.dock-page');
  await captureShortMatrix(page, 'agent-link-short', '.dock-page');

  await viewport(page, 480, 800);
  await page.getByText('高级连接设置 · Developer connection', { exact: true }).click();
  await assertVisibleRect(page, '.agent-link-surface__advanced-body', 'agent-link/advanced');
  await capture(page, 'agent-link', ['advanced-480x800', 480, 800], '.dock-page');
  await capture(page, 'agent-link', ['advanced-320x800', 320, 800], '.dock-page');

  await openApp(page);
  const agentMode = page.locator('.studio-top-menu__modes').getByRole('button', { name: 'Agent', exact: true });
  await agentMode.click();
  await page.waitForSelector('[data-testid="agent-main-workspace"]', { timeout: 15_000 });
  await captureMatrix(page, 'agent', '[data-testid="agent-main-workspace"]');

  await viewport(page, 390, 844);
  const settingsButton = page.getByRole('button', { name: '设置', exact: true }).last();
  await settingsButton.click();
  await page.waitForSelector('[data-testid="settings-dialog"]', { state: 'visible', timeout: 15_000 });
  await captureMatrix(page, 'settings', '[data-testid="settings-dialog"]', { visibleSelector: '[data-testid="settings-dialog"]' });
  await captureShortMatrix(page, 'settings-short', '[data-testid="settings-dialog"]', { visibleSelector: '[data-testid="settings-dialog"]' });

  await viewport(page, 390, 844);
  const mobileApiCategory = page.locator('.settings-dialog__mobile-nav button').filter({ hasText: 'AI 服务' });
  if (await mobileApiCategory.isVisible().catch(() => false)) await mobileApiCategory.click();
  await page.getByRole('button', { name: '+ 添加 AI 服务', exact: true }).click();
  await page.waitForSelector('.settings-key-dialog', { state: 'visible', timeout: 15_000 });
  await page.locator('input[name="apiKey"]').fill('responsive-test-key');
  await page.locator('input[name="baseUrl"]').fill('https://example.invalid/v1');
  for (const item of [['form-390x844', 390, 844], ['form-320x800', 320, 800], ['form-480x800', 480, 800], ['form-768x500', 768, 500]]) {
    await capture(page, 'ai-services', item, '.settings-key-dialog', { visibleSelector: '.settings-key-dialog' });
    const values = await page.evaluate(() => ({ key: document.querySelector('input[name="apiKey"]')?.value, baseUrl: document.querySelector('input[name="baseUrl"]')?.value }));
    if (values.key !== 'responsive-test-key' || values.baseUrl !== 'https://example.invalid/v1') throw new Error(`ai-services/${item[0]}: form state changed ${JSON.stringify(values)}`);
  }
  // The URL field deliberately stops key events so typing cannot close the
  // surrounding settings dialog. Move focus to the dialog chrome before
  // exercising the modal Escape path.
  await page.locator('.settings-key-dialog__header').click();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.settings-key-dialog', { state: 'detached', timeout: 5000 });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();

  await openApp(page);
  await page.locator('.studio-top-menu__modes').getByRole('button', { name: '工作流', exact: true }).click();
  await sleep(1000);
  await captureMatrix(page, 'workflow-shell', '.workflow-workspace', { allowCanvasChildren: true });
  await page.locator('.studio-top-menu__modes').getByRole('button', { name: 'Table', exact: true }).click();
  await sleep(900);
  await capture(page, 'table', ['table-1024x768', 1024, 768], '.table-workspace', { allowCanvasChildren: true });
  await capture(page, 'table', ['table-640x900', 640, 900], '.table-workspace', { allowCanvasChildren: true });

  const onboardingVisible = await page.locator('[data-testid="onboarding-dialog"]').isVisible().catch(() => false);
  console.log(JSON.stringify({ surface: 'onboarding', status: onboardingVisible ? 'captured' : 'not-mounted-by-current-first-run-state' }));
  if (!onboardingVisible) console.log('Onboarding browser capture skipped because current app state does not mount the wizard; component coverage remains in Vitest.');

  if (consoleErrors.length || pageErrors.length) throw new Error(`Browser errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
  console.log(JSON.stringify({ ok: true, surfaces: ['agent-link', 'agent', 'settings', 'ai-services', 'workflow-shell', 'table'], artifacts: outputDir }));
} finally {
  await context?.close().catch(() => {});
  await rm(profileDir, { recursive: true, force: true });
}
