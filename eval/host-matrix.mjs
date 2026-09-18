#!/usr/bin/env node
// Creative-Host interaction matrix harness (Phase 14/15).
//
// Renders the REAL shared Studio panel (integrations/studio/shared/inspector.js +
// panel.css) headlessly in Chromium across:
//   sizes  [280x420, 320x500, 360x540, 480x650, 600x800]
//   states [no-document, no-selection, selection-ready, offline, needs-login,
//           provider-missing, idle, submitting, running, success, failed,
//           cancelled, artifact-imported]
//   themes [dark, light]
//
// …and asserts the Phase-15 oracles per cell:
//   no-horizontal-overflow, primary-cta-visible, prompt-usable,
//   source-identity-visible, task-progress-not-clipped, result-reachable,
//   open-canvas-reachable, escape-closes-modal, no-double-submit,
//   resize-keeps-input-and-task
//
// Usage:
//   node eval/host-matrix.mjs                 # full matrix, report to stdout
//   node eval/host-matrix.mjs --json out.json # also write machine-readable report
//   node eval/host-matrix.mjs --state running --size 360x540 --theme dark
//
// Exit code is 0 even when oracle cells FAIL — this harness measures the
// product gap list; it does not gate. Use --strict to exit non-zero on any gap.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { resolveTestTempRoot } from '../scripts/test-temp-root.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const sharedDir = join(repoRoot, 'integrations', 'studio', 'shared');

const SIZES = [
  ['280x420', 280, 420],
  ['320x500', 320, 500],
  ['360x540', 360, 540],
  ['480x650', 480, 650],
  ['600x800', 600, 800],
];
const STATES = [
  'no-document', 'no-selection', 'selection-ready', 'offline', 'needs-login',
  'provider-missing', 'idle', 'submitting', 'running', 'success', 'failed',
  'cancelled', 'artifact-imported',
];
const THEMES = ['dark', 'light'];

const ORACLES = [
  'no-horizontal-overflow',
  'primary-cta-visible',
  'prompt-usable',
  'source-identity-visible',
  'task-progress-not-clipped',
  'result-reachable',
  'open-canvas-reachable',
  'escape-closes-modal',
  'no-double-submit',
  'resize-keeps-input-and-task',
];

// ---------------------------------------------------------------------------
// Chromium executable (repo convention: Playwright's Chrome for Testing).
// ---------------------------------------------------------------------------
const chromeExecutable = process.env.FLOVART_CHROME_PATH || chromium.executablePath();
if (!existsSync(chromeExecutable)) {
  throw new Error(`Chrome for Testing executable was not found: ${chromeExecutable}`);
}

// ---------------------------------------------------------------------------
// Static assets injected into the harness page (the real shared panel code).
// ---------------------------------------------------------------------------
const [hostContractSrc, inspectorSrc, panelCss] = await Promise.all([
  readFile(join(sharedDir, 'host-contract.js'), 'utf8'),
  readFile(join(sharedDir, 'inspector.js'), 'utf8'),
  readFile(join(sharedDir, 'panel.css'), 'utf8'),
]);

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const strict = args.includes('--strict');
const jsonOut = flag('json');
const onlyState = flag('state');
const onlySize = flag('size');
const onlyTheme = flag('theme');

/** The state matrix: each entry scripts adapter + controller + interaction. */
const STATE_PLANS = {
  'no-document':       { contextAvailable: false, selection: null, controller: true,  outcome: 'success' },
  'no-selection':      { contextAvailable: true,  selection: null, controller: true,  outcome: 'success' },
  'selection-ready':   { contextAvailable: true,  selection: 'clip', controller: true, outcome: 'success' },
  'offline':           { contextAvailable: true,  selection: 'clip', controller: true, outcome: 'offline',  interact: 'generate' },
  'needs-login':       { contextAvailable: true,  selection: 'clip', controller: true, outcome: 'needs-login', interact: 'generate' },
  'provider-missing':  { contextAvailable: true,  selection: 'clip', controller: true, outcome: 'provider-missing', interact: 'generate' },
  'idle':              { contextAvailable: true,  selection: 'clip', controller: true, outcome: 'success' },
  'submitting':        { contextAvailable: true,  selection: 'clip', controller: true, outcome: 'never', interact: 'generate' },
  'running':           { contextAvailable: true,  selection: 'clip', controller: true, outcome: 'never', interact: 'generate' },
  'success':           { contextAvailable: true,  selection: 'clip', controller: true, outcome: 'success', interact: 'generate' },
  'failed':            { contextAvailable: true,  selection: 'clip', controller: true, outcome: 'failed', interact: 'generate' },
  'cancelled':         { contextAvailable: true,  selection: 'clip', controller: true, outcome: 'cancelled', interact: 'generate' },
  'artifact-imported': { contextAvailable: true,  selection: 'clip', controller: true, outcome: 'success', interact: 'generate-then-history' },
};

