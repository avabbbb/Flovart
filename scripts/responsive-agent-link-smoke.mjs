import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetUrl = process.env.FLOVART_TEST_URL || 'http://127.0.0.1:7410';
const chromeExecutable = process.env.FLOVART_CHROME_PATH || chromium.executablePath();
if (!existsSync(chromeExecutable)) throw new Error(`Chrome for Testing executable was not found: ${chromeExecutable}`);
const testTempRoot = resolve(process.env.FLOVART_TEST_TMP_ROOT || resolve(projectDir, '.tmp'));
if (parse(testTempRoot).root.toUpperCase() !== 'H:\\') throw new Error(`Responsive Agent tests must use an H: temp root: ${testTempRoot}`);
const outputDir = resolve(process.env.FLOVART_RESPONSIVE_ARTIFACT_DIR || resolve(testTempRoot, 'responsive-agent-link-artifacts'));
if (parse(outputDir).root.toUpperCase() !== 'H:\\') throw new Error('Responsive Agent artifacts must use an H: output root.');
await mkdir(testTempRoot, { recursive: true });
const profileDir = await mkdtemp(resolve(testTempRoot, 'flovart-responsive-agent-link-'));
process.env.TEMP = profileDir;
process.env.TMP = profileDir;
process.env.TMPDIR = profileDir;
const viewports = [
  ['2560x1440', 2560, 1440], ['1920x1080', 1920, 1080], ['1600x900', 1600, 900],
  ['1366x768', 1366, 768], ['1280x720', 1280, 720], ['1024x768', 1024, 768],
  ['768x1024', 768, 1024], ['640x900', 640, 900], ['480x800', 480, 800], ['390x844', 390, 844],
];

async function checkDock(page, width, height) {
  const result = await page.evaluate(() => {
    const shell = document.querySelector('.dock-page');
    const rect = shell?.getBoundingClientRect();
    const control = document.querySelector('.agent-control-shell');
    const linkGrid = document.querySelector('.agent-link-surface__grid');
    const linkCards = Array.from(document.querySelectorAll('.agent-link-surface__grid > .agent-link-surface__card'));
    const advancedSummary = document.querySelector('.agent-link-surface__advanced > summary');
    const gridRect = linkGrid?.getBoundingClientRect();
    const cardBottom = linkCards.reduce((bottom, card) => Math.max(bottom, card.getBoundingClientRect().bottom), 0);
    const summaryTop = advancedSummary?.getBoundingClientRect().top;
    const layoutOverflow = Boolean(control && [control, ...control.children].some(element => element.scrollWidth > element.clientWidth + 1));
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      shellBottom: rect?.bottom || 0,
      shellVisible: Boolean(shell && rect && rect.width > 0 && rect.height > 0),
      layoutOverflow,
      agentLinkGridBottom: gridRect?.bottom || null,
      agentLinkCardBottom: cardBottom || null,
      agentLinkAdvancedTop: summaryTop ?? null,
    };
  });
  const linkStackOverlaps = result.agentLinkCardBottom !== null
    && result.agentLinkGridBottom !== null
    && result.agentLinkAdvancedTop !== null
    && (result.agentLinkCardBottom > result.agentLinkGridBottom + 1 || result.agentLinkGridBottom > result.agentLinkAdvancedTop + 1);
  if (result.scrollWidth > width + 1 || result.layoutOverflow || !result.shellVisible || result.shellBottom < height - 2 || linkStackOverlaps) throw new Error(`Dock ${width}x${height}: ${JSON.stringify(result)}`);
  return result;
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
  if (result.scrollWidth > width + 1 || result.shellBottom < height - 2 || !result.mainVisible || result.hasSeparator) throw new Error(`App Agent ${width}x${height}: ${JSON.stringify(result)}`);
  return result;
}

function startMockCrew() {
  const server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', 'content-type, x-flovart-agent-token');
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.url?.startsWith('/events')) {
      response.setHeader('cache-control', 'no-cache');
      response.setHeader('connection', 'keep-alive');
      response.setHeader('content-type', 'text/event-stream');
      response.write('event: hello\ndata: {}\n\n');
      request.on('close', () => response.end());
      return;
    }
    const payload = request.url?.startsWith('/crew/protocol')
      ? { ok: true, protocolVersion: '1', registryHash: '0'.repeat(64), capabilities: ['command', 'events', 'crew-intent'], limits: {} }
      : request.url?.startsWith('/director/status')
        ? { ok: true, binding: null, archivedCount: 0, projectId: null }
        : request.url?.startsWith('/crew/events')
          ? { ok: true, events: [], nextEventId: 0, hasMore: false }
          : { ok: true };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(payload));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

