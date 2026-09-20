// HOLDOUT — run only by the integrator, post-fix. Cold first-run onboarding:
// from a blank project, can a user reach a usable canvas + assistant without
// prior knowledge? Fresh context, no seeded state.
export default async function run(session) {
  const { page, observe, assert, screenshot, metric } = session;
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const t0 = Date.now();
  const obs = await observe();
  assert(obs.buttons.length > 0, 'first launch exposes controls');

  // A usable create affordance must be in-viewport and clickable.
  const cta = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /新建工作流|创建项目|Create/.test(x.textContent));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
  });
  assert(cta && cta.inView, `primary create CTA is in-viewport (x=${cta?.x})`);
  metric('timeToFirstUsefulAction', Date.now() - t0);
  await screenshot('cold-onboarding');
}