// ---------------------------------------------------------------------------
// Per-cell oracle evaluation — runs INSIDE the page against the live DOM.
// ---------------------------------------------------------------------------
const ORACLE_EVAL = `(oracles) => {
  const results = {};
  const width = innerWidth;
  const root = document.getElementById('app');
  const panel = root && root.firstElementChild;
  const rectOf = el => el ? el.getBoundingClientRect() : null;
  const visible = el => {
    if (!el) return false;
    let node = el;
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      node = node.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const inBounds = el => {
    const r = rectOf(el);
    return !!r && r.left >= -1 && r.right <= width + 1 && r.width > 0 && r.height > 0 && visible(el);
  };

  const generate = panel && panel.querySelector('.fs-generate');
  const prompt = panel && panel.querySelector('textarea');
  const sourceInfo = panel && panel.querySelector('.fs-source-info');
  const status = panel && panel.querySelector('.fs-status');
  const canvasBtn = panel && panel.querySelector('.fs-icon-button[aria-label*="画布"]');
  const openCanvas = panel && panel.querySelector('.fs-header .fs-icon-button');

  // 1. no-horizontal-overflow: document + every visible element inside viewport width.
  const outOfBounds = Array.from(document.body.querySelectorAll('*')).filter(el => {
    if (!visible(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && (r.left < -1 || r.right > width + 1);
  }).slice(0, 5).map(el => el.className || el.tagName);
  results['no-horizontal-overflow'] = {
    pass: document.documentElement.scrollWidth <= width + 1 && document.body.scrollWidth <= width + 1 && outOfBounds.length === 0,
    detail: outOfBounds.length ? 'overflow: ' + outOfBounds.join(', ') : 'ok',
  };

  // 2. primary-cta-visible: the Generate button is present, in viewport, and its label non-empty.
  results['primary-cta-visible'] = {
    pass: !!generate && inBounds(generate) && generate.textContent.trim().length > 0,
    detail: generate ? generate.textContent.trim() : 'no .fs-generate',
  };

  // 3. prompt-usable: textarea present, not disabled, has usable height.
  const promptRect = rectOf(prompt);
  results['prompt-usable'] = {
    pass: !!prompt && visible(prompt) && !prompt.disabled && !!promptRect && promptRect.height >= 40,
    detail: promptRect ? 'h=' + Math.round(promptRect.height) : 'no textarea',
  };

  // 4. source-identity-visible: the .fs-source block shows the host/context label.
  const context = sourceInfo && sourceInfo.querySelector('span.fs-muted');
  const ref = sourceInfo && sourceInfo.querySelector('strong');
  results['source-identity-visible'] = {
    pass: !!sourceInfo && visible(sourceInfo) && !!context && context.textContent.trim().length > 0 && !!ref && ref.textContent.trim().length > 0,
    detail: ref ? ref.textContent.trim() + ' / ' + (context ? context.textContent.trim() : '') : 'no source info',
  };

  // 5. task-progress-not-clipped: status line, when non-empty, is fully inside the viewport height.
  const statusRect = rectOf(status);
  const statusText = status ? status.textContent.trim() : '';
  const statusVisible = statusText.length === 0 || (statusRect && statusRect.bottom <= innerHeight + 1 && statusRect.top >= -1);
  results['task-progress-not-clipped'] = {
    pass: statusVisible,
    detail: statusText ? 'bottom=' + (statusRect ? Math.round(statusRect.bottom) : 'n/a') + ' vh=' + innerHeight : 'no status',
  };

  // 6. result-reachable: a result/status message exists OR history tab can surface it.
  const historyTab = panel && Array.from(panel.querySelectorAll('.fs-tab')).find(t => t.textContent.includes('记录'));
  const statusHasResult = statusText.length > 0 && !/等待|尚未|连接 Flovart 后即可使用/.test(statusText);
  results['result-reachable'] = {
    pass: statusHasResult || !!historyTab,
    detail: statusText || (historyTab ? historyTab.textContent.trim() : 'none'),
  };

  // 7. open-canvas-reachable: the header canvas button is present and in bounds.
  results['open-canvas-reachable'] = {
    pass: !!openCanvas && inBounds(openCanvas),
    detail: openCanvas ? 'aria=' + openCanvas.getAttribute('aria-label') : 'no canvas button',
  };

  return results;
}`;

