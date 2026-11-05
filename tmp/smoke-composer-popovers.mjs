import { chromium } from 'playwright';

const base = 'http' + '://' + '127.0.0.1' + ':37522/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1568, height: 710 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1500);
const blank = page.locator('button.workflow-start-blank');
if (await blank.count()) await blank.first().click();
await page.waitForTimeout(1500);
if (!(await page.locator('.agent-composer__tools:visible').count())) {
  const open = page.getByRole('button', { name: /打开 Agent/ });
  if (await open.count()) await open.first().click().catch(() => {});
}
await page.locator('.agent-composer__tools:visible').first().waitFor({ timeout: 15000 });

const triggers = [
  ['creation', page.locator('.agent-composer__tools:visible button[aria-label="创作模式"]').first()],
  ['model', page.locator('.agent-composer__tools:visible button[aria-label="选择模型"]').first()],
  ['mode', page.locator('.agent-composer__tools:visible button[aria-label="生成模式"]').first()],
];
for (const [name, trigger] of triggers) {
  await trigger.click({ timeout: 5000 });
  await page.waitForTimeout(400);
  const result = await page.evaluate(() => {
    const menus = [...document.querySelectorAll('.agent-composer__tools .agent-mode-menu')].filter(el => el.getClientRects().length);
    const menu = menus[0];
    if (!menu) return { open: false };
    const r = menu.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(20, r.height / 2));
    const cs = getComputedStyle(menu);
    const aside = menu.closest('aside');
    const a = aside ? aside.getBoundingClientRect() : { left: 0, right: innerWidth, top: 0 };
    return { open: true, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], insidePanel: r.left >= a.left && r.right <= a.right && r.top >= a.top, hitInside: Boolean(hit && menu.contains(hit)), backdrop: cs.backdropFilter, background: cs.backgroundColor };
  });
  console.log(name, JSON.stringify(result));
  await page.screenshot({ path: 'tmp/popover-' + name + '.png' });
  await page.keyboard.press('Escape');
  await trigger.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
  const stillOpen = await page.locator('.agent-composer__tools .agent-mode-menu:visible').count();
  if (stillOpen) await trigger.click().catch(() => {});
}
console.log('PAGE_ERRORS', JSON.stringify(errors.slice(0, 10)));
await browser.close();
