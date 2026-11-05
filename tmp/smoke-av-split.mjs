import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const base = 'http' + '://' + '127.0.0.1' + ':37522/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', msg => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1500);

// 起始页没有打开任何工作流项目，先新建画布。
const blank = page.locator('button.workflow-start-blank');
if (await blank.count()) { await blank.first().click(); console.log('CLICKED_NEW_CANVAS'); }
const editor = page.locator('[data-testid="workflow-editor"]');
await editor.first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
console.log('EDITOR_COUNT', await editor.count());
await page.waitForTimeout(1000);

const b64 = readFileSync('tmp/smoke.mp4').toString('base64');
await page.evaluate(async ({ b64 }) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const file = new File([bytes], 'smoke.mp4', { type: 'video/mp4' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const target = document.querySelector('[data-testid="workflow-editor"]') || document.body;
  const rect = target.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  for (const type of ['dragenter', 'dragover', 'drop']) {
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX, clientY }));
  }
}, { b64 });
await page.waitForTimeout(5000);
await page.screenshot({ path: 'tmp/smoke-1-dropped.png' });

console.log('VIDEO_ELEMENTS', await page.locator('video').count(), 'PLACEHOLDERS', await page.locator('[data-testid="workflow-video-placeholder"]').count());
const nodeEl = page.locator('[data-workflow-node-id], .workflow-node').first();
console.log('NODE_COUNT', await page.locator('[data-workflow-node-id], .workflow-node').count());
if (await nodeEl.count()) {
  const box = await nodeEl.boundingBox();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + 10);
}
await page.waitForTimeout(2500);
await page.screenshot({ path: 'tmp/smoke-2-selected.png' });
const labels = await page.$$eval('.workflow-toolbar button, [data-testid*=toolbar] button', els => els.map(el => (el.getAttribute('aria-label') || el.textContent || '').trim()).filter(Boolean));
console.log('TOOLBAR', JSON.stringify(labels));

const split = page.getByRole('button', { name: '分离音视频' });
console.log('SPLIT_BUTTONS', await split.count());
if (await split.count()) {
  console.log('SPLIT_DISABLED', await split.first().isDisabled());
  await split.first().click();
  await page.waitForTimeout(500);
  console.log('SPLIT_MENU', JSON.stringify(await page.$$eval('[role=menuitem]', els => els.map(el => el.textContent.trim()))));
  await page.screenshot({ path: 'tmp/smoke-3-menu.png' });
  const item = page.getByRole('menuitem', { name: '分离音视频' });
  if (await item.count()) {
    await item.first().click();
    await page.waitForFunction(() => /已创建无声视频|分离失败|失败/.test(document.body.innerText), null, { timeout: 90000 }).catch(() => {});
    const text = await page.evaluate(() => document.body.innerText);
    console.log('NOTICE', (text.match(/[^\n]*(已创建无声视频|分离失败)[^\n]*/) || ['none'])[0]);
    console.log('HAS_SILENT_TITLE', /_无声/.test(text), 'HAS_AUDIO_TITLE', /_音频/.test(text));
    console.log('VIDEO_ELEMENTS_AFTER', await page.locator('video').count(), 'AUDIO_ELEMENTS_AFTER', await page.locator('audio').count(), 'NODES_AFTER', await page.locator('[data-workflow-node-id], .workflow-node').count());
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'tmp/smoke-4-split.png' });
  }
}
console.log('PAGE_ERRORS', JSON.stringify(errors.slice(0, 20)));
await browser.close();