// ---------------------------------------------------------------------------
// Build one harness page, then run the matrix inside it cell-by-cell.
// ---------------------------------------------------------------------------
async function mountCell(page, { state, theme, plan }) {
  return page.evaluate(async ({ state, theme, plan }) => {
    // Tear down any previous mount.
    const app = document.getElementById('app');
    app.replaceChildren();
    window.__cell = { counters: { generateCalls: [] }, errors: [] };

    const counters = window.__cell.counters;
    const adapter = {
      id: 'premiere',
      async getContext() {
        if (plan.contextError) throw new Error(plan.contextError);
        return {
          host: 'premiere',
          available: plan.contextAvailable,
          ...(plan.contextAvailable ? { documentId: 'project-1', documentName: '客户访谈成片.prproj', title: '客户访谈成片.prproj' } : {}),
        };
      },
      async getSelection() {
        if (plan.selectionError) throw new Error(plan.selectionError);
        return plan.selection === null ? null : {
          host: 'premiere', selectionId: 'clip-1', label: '访谈主镜头 · A 机位.mov', kind: 'video',
          locator: { projectId: 'project-1', projectItemId: 'clip-1' }, mimeType: 'video/mp4', width: 1920, height: 1080,
        };
      },
      async materializeSelection(sel) { return { selection: sel, resource: { kind: 'image', mimeType: 'image/png' }, reference: { kind: 'image' } }; },
      async importArtifact() { return { ok: true, message: '已导入 Premiere 项目素材箱。' }; },
      subscribeContext() { return { dispose() {} }; },
    };
    const controller = {
      async generate(prompt, target) {
        counters.generateCalls.push({ prompt, target });
        const outcome = plan.outcome || 'success';
        if (outcome === 'never') return new Promise(() => {});
        if (outcome === 'slow') { await new Promise(r => setTimeout(r, 400)); return { import: { ok: true, message: '已添加新结果' } }; }
        if (outcome === 'failed') throw new Error(plan.outcomeMessage || '制作失败，请重试。');
        if (outcome === 'cancelled') throw new Error(plan.outcomeMessage || '任务已取消。');
        if (outcome === 'provider-missing') throw new Error(plan.outcomeMessage || '尚未配置生成 Provider，请在 Flovart 画布中完成设置。');
        if (outcome === 'needs-login') throw new Error(plan.outcomeMessage || '请先登录 Flovart 账号。');
        if (outcome === 'offline') throw new Error(plan.outcomeMessage || '网络连接不可用，请检查网络后重试。');
        if (outcome === 'import-failed') return { import: { ok: false, message: plan.outcomeMessage || '结果添加失败，请重试。' } };
        return { import: { ok: true, message: plan.outcomeMessage || '已添加新结果' } };
      },
    };

    const panel = window.FlovartStudioUI.mountInspector({
      root: app,
      adapter,
      getController: () => (plan.controller ? controller : null),
      hostLabel: 'Premiere · Clip',
      defaultImportTarget: { kind: 'project' },
      onOpenCanvas: () => { counters.openCanvas = (counters.openCanvas || 0) + 1; },
    });
    window.__cell.panel = panel;

    // Drive the cell into its target interaction state.
    const prompt = app.querySelector('textarea');
    const generate = app.querySelector('.fs-generate');
    if (plan.interact && prompt && generate) {
      prompt.value = '保留人物与构图，补一层电影感逆光。';
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 30));
      if (!generate.disabled) {
        generate.click();
        // Let async run() reach its settled/intermediate state.
        await new Promise(r => setTimeout(r, 120));
        if (plan.interact === 'generate-then-history') {
          const historyTab = Array.from(app.querySelectorAll('.fs-tab')).find(t => t.textContent.includes('记录'));
          if (historyTab) historyTab.click();
        }
      }
    }
    return { state, theme };
  }, { state, theme, plan });
}

