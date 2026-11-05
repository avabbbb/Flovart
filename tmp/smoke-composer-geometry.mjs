import { chromium } from 'playwright';

const base = 'http' + '://' + '127.0.0.1' + ':37522/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1568, height: 710 } });
await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1500);
const blank = page.locator('button.workflow-start-blank');
if (await blank.count()) await blank.first().click();
await page.waitForTimeout(1500);
if (!(await page.locator('.agent-composer__tools:visible').count())) {
  const open = page.getByRole('button', { name: /打开 Agent/ });
  if (await open.count()) await open.first().click().catch(() => {});
}
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const describe = el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { tag: el.tagName, cls: String(el.className).slice(0, 60), label: el.getAttribute('aria-label'), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], display: cs.display, visibility: cs.visibility, opacity: cs.opacity, overflow: cs.overflow, flex: cs.flex };
  };
  const out = [];
  for (const composer of document.querySelectorAll('.agent-composer__controls')) {
    let el = composer;
    const chain = [];
    while (el && el !== document.body) { chain.push(describe(el)); el = el.parentElement; }
    out.push({ ancestors: chain.slice(0, 8), children: [...composer.querySelectorAll(':scope > *, .agent-composer__tools > *, .agent-composer__tools > * > button')].map(describe) });
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: 'tmp/composer-geometry.png' });
await browser.close();
