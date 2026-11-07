// Hosted demo smoke: loads the static Pages build (no local Agent, no API key)
// at desktop and narrow sizes, visits Canvas | Reverse | Agent, and records
// screenshots, console/page errors, stuck loading text and horizontal overflow.
// Usage: FLOVART_TEST_URL=<pages url> node scripts/hosted-demo-smoke.mjs [label]
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultUrl = 'http:' + '//' + '127.0.0.1:4179' + '/Flovart/';
const targetUrl = process.env.FLOVART_TEST_URL || defaultUrl;
const label = process.argv[2] || 'local-dist';
const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(projectDir, '.tmp', 'hosted-demo', label);
await mkdir(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const viewports = [['desktop', 1440, 900], ['narrow', 390, 844]];
const LOADING = /正在加载|Loading Workflow|Loading\.\.\./;

const browser = await chromium.launch({ headless: true, executablePath: process.env.FLOVART_CHROME_PATH || chromium.executablePath() });
const summary = { targetUrl, label, at: new Date().toISOString(), runs: [] };
try {
  for (const [name, width, height] of viewports) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', e => pageErrors.push(String(e && e.message || e).slice(0, 300)));
    page.on('requestfailed', r => failedRequests.push(r.url().slice(0, 200) + ' ' + (r.failure() ? r.failure().errorText : '')));
    page.on('response', r => { if (r.status() >= 400) failedRequests.push(r.status() + ' ' + r.url().slice(0, 200)); });
    const run = { viewport: name, width, height, tabs: [] };
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    run.httpStatus = response ? response.status() : null;
    run.mounted = await page.locator('body[data-flovart-mounted="1"]').waitFor({ state: 'attached', timeout: 60000 }).then(() => true).catch(() => false);
    await sleep(3000);
    await page.screenshot({ path: join(outDir, name + '-first-screen.png') });
    run.firstScreenText = (await page.locator('body').innerText().catch(() => '')).slice(0, 800);
    const tabs = page.locator('.studio-top-menu__modes [role="tab"]');
    run.tabCount = await tabs.count();
    for (let i = 0; i < run.tabCount; i += 1) {
      const tab = tabs.nth(i);
      const tabLabel = (await tab.innerText().catch(() => '')).trim();
      const visible = await tab.isVisible().catch(() => false);
      if (visible) await tab.click({ timeout: 10000 }).catch(() => {});
      await sleep(10000);
      const text = await page.locator('body').innerText().catch(() => '');
      const metrics = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      await page.screenshot({ path: join(outDir, name + '-tab-' + i + '.png') });
      run.tabs.push({ index: i, label: tabLabel, visible, stuckLoadingAfter10s: LOADING.test(text), horizontalOverflow: metrics.documentWidth > metrics.innerWidth + 1, metrics, textSample: text.slice(0, 600) });
    }
    // Start path: empty canvas -> labeled sample canvas -> run without a key shows the setup guide.
    const canvasTab = tabs.first();
    if (run.tabCount && await canvasTab.isVisible().catch(() => false)) await canvasTab.click({ timeout: 10000 }).catch(() => {});
    await sleep(2000);
    const sampleButton = page.getByTestId('workflow-open-sample');
    run.sampleButtonVisible = await sampleButton.isVisible().catch(() => false);
    if (run.sampleButtonVisible) {
      await sampleButton.click({ timeout: 10000 });
      await sleep(1500);
      const sampleShots = page.locator('.workflow-node--video');
      run.sampleShotCount = await sampleShots.count();
      run.sampleLabeled = /示例 · 镜头 1/.test(await page.locator('body').innerText().catch(() => ''));
      await page.screenshot({ path: join(outDir, name + '-sample-canvas.png') });
      if (run.sampleShotCount) {
        await sampleShots.first().click({ button: 'right', timeout: 10000 }).catch(() => {});
        await page.getByRole('menuitem', { name: /运行|生成|Run/ }).first().click({ timeout: 10000 }).catch(() => {});
        run.noKeyGuideShown = await page.getByTestId('workflow-no-key-guide').isVisible({ timeout: 5000 }).catch(() => false);
        await page.screenshot({ path: join(outDir, name + '-no-key-guide.png') });
      }
    }
    run.sampleOpened = run.sampleButtonVisible === true && run.sampleShotCount === 3 && run.sampleLabeled === true;
    run.consoleErrors = consoleErrors;
    run.pageErrors = pageErrors;
    run.failedRequests = failedRequests.slice(0, 20);
    summary.runs.push(run);
    await context.close();
  }
} finally {
  await browser.close();
}
summary.ok = summary.runs.every(r => r.mounted && r.pageErrors.length === 0 && r.consoleErrors.length === 0 && r.sampleOpened && r.noKeyGuideShown && r.tabs.every(t => !t.stuckLoadingAfter10s && !t.horizontalOverflow));
await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ok: summary.ok, outDir, runs: summary.runs.map(r => ({ viewport: r.viewport, httpStatus: r.httpStatus, mounted: r.mounted, tabCount: r.tabCount, sampleOpened: r.sampleOpened, sampleShotCount: r.sampleShotCount, noKeyGuideShown: r.noKeyGuideShown, consoleErrors: r.consoleErrors, pageErrors: r.pageErrors, tabs: r.tabs.map(t => ({ label: t.label, visible: t.visible, stuck: t.stuckLoadingAfter10s, overflow: t.horizontalOverflow })) })) }, null, 2));
process.exitCode = summary.ok ? 0 : 1;
