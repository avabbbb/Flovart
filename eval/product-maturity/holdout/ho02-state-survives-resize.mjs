// HOLDOUT — resize during work must retain drawer + selection state.
export default async function run(session) {
  const { page, assert, screenshot, metric } = session;
  const wf = page.locator('a,button').filter({ hasText: /^(Workflow|工作流)$/ }).first();
  if (await wf.count()) { await wf.click(); metric('clicks'); await page.waitForTimeout(700); }
  const create = page.locator('button').filter({ hasText: /新建工作流|创建项目/ }).first();
  if (await create.count()) { await create.click(); metric('clicks'); await page.waitForTimeout(800); }

  // Open the right drawer if it isn't already (PRO-04 made it default-open on
  // desktop). The collapsed-state "open" button stays in the DOM with
  // pointer-events:none while the drawer is open, so gate on drawer's data-open,
  // not on the button's mere presence — clicking it when open is intercepted.
  const drawer = page.locator('aside[data-open="true"]');
  if ((await drawer.count()) === 0) {
    const openBtn = page.locator('button[title*="打开右侧面板"]').first();
    if (await openBtn.count()) { await openBtn.click(); metric('clicks'); await page.waitForTimeout(500); }
  }
  assert((await drawer.count()) > 0, 'drawer open before resize');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(400);
  const stillOpen = await page.locator('aside[data-open="true"]').count();
  assert(stillOpen > 0, 'drawer stays open across viewport resize');
  await screenshot('resize-state');
}