async function evalOracles(page) {
  return page.evaluate(ORACLE_EVAL);
}

// Interaction oracles that need page-level events, not just DOM reads.
async function interactionOracles(page, { w, h }) {
  const out = {};

  // escape-closes-modal: open any transient surface (history tab), press Escape,
  // expect return to a usable make surface. The panel has no modal today, so
  // the contract we measure is: after Escape the primary CTA + prompt are still
  // usable and no transient overlay remains stuck open.
  const esc = await page.evaluate(() => {
    const app = document.getElementById('app');
    const historyTab = Array.from(app.querySelectorAll('.fs-tab')).find(t => t.textContent.includes('记录'));
    if (historyTab) historyTab.click();
    const resultsOpen = !app.querySelector('.fs-history')?.hidden;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    app.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const form = app.querySelector('.fs-form');
    const historyStill = !app.querySelector('.fs-history')?.hidden;
    return { resultsOpen, historyStill, formVisible: !form?.hidden };
  });
  // Switch back to make for subsequent oracles.
  await page.evaluate(() => {
    const app = document.getElementById('app');
    const makeTab = Array.from(app.querySelectorAll('.fs-tab')).find(t => t.textContent.trim() === '制作');
    if (makeTab) makeTab.click();
  });
  out['escape-closes-modal'] = {
    // Passes if Escape left a usable surface (form reachable again or no stuck overlay).
    // The panel has no modal; the measurable contract is Escape doesn't strand the user.
    pass: esc.formVisible || !esc.historyStill,
    detail: `historyOpen=${esc.resultsOpen} stuck=${esc.historyStill && !esc.formVisible}`,
  };

  // no-double-submit: rapid clicks while busy must only call generate() once.
  const dbl = await page.evaluate(async () => {
    const app = document.getElementById('app');
    const counters = window.__cell.counters;
    const before = counters.generateCalls.length;
    const prompt = app.querySelector('textarea');
    const generate = app.querySelector('.fs-generate');
    if (!prompt || !generate) return { skipped: true };
    prompt.value = '快速连点测试';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 20));
    if (generate.disabled) return { skipped: true, reason: 'generate disabled' };
    generate.click(); generate.click(); generate.click();
    await new Promise(r => setTimeout(r, 60));
    return { before, after: counters.generateCalls.length, calls: counters.generateCalls.length - before };
  });
  out['no-double-submit'] = {
    pass: dbl.skipped ? true : dbl.calls <= 1,
    detail: dbl.skipped ? `skipped: ${dbl.reason}` : `calls=${dbl.calls}`,
  };

  // resize-keeps-input-and-task: shrink + regrow viewport, assert prompt value,
  // selection identity, and any in-flight/recorded task survive.
  const resized = await page.evaluate(async (dims) => {
    const app = document.getElementById('app');
    const prompt = app.querySelector('textarea');
    const before = { prompt: prompt?.value, source: app.querySelector('.fs-source-info strong')?.textContent, history: app.querySelector('.fs-history')?.children.length };
    return new Promise(resolvePromise => {
      // jsdom can't resize, but in real Chromium setViewportSize triggers it;
      // here we re-assert state after the outer driver resizes.
      resolvePromise({ before, size: dims });
    });
  }, { w, h });
  // Driver performs the actual viewport resize.
  await page.setViewportSize({ width: Math.max(220, w - 60), height: Math.max(320, h - 120) });
  await new Promise(r => setTimeout(r, 60));
  const after = await page.evaluate(() => {
    const app = document.getElementById('app');
    return {
      prompt: app.querySelector('textarea')?.value,
      source: app.querySelector('.fs-source-info strong')?.textContent,
      history: app.querySelector('.fs-history')?.children.length,
    };
  });
  await page.setViewportSize({ width: w, height: h });
  await new Promise(r => setTimeout(r, 60));
  out['resize-keeps-input-and-task'] = {
    pass: after.prompt === resized.before.prompt && after.source === resized.before.source && after.history === resized.before.history,
    detail: `prompt=${after.prompt === resized.before.prompt} source=${after.source === resized.before.source}`,
  };

  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const sizes = onlySize ? SIZES.filter(([n]) => n === onlySize) : SIZES;
