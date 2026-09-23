#!/usr/bin/env node
// Shared Playwright driver for the Product Maturity Eval.
//
// Every UX scenario runs against the LIVE app (vite dev server) in a real
// Chromium browser with a fresh context, tracing, DOM snapshot, console and
// network capture — matching the MASTER GOAL's evidence requirement.
//
// A scenario is an async function receiving a `session` object:
//   session.page      — Playwright Page
//   session.observe() — structured DOM/a11y observables
//   session.metric(k) — record a UX observable (clicks, deadEnds, ...)
//   session.screenshot(name)
//   session.assert(cond, label)
//
// Usage:
//   node eval/product-maturity/driver.mjs <scenario-file> [--out <dir>]
//
// The driver never imports app source — UX evaluators drive it black-box.

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
export const APP_URL = process.env.FLOVART_APP_URL || 'http://localhost:37522/#/app';

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 720 },
  tablet: { width: 1024, height: 768 },
  narrow: { width: 768, height: 600 },
  mobile: { width: 390, height: 844 },
};

/**
 * Launch a traced, fresh-context browser session against the live app.
 * Returns a session with helpers + a `finish()` that writes the evidence pack.
 */
export async function openSession({ viewport = VIEWPORTS.desktop, outDir, name = 'session', headless = true } = {}) {
  const out = outDir || join(here, 'results', `${Date.now()}-${name}`);
  await mkdir(out, { recursive: true });

  const browser = await chromium.launch({
    headless,
    // Prefer the bundled browser; fall back to system Chrome when the Playwright
    // browser cache doesn't match this playwright version.
    channel: process.env.FLOVART_NO_SYSTEM_CHROME ? undefined : 'chrome',
  });
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: join(out, 'video') },
    // File System Access API is unavailable headless; agents that need a real
    // folder grant run headed via openSession({ headless:false }).
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });

  const consoleLog = [];
  const networkLog = [];
  const page = await context.newPage();
  page.on('console', m => consoleLog.push({ type: m.type(), text: m.text(), t: Date.now() }));
  page.on('pageerror', e => consoleLog.push({ type: 'pageerror', text: String(e), t: Date.now() }));

  const metrics = {};
  const assertions = [];
  page.on('response', res => networkLog.push({ url: res.url(), status: res.status(), t: Date.now() }));
  const metric = (key, n = 1) => { metrics[key] = (metrics[key] || 0) + n; };
  const session = {
    page,
    context,
    browser,
    outDir: out,
    viewport,
    metrics,
    metric,
    url: APP_URL,
    async goto() {
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200); // let the SPA mount + hydrate
    },
    /** Structured observables: what a real user can currently perceive. */
    async observe() {
      return page.evaluate(() => {
        const txt = el => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        const visible = el => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
        };
        const buttons = [...document.querySelectorAll('button, [role=button], a, [role=tab]')]
          .filter(visible).map(e => ({ text: txt(e), aria: e.getAttribute('aria-label'), disabled: e.disabled }));
        const scrollers = [...document.querySelectorAll('*')]
          .filter(e => { const s = getComputedStyle(e); return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 4; })
          .map(e => ({ cls: (e.className || '').toString().slice(0, 40), scrollable: e.scrollHeight - e.clientHeight }));
        const dialogs = [...document.querySelectorAll('[role=dialog],[role=alert],dialog')].filter(visible).map(txt);
        const canvases = [...document.querySelectorAll('canvas,[data-testid*=canvas],[class*=workflow-editor]')].filter(visible).length;
        return {
          title: document.title,
          hash: location.hash,
          viewport: { w: innerWidth, h: innerHeight },
          pageScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight,
          buttons,
          scrollers,
          dialogs,
          canvases,
          focused: document.activeElement ? txt(document.activeElement) || document.activeElement.tagName : null,
        };
      });
    },
    async screenshot(name) {
      const file = join(out, `${name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      return file;
    },
    assert(cond, label) {
      assertions.push({ label, pass: !!cond });
      return !!cond;
    },
    /** Click by role+name (preferred) or visible text. Counts the click. */
    async click(name, { role = 'button' } = {}) {
      metric('clicks');
      const loc = role ? page.getByRole(role, { name }) : page.getByText(name, { exact: false });
      await loc.first().click({ timeout: 5000 });
    },
    /** Finish: write trace, console, network, metrics, assertions, snapshot. */
    async finish({ status = 'done' } = {}) {
      const domSnapshot = await session.observe().catch(() => null);
      await context.tracing.stop({ path: join(out, 'trace.zip') });
      await writeFile(join(out, 'console.json'), JSON.stringify(consoleLog, null, 2));
      await writeFile(join(out, 'network.json'), JSON.stringify(networkLog, null, 2));
      await writeFile(join(out, 'observables.json'), JSON.stringify({ metrics, assertions, domSnapshot, status }, null, 2));
      await context.close();
      await browser.close();
      const failed = assertions.filter(a => !a.pass);
      const result = { name, status, metrics, assertions, failed: failed.length, outDir: out };
      await writeFile(join(out, 'result.json'), JSON.stringify(result, null, 2));
      return result;
    },
  };
  return session;
}

// CLI: run a single scenario file that default-exports an async (session) => {}.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const scenarioPath = process.argv[2];
  if (!scenarioPath) {
    console.error('usage: driver.mjs <scenario-file> [--out dir] [--viewport name]');
    process.exit(2);
  }
  const outIdx = process.argv.indexOf('--out');
  const vpIdx = process.argv.indexOf('--viewport');
  const outDir = outIdx > -1 ? resolve(process.argv[outIdx + 1]) : undefined;
  const viewport = vpIdx > -1 ? VIEWPORTS[process.argv[vpIdx + 1]] || VIEWPORTS.desktop : VIEWPORTS.desktop;
  const mod = await import(pathToFileURL(resolve(scenarioPath)).href);
  const session = await openSession({ viewport, outDir, name: scenarioPath.replace(/\W+/g, '-') });
  try {
    await session.goto();
    await mod.default(session);
    const result = await session.finish({ status: 'done' });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.failed > 0 ? 1 : 0);
  } catch (err) {
    session.metric('crashes');
    const result = await session.finish({ status: 'crash' });
    console.error('SCENARIO CRASH:', err.message);
    console.log(JSON.stringify(result, null, 2));
    process.exit(3);
  }
}