await mkdir(outputDir, { recursive: true });
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
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded' });

  if (await page.getByText('Agent 地址', { exact: true }).isVisible()) throw new Error('Agent URL is visible before Advanced opens.');
  if (await page.getByText('Token', { exact: true }).isVisible()) throw new Error('Token is visible before Advanced opens.');
  await page.getByText('高级连接设置 · Developer connection', { exact: true }).click();
  if (!(await page.getByText('Agent 地址', { exact: true }).isVisible())) throw new Error('Advanced Agent URL did not open.');
  await page.locator('details.agent-link-surface__advanced > summary').click();

  for (const [name, width, height] of viewports) {
    await page.setViewportSize({ width, height });
    const result = await checkDock(page, width, height);
    await page.screenshot({ path: resolve(outputDir, `after-${name}.png`) });
    console.log(JSON.stringify({ surface: 'dock', name, ...result }));
  }

  await page.setViewportSize({ width: 1920, height: 832 });
  for (const width of [1500, 1100, 900, 700, 480, 1200]) {
    await page.setViewportSize({ width, height: 832 });
    const result = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, hasAgentCopy: document.body.textContent?.includes('AI 协作') || false }));
    if (result.scrollWidth > width + 1 || !result.hasAgentCopy) throw new Error(`Resize ${width}: ${JSON.stringify(result)}`);
    console.log(JSON.stringify({ surface: 'dock', resize: width, ...result }));
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: '切换协作 Agent' }).click();
  for (const [name, width, height] of [['bridge-1280x720', 1280, 720], ['bridge-480x800', 480, 800]]) {
    await page.setViewportSize({ width, height });
    const result = await checkDock(page, width, height);
    if (!(await page.locator('.dock-bridge').isVisible())) throw new Error(`Bridge ${name} is not visible.`);
    await page.screenshot({ path: resolve(outputDir, `after-${name}.png`) });
    console.log(JSON.stringify({ surface: 'dock-bridge', name, ...result }));
  }

  const mockCrew = await startMockCrew();
  try {
    const address = mockCrew.address();
    const mockUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    await page.goto(`${targetUrl}/#/dock`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ url }) => {
      localStorage.setItem('flovart.agent.url', url);
      sessionStorage.setItem('flovart.agent.token', 'responsive-test-token');
    }, { url: mockUrl });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.agent-control-shell', { timeout: 15_000 });
    for (const [name, width, height] of [['connected-1280x720', 1280, 720], ['connected-768x1024', 768, 1024], ['connected-480x800', 480, 800]]) {
      await page.setViewportSize({ width, height });
      const result = await checkDock(page, width, height);
      await page.screenshot({ path: resolve(outputDir, `${name}.png`) });
      console.log(JSON.stringify({ surface: 'dock-connected', name, ...result }));
    }

    // Reset persisted connection before the full navigation so the App Agent
    // checks cover the normal browser-only path. The full navigation also
    // resets the module-level browser binding from the Dock fixture.
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    const appUrl = new URL(targetUrl);
    appUrl.searchParams.set('responsive-reset', String(Date.now()));
    appUrl.hash = '/app';
    await page.goto(appUrl.toString(), { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Agent', exact: true }).click();
    await page.waitForSelector('[data-testid="agent-main-workspace"]', { timeout: 15_000 });
    for (const [name, width, height] of [['1920x1080', 1920, 1080], ['1366x768', 1366, 768], ['768x1024', 768, 1024]]) {
      await page.setViewportSize({ width, height });
      const result = await checkAppAgent(page, width, height);
      await page.screenshot({ path: resolve(outputDir, `app-agent-${name}.png`) });
      console.log(JSON.stringify({ surface: 'app-agent', name, ...result }));
    }
  } finally {
    // Release any EventSource opened by the connected fixture before closing
    // its local server.
    await page.goto('about:blank').catch(() => {});
    await new Promise(resolve => mockCrew.close(resolve));
  }

  if (consoleErrors.length || pageErrors.length) throw new Error(`Browser errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
  console.log(JSON.stringify({ ok: true, viewports: viewports.length, artifacts: outputDir }));
} finally {
  await context?.close().catch(() => {});
  await rm(profileDir, { recursive: true, force: true });
}