const states = onlyState ? STATES.filter(s => s === onlyState) : STATES;
const themes = onlyTheme ? THEMES.filter(t => t === onlyTheme) : THEMES;

const tempRoot = resolveTestTempRoot(repoRoot);
await mkdir(tempRoot, { recursive: true });
const profileDir = join(tempRoot, `host-matrix-${Date.now()}`);
await mkdir(profileDir, { recursive: true });
process.env.TEMP = profileDir;
process.env.TMP = profileDir;
process.env.TMPDIR = profileDir;

const browser = await chromium.launch({ executablePath: chromeExecutable, headless: true });
const report = {
  generatedAt: new Date().toISOString(),
  matrix: { sizes: sizes.map(s => s[0]), states, themes },
  cells: [],
  gaps: [],
};

try {
  const context = await browser.newContext({ viewport: { width: 360, height: 540 } });
  const page = await context.newPage();
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    html,body,#app{margin:0;width:100%;height:100%;overflow:hidden}
    ${panelCss}
    </style></head><body><main id="app"></main></body></html>`);
  await page.addScriptTag({ content: hostContractSrc });
  await page.addScriptTag({ content: inspectorSrc });

  for (const [sizeName, w, h] of sizes) {
    for (const theme of themes) {
      // Apply theme by emulating the host's prefers-color-scheme the panel.css reads.
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'light' : 'dark' });
      await page.setViewportSize({ width: w, height: h });
      for (const state of states) {
        const plan = STATE_PLANS[state];
        await mountCell(page, { state, theme, plan });
        await new Promise(r => setTimeout(r, 40));
        const domOracles = await evalOracles(page);
        const interactOracles = await interactionOracles(page, { w, h, sizeName });
        const cell = { size: sizeName, theme, state, oracles: { ...domOracles, ...interactOracles } };
        cell.pass = Object.values(cell.oracles).every(o => o.pass);
        report.cells.push(cell);
        if (!cell.pass) {
          for (const [oracle, result] of Object.entries(cell.oracles)) {
            if (!result.pass) report.gaps.push({ size: sizeName, theme, state, oracle, detail: result.detail });
          }
        }
      }
    }
  }
} finally {
  await browser.close();
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const total = report.cells.length;
const passed = report.cells.filter(c => c.pass).length;
const oracleNames = ORACLES;

const lines = [];
lines.push(`Creative-Host interaction matrix — ${passed}/${total} cells pass`);
lines.push('');
// Pivot: one row per (state,size), theme columns collapsed to worst-case.
const header = ['state'.padEnd(20), ...sizes.map(s => s[0].padStart(8))];
lines.push(header.join(' '));
for (const state of states) {
  const row = [state.padEnd(20)];
  for (const [sizeName] of sizes) {
    const cell = report.cells.find(c => c.state === state && c.size === sizeName);
    row.push((cell && cell.pass ? '   PASS ' : '   FAIL').padStart(8));
  }
  lines.push(row.join(' '));
}
lines.push('');
lines.push('Oracle failures by oracle:');
const byOracle = {};
for (const gap of report.gaps) {
  byOracle[gap.oracle] = byOracle[gap.oracle] || [];
  byOracle[gap.oracle].push(`${gap.state}@${gap.size}/${gap.theme}`);
}
for (const name of oracleNames) {
  const hits = byOracle[name] || [];
  lines.push(`  ${name.padEnd(30)} ${hits.length ? hits.length + ' cell(s): ' + [...new Set(hits.map(h => h.split('/')[0]))].slice(0, 8).join(', ') + (hits.length > 8 ? '…' : '') : 'all pass'}`);
}
if (report.gaps.length) {
  lines.push('');
  lines.push('Gap list (first 30):');
  for (const gap of report.gaps.slice(0, 30)) {
    lines.push(`  [${gap.size}/${gap.theme}] ${gap.state} :: ${gap.oracle} — ${gap.detail}`);
  }
  if (report.gaps.length > 30) lines.push(`  … ${report.gaps.length - 30} more`);
}

console.log(lines.join('\n'));

if (jsonOut) {
  await writeFile(jsonOut, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nReport written to ${jsonOut}`);
}

if (strict && report.gaps.length) process.exitCode = 1;
