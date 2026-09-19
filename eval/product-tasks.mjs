#!/usr/bin/env node
// Phase-16 product-design task eval — 10 first-time-user tasks scored against
// the REAL shared Studio inspector panel (integrations/studio/shared/
// inspector.js + panel.css + host-contract.js) mounted headlessly in Chromium.
// This is the same mounting approach as eval/host-matrix.mjs; the panel code
// under test is the shipping code the UXP/CEP packages and preview use.
//
// Per task we record:
//   success      — did the user-visible goal resolve (result added / clear recovery offered)
//   clicks       — simulated user clicks (prompt typing is counted separately)
//   decisions    — visible choice points a first-time user must resolve
//                  (primary generate decision + any extra select/toggle choices)
//   manualTextSteps — fields the user must type into
//   deadEnds     — observable states with no recovery action offered
//   jargon       — technical connection/infra terms surfaced in visible copy
//   oracle       — pass/fail on the product target: <=1 primary decision,
//                  <=1 main CTA, no technical connection jargon
//
// Usage:
//   node eval/product-tasks.mjs                  # report to stdout
//   node eval/product-tasks.mjs --json .tmp/product-tasks.json
//
// Exit code is always 0 — this harness measures product gaps, it does not gate.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { resolveTestTempRoot } from '../scripts/test-temp-root.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const sharedDir = join(repoRoot, 'integrations', 'studio', 'shared');

const chromeExecutable = process.env.FLOVART_CHROME_PATH || chromium.executablePath();
if (!existsSync(chromeExecutable)) {
  throw new Error(`Chrome for Testing executable was not found: ${chromeExecutable}`);
}

const [hostContractSrc, inspectorSrc, panelCss] = await Promise.all([
  readFile(join(sharedDir, 'host-contract.js'), 'utf8'),
  readFile(join(sharedDir, 'inspector.js'), 'utf8'),
  readFile(join(sharedDir, 'panel.css'), 'utf8'),
]);

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const jsonOut = flag('json', join('.tmp', 'product-tasks.json'));
const onlyTask = flag('task');

// Technical connection/infra jargon a first-time user should never need to
// decode. Host names (Photoshop/Premiere) and "Flovart 已连接/等待 Flovart"
// (a plain status, not an instruction) are allowed; jargon means terms like
// provider wiring, bridges, links, adapters, host APIs, UXP/CEP, endpoints.
const JARGON_PATTERNS = [
  { re: /Provider|provider/, term: 'Provider' },
  { re: /Link|link/, term: 'Link' },
  { re: /bridge|Bridge/, term: 'bridge' },
  { re: /适配器/, term: '适配器 (adapter)' },
  { re: /宿主\s*(API|API不可用|错误)/, term: '宿主API' },
  { re: /UXP|CEP/i, term: 'UXP/CEP' },
  { re: /endpoint|端点/i, term: 'endpoint' },
  { re: /API\s*[Kk]ey/, term: 'API Key' },
  { re: /token|令牌/i, term: 'token' },
  { re: /注入/, term: '注入' },
  { re: /物化/, term: '物化' },
  { re: /native messaging|Native Host/i, term: 'native host' },
];

// ---------------------------------------------------------------------------
// In-page helpers injected once; each task script runs inside the live panel.
// ---------------------------------------------------------------------------
const HELPERS = `
window.__u = {
  // --- DOM queries -------------------------------------------------------
  app() { return document.getElementById('app'); },
  panel() { return this.app().firstElementChild; },
  q(sel) { return this.app().querySelector(sel); },
  qa(sel) { return Array.from(this.app().querySelectorAll(sel)); },
  visible(el) {
    if (!el) return false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  },
  visibleText() {
    // Concatenated visible copy: what a first-time user actually reads.
    return this.qa('button, textarea, select, option, label, p, span, strong, small, div')
      .filter(el => this.visible(el) && el.children.length === 0)
      .map(el => (el.value !== undefined && el.tagName === 'TEXTAREA' ? el.placeholder : el.textContent))
      .join(' ');
  },
  enabledButtons() {
    return this.qa('button').filter(b => this.visible(b) && !b.disabled);
  },
  // --- simulated user actions (click counter lives on __cell) ------------
  click(el) {
    if (!el || !this.visible(el)) throw new Error('click target not visible: ' + (el && el.className));
    window.__cell.counters.clicks += 1;
    el.click();
  },
  type(text) {
    const p = this.q('textarea');
    p.value = text;
    p.dispatchEvent(new Event('input', { bubbles: true }));
    window.__cell.counters.textSteps += 1;
  },
  setSelect(sel, value) {
    const s = this.q(sel);
    s.value = value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  },
  generateBtn() { return this.q('.fs-generate'); },
  status() { return this.q('.fs-status'); },
  taskRow() { return this.q('.fs-task'); },
  taskVisible() { const t = this.taskRow(); return !!t && !t.hidden; },
  // --- observations -------------------------------------------------------
  // Count visible decision points: primary generate + optional selects +
  // import-target picker + tab choices that gate progress.
  decisionPoints() {
    const pts = [];
    if (this.visible(this.generateBtn())) pts.push('generate');
    this.qa('select').forEach(s => {
      if (this.visible(s) && s.options.length > 1) pts.push('select:' + (s.getAttribute('aria-label') || '?') + '(' + s.options.length + ')');
    });
    return pts;
  },
  recipeChips() { return this.qa('.fs-recipe').filter(b => this.visible(b)); },
  sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
};
`;

// ---------------------------------------------------------------------------
// Adapter factories — real host-contract adapters where injectable, else the
// same minimal contract the real adapters implement (host-matrix parity).
// ---------------------------------------------------------------------------
function makePlan(over = {}) {
  return {
    host: 'premiere',
    hostLabel: 'Premiere · Clip',
    contextAvailable: true,
    selection: 'clip',
    selectionLabel: '访谈主镜头 · A 机位.mov',
    selectionKind: 'video',
    controller: true,
    outcome: 'success',
    useRealAdapter: false,
    defaultImportTarget: { kind: 'project' },
    ...over,
  };
}

const ADAPTER_EVAL = `(plan) => {
  const counters = window.__cell.counters;
  let adapter;
  if (plan.useRealAdapter === 'photoshop') {
    // REAL shared host-contract adapter with an injected fake UXP module.
    let doc = { id: 42, name: '海报.psd', title: '海报.psd', activeLayers: [{ id: 7, name: '背景图层', bounds: { left: 0, top: 0, right: 1920, bottom: 1080 } }] };
    adapter = window.FlovartStudioHosts.createPhotoshopAdapter({
      photoshop: { app: { get activeDocument() { return doc; } } },
      exportLayer: async () => ({ kind: 'image', mimeType: 'image/png' }),
      importArtifact: async () => ({ ok: true, message: '已添加为新图层。' }),
    });
    adapter.subscribeContext = () => ({ dispose() {} }); // no polling in eval
  } else if (plan.useRealAdapter === 'premiere') {
    let proj = { guid: 'g-1', name: '客户访谈成片.prproj' };
    adapter = window.FlovartStudioHosts.createPremiereAdapter({
      premiere: {
        Project: { getActiveProject: async () => proj },
        ProjectUtils: { getSelection: async () => ({ getItems: async () => [{ getId: () => 'clip-1', name: '访谈主镜头 · A 机位.mov' }] }) },
      },
      materializeClip: async () => ({ kind: 'image', mimeType: 'image/png' }),
      importArtifact: async () => ({ ok: plan.importOk !== false, message: plan.importOk === false ? (plan.outcomeMessage || '导入失败') : '已导入 Premiere 项目素材箱。' }),
    });
    adapter.subscribeContext = () => ({ dispose() {} });
  } else {
    adapter = {
      id: plan.host,
      async getContext() {
        if (plan.contextError) throw new Error(plan.contextError);
        return {
          host: plan.host,
          available: plan.contextAvailable,
          ...(plan.contextAvailable ? { documentId: 'project-1', documentName: '客户访谈成片.prproj', title: '客户访谈成片.prproj' } : {}),
        };
      },
      async getSelection() {
        if (plan.selectionError) throw new Error(plan.selectionError);
        if (plan.selection === null) return null;
        // Dynamic selection: 'clip' | 'alt' | 'gone' — driven by counters.selection
        const cur = counters.selection || plan.selection;
        if (cur === 'gone' || cur === null) return null;
        const label = cur === 'alt' ? '备用镜头 · B 机位.mov' : (plan.selectionLabel || '访谈主镜头 · A 机位.mov');
        return {
          host: plan.host, selectionId: cur === 'alt' ? 'clip-2' : 'clip-1', label,
          kind: plan.selectionKind || 'video',
          locator: { projectId: 'project-1', projectItemId: cur === 'alt' ? 'clip-2' : 'clip-1' },
          mimeType: 'video/mp4', width: 1920, height: 1080,
        };
      },
      async materializeSelection(sel) {
        counters.materializedSelection = sel ? sel.selectionId : null;
        return { selection: sel, resource: { kind: 'image', mimeType: 'image/png' }, reference: { kind: 'image' } };
      },
      async importArtifact() {
        return { ok: true, message: plan.host === 'premiere' ? '已导入 Premiere 项目素材箱。' : '已添加为新图层。' };
      },
      subscribeContext(listener) {
        // Eval-controlled: tasks trigger re-read by calling panel.refresh().
        window.__cell.contextListener = listener;
        return { dispose() {} };
      },
    };
  }
  return adapter;
}`;

const CONTROLLER_EVAL = `(plan) => {
  const counters = window.__cell.counters;
  return {
    async generate(prompt, target, onProgress) {
      counters.generateCalls.push({ prompt, target, materializedSelection: counters.materializedSelection });
      const outcome = plan.outcome || 'success';
      if (outcome === 'never') {
        if (onProgress) onProgress(0.4);
        return new Promise(() => {});
      }
      if (outcome === 'slow') { await new Promise(r => setTimeout(r, 400)); return { import: { ok: true, message: '已添加新结果' } }; }
      if (outcome === 'failed') throw new Error(plan.outcomeMessage || '制作失败，请重试。');
      if (outcome === 'cancelled') throw new Error(plan.outcomeMessage || '任务已取消。');
      if (outcome === 'provider-missing') throw new Error(plan.outcomeMessage || '尚未配置生成用的 AI 服务，请在 Flovart 画布中完成设置。');
      if (outcome === 'needs-login') throw new Error(plan.outcomeMessage || '请先登录 Flovart 账号。');
      if (outcome === 'offline') throw new Error(plan.outcomeMessage || '网络连接不可用，请检查网络后重试。');
      if (outcome === 'import-failed') return { import: { ok: false, message: plan.outcomeMessage || '结果添加失败，请重试。' } };
      return { import: { ok: true, message: plan.outcomeMessage || (plan.host === 'premiere' ? '已导入 Premiere 项目素材箱。' : '已添加为新图层。') } };
    },
  };
}`;

// ---------------------------------------------------------------------------
// The 10 first-time-user tasks. Each gets a plan (adapter+controller script)
// and a user() function evaluated inside the page with `u` helpers.
// `expected` declares the product intent used for the success oracle.
// ---------------------------------------------------------------------------
const TASKS = [
  {
    name: 'ps-background-variant',
    title: 'PS: 从当前图层生成背景变体',
    host: 'photoshop',
    plan: makePlan({ host: 'photoshop', hostLabel: 'Photoshop · 图层', useRealAdapter: 'photoshop', selectionKind: 'image', defaultImportTarget: { kind: 'new-layer' } }),
    async user(u) {
      // First-time path: pick the '更换背景' recipe (1 click) → Generate (1 click).
      const recipe = u.recipeChips().find(b => b.textContent.includes('更换背景'));
      if (recipe) u.click(recipe);
      else u.type('保留主体，把背景换成雾气自然风景');
      await u.sleep(30);
      const gen = u.generateBtn();
      if (gen.disabled) return { success: false, note: 'generate disabled' };
      u.click(gen);
      await u.sleep(150);
      const status = u.status().textContent;
      return { success: /已添加|已导入|完成/.test(status), note: status };
    },
  },
  {
    name: 'premiere-video-from-clip',
    title: 'Premiere: 片段首帧生成视频并导入项目',
    host: 'premiere',
    plan: makePlan({ useRealAdapter: 'premiere' }),
    async user(u) {
      u.type('把首帧延展成 4 秒推近镜头，保持人物位置');
      await u.sleep(30);
      const gen = u.generateBtn();
      if (gen.disabled) return { success: false, note: 'generate disabled (可能是模型/输出位置门槛)' };
      u.click(gen);
      await u.sleep(150);
      const status = u.status().textContent;
      return { success: /已导入|已添加/.test(status), note: status };
    },
  },
  {
    name: 'unsure-flovart-online',
    title: '不确定 Flovart 是否在线',
    host: 'premiere',
    plan: makePlan({ controller: false }), // link down
    async user(u) {
      // User scans for connection state; footer + status must answer in
      // plain language and point at a next step (canvas button).
      const text = u.visibleText();
      const footer = u.q('.fs-footer') ? u.q('.fs-footer').textContent : '';
      const status = u.status().textContent;
      const gen = u.generateBtn();
      const canvasBtn = u.q('.fs-header .fs-icon-button');
      // The only recovery affordance is the header canvas/open-Flovart button.
      let recovered = false;
      if (canvasBtn && u.visible(canvasBtn)) {
        u.click(canvasBtn);
        await u.sleep(30);
        recovered = window.__cell.counters.openCanvas === 1;
      }
      return {
        success: /等待 Flovart|连接 Flovart/.test(text) && recovered,
        note: `footer="${footer.trim()}" status="${status}" openCanvas=${window.__cell.counters.openCanvas || 0} generateDisabled=${gen.disabled}`,
      };
    },
  },
  {
    name: 'provider-unconfigured',
    title: '未配置生成 AI 服务',
    host: 'premiere',
    plan: makePlan({ outcome: 'provider-missing' }),
    async user(u) {
      u.type('给画面加一层夜景氛围');
      await u.sleep(30);
      const gen = u.generateBtn();
      if (gen.disabled) return { success: false, note: 'generate disabled —— 用户连错误都看不到' };
      u.click(gen);
      await u.sleep(150);
      const status = u.status().textContent;
      // Recovery requires a visible next action. Panel shows text only;
      // the header canvas button is the only route to Flovart settings.
      const canvasBtn = u.q('.fs-header .fs-icon-button');
      const hasRecoveryAction = u.visible(canvasBtn);
      if (hasRecoveryAction) u.click(canvasBtn);
      await u.sleep(30);
      const text = u.visibleText();
      const jargonHit = /Provider/.test(status);
      return {
        success: status.length > 0 && window.__cell.counters.openCanvas === 1,
        jargon: jargonHit ? ['Provider'] : [],
        note: `status="${status}" canvasRoute=${window.__cell.counters.openCanvas === 1}`,
      };
    },
  },
  {
    name: 'selection-switched-mid-run',
    title: '生成中途切换宿主选择',
    host: 'premiere',
    plan: makePlan({ outcome: 'never' }),
    async user(u) {
      u.type('把这个镜头做成逆光剪影');
      await u.sleep(30);
      const refBefore = u.q('.fs-source strong') ? u.q('.fs-source strong').textContent : '';
      const gen = u.generateBtn();
      u.click(gen); // submit
      await u.sleep(80);
      const inFlight = u.taskVisible();
      // Host selection changes while the task runs.
      window.__cell.counters.selection = 'alt';
      await window.__cell.panel.refresh(); // host pushes new selection
      await u.sleep(40);
      const newRef = u.q('.fs-source strong') ? u.q('.fs-source strong').textContent : '';
      const taskStillVisible = u.taskVisible();
      const genBlocked = u.generateBtn().disabled; // busy guard holds
      const statusText = u.status().textContent;
      // Product finding: the panel silently swaps the reference card to the
      // new selection while a task bound to the old one still runs — no copy
      // tells the user which input the running task is using.
      const ambiguity = newRef !== refBefore && !/原|先前|继续|仍在|进行中/.test(statusText);
      return {
        success: inFlight && taskStillVisible && genBlocked,
        finding: ambiguity ? '参考卡片中途切换到新选择，但运行中任务无任何说明绑定的仍是旧选择 —— 用户对任务输入产生歧义' : null,
        note: `inFlight=${inFlight} taskVisible=${taskStillVisible} 提交时引用="${refBefore}" 现选择="${newRef}" generateDisabled=${genBlocked} status="${statusText}"`,
      };
    },
  },
  {
    name: 'resize-to-280px',
    title: '面板缩到 280px 宽',
    host: 'premiere',
    plan: makePlan(),
    viewport: { width: 280, height: 420 },
    async user(u) {
      const w = innerWidth;
      const prompt = u.q('textarea');
      const gen = u.generateBtn();
      const overflow = document.documentElement.scrollWidth > w + 1 || document.body.scrollWidth > w + 1;
      const promptOk = u.visible(prompt) && prompt.getBoundingClientRect().height >= 40;
      const genVisible = u.visible(gen) && gen.getBoundingClientRect().right <= w + 1;
      // Can the user still complete the flow at 280px?
      u.type('压缩尺寸后继续生成');
      await u.sleep(30);
      let finished = false;
      if (!u.generateBtn().disabled) { u.click(u.generateBtn()); await u.sleep(150); finished = /已/.test(u.status().textContent); }
      return { success: !overflow && promptOk && genVisible && finished, note: `w=${w} overflow=${overflow} promptH=${Math.round(prompt.getBoundingClientRect().height)} genInBounds=${genVisible} done=${finished}` };
    },
  },
  {
    name: 'open-full-canvas',
    title: '打开完整画布',
    host: 'premiere',
    plan: makePlan(),
    async user(u) {
      const btn = u.q('.fs-header .fs-icon-button');
      if (!btn || !u.visible(btn)) return { success: false, note: '画布入口不可见' };
      const label = btn.getAttribute('aria-label') || btn.title || '';
      u.click(btn);
      await u.sleep(30);
      const opened = window.__cell.counters.openCanvas === 1;
      return { success: opened, note: `label="${label}" opened=${opened}` };
    },
  },
  {
    name: 'import-fails',
    title: '生成成功但导入宿主失败',
    host: 'premiere',
    plan: makePlan({ outcome: 'import-failed' }),
    async user(u) {
      u.type('生成一个片尾定格帧');
      await u.sleep(30);
      const gen = u.generateBtn();
      u.click(gen);
      await u.sleep(150);
      const status = u.status().textContent;
      // Recovery: can the user retry? Generate must be re-enabled and the
      // prompt must still be there (input preserved → 1-click retry).
      const promptKept = u.q('textarea').value.length > 0;
      const retryEnabled = !u.generateBtn().disabled && promptKept;
      let retried = false;
      if (retryEnabled) { u.click(u.generateBtn()); await u.sleep(150); retried = true; }
      const calls = window.__cell.counters.generateCalls.length;
      return {
        success: status.length > 0 && retried && calls === 2,
        note: `status="${status}" promptKept=${promptKept} retryEnabled=${retryEnabled} calls=${calls}`,
      };
    },
  },
  {
    name: 'double-click-generate',
    title: '双击/连点生成按钮',
    host: 'premiere',
    plan: makePlan({ outcome: 'slow' }),
    async user(u) {
      u.type('快速连点测试');
      await u.sleep(30);
      const gen = u.generateBtn();
      if (gen.disabled) return { success: false, note: 'generate disabled' };
      gen.click(); gen.click(); gen.click(); // 双击 → 3 次 DOM click
      window.__cell.counters.clicks += 1; // one user gesture (double-click = 1 action)
      await u.sleep(600);
      const calls = window.__cell.counters.generateCalls.length;
      const status = u.status().textContent;
      return { success: calls === 1 && /已添加|已导入/.test(status), note: `generateCalls=${calls} status="${status}"` };
    },
  },
  {
    name: 'first-install-next-step',
    title: '首次安装后的下一步引导',
    host: 'premiere',
    // Cold open: host reachable, no selection yet, controller not linked.
    plan: makePlan({ selection: null, controller: false }),
    async user(u) {
      const text = u.visibleText();
      const gen = u.generateBtn();
      const status = u.status().textContent;
      const canvasBtn = u.q('.fs-header .fs-icon-button');
      // What does the panel tell a brand-new user to do?
      const guidance = /等待 Flovart|连接 Flovart|选择|素材/.test(text);
      const ctaCount = u.enabledButtons().length;
      // The single offered route out is the canvas button → click it.
      let routed = false;
      if (canvasBtn && u.visible(canvasBtn)) { u.click(canvasBtn); await u.sleep(30); routed = window.__cell.counters.openCanvas === 1; }
      // Does clicking canvas communicate anything when no link? (status text)
      const afterStatus = u.status().textContent;
      return {
        success: guidance && routed,
        note: `status="${status}"→"${afterStatus}" generateDisabled=${gen.disabled} enabledButtons=${ctaCount} openCanvas=${window.__cell.counters.openCanvas || 0}`,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------
async function mount(page, plan) {
  await page.evaluate(async ({ plan, adapterSrc, controllerSrc, helpersSrc }) => {
    const app = document.getElementById('app');
    app.replaceChildren();
    window.__cell = { counters: { clicks: 0, textSteps: 0, generateCalls: [], openCanvas: 0, selection: null }, errors: [] };
    eval(helpersSrc);
    const adapter = eval(adapterSrc)(plan);
    const controller = eval(controllerSrc)(plan);
    window.__cell.panel = window.FlovartStudioUI.mountInspector({
      root: app,
      adapter,
      getController: () => (plan.controller ? controller : null),
      hostLabel: plan.hostLabel,
      defaultImportTarget: plan.defaultImportTarget,
      onOpenCanvas: () => { window.__cell.counters.openCanvas += 1; },
    });
    await new Promise(r => setTimeout(r, 60)); // let initial refresh() settle
  }, { plan, adapterSrc: ADAPTER_EVAL, controllerSrc: CONTROLLER_EVAL, helpersSrc: HELPERS });
}

const tempRoot = resolveTestTempRoot(repoRoot);
await mkdir(tempRoot, { recursive: true });
const profileDir = join(tempRoot, `product-tasks-${Date.now()}`);
await mkdir(profileDir, { recursive: true });
process.env.TEMP = profileDir; process.env.TMP = profileDir; process.env.TMPDIR = profileDir;

const browser = await chromium.launch({ executablePath: chromeExecutable, headless: true });
const report = { generatedAt: new Date().toISOString(), tasks: [], summary: {} };

const tasks = onlyTask ? TASKS.filter(t => t.name === onlyTask) : TASKS;

try {
  for (const task of tasks) {
    const viewport = task.viewport || { width: 360, height: 540 };
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    try {
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
        html,body,#app{margin:0;width:100%;height:100%;overflow:hidden}
        ${panelCss}
        </style></head><body><main id="app"></main></body></html>`);
      await page.addScriptTag({ content: hostContractSrc });
      await page.addScriptTag({ content: inspectorSrc });
      await page.emulateMedia({ colorScheme: 'dark' });
      await mount(page, task.plan);

      // Run the scripted user inside the page. task.user is defined as
      // `async user(u)` — a method — so its toString() starts with "user("
      // or "async user("; normalize to a function expression before eval.
      const fnSrc = task.user.toString().replace(/^async\s+user/, 'async function').replace(/^user/, 'function');
      const result = await page.evaluate(async (src) => {
        const u = window.__u;
        try { return await eval(`(${src})`)(u); }
        catch (error) { return { success: false, note: 'user script threw: ' + error.message }; }
      }, fnSrc);

      // Independent observation pass — jargon scan + decision/CTA census.
      const observed = await page.evaluate((jargonSrc) => {
        const u = window.__u;
        const text = u.visibleText();
        const patterns = eval(jargonSrc);
        const jargon = patterns.filter(p => p.re.test(text)).map(p => p.term);
        const decisions = u.decisionPoints();
        const enabled = u.enabledButtons().map(b => (b.textContent || b.getAttribute('aria-label') || '').trim()).filter(Boolean);
        const deadEnds = [];
        const gen = u.generateBtn();
        const status = u.status() ? u.status().textContent : '';
        // Dead-end oracle: generate disabled AND status gives no reason/next step.
        if (gen && gen.disabled && !status) deadEnds.push('generate-disabled-no-explanation');
        // Error shown but no actionable route (button/link) to resolve it.
        if (/失败|不可用|无法|尚未|请先/.test(status) && u.enabledButtons().filter(b => !b.closest('.fs-tabs') && !b.classList.contains('fs-recipe') && !b.classList.contains('fs-icon-button')).length === 0)
          deadEnds.push('error-text-only-recovery');
        return {
          textSample: text.slice(0, 600),
          jargon, decisions, enabledButtons: enabled, deadEnds,
          clicks: window.__cell.counters.clicks,
          textSteps: window.__cell.counters.textSteps,
          generateCalls: window.__cell.counters.generateCalls.length,
        };
      }, `(${JSON.stringify(JARGON_PATTERNS.map(p => ({ re: p.re.source, term: p.term })))}).map(p => ({ re: new RegExp(p.re), term: p.term }))`);

      const jargonAll = [...new Set([...(observed.jargon || []), ...(result.jargon || [])])];
      const decisionCount = observed.decisions.length;
      const oracle = {
        pass: decisionCount <= 1 && jargonAll.length === 0,
        decisionRule: decisionCount <= 1,
        jargonRule: jargonAll.length === 0,
      };
      report.tasks.push({
        name: task.name,
        title: task.title,
        host: task.host,
        success: !!result.success,
        finding: result.finding || null,
        note: result.note || '',
        clicks: observed.clicks,
        textSteps: observed.textSteps,
        decisions: observed.decisions,
        decisionCount,
        enabledButtons: observed.enabledButtons,
        jargon: jargonAll,
        deadEnds: observed.deadEnds,
        oracle,
      });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const passed = report.tasks.filter(t => t.oracle.pass).length;
const succeeded = report.tasks.filter(t => t.success).length;
report.summary = {
  total: report.tasks.length,
  taskSuccess: succeeded,
  oraclePass: passed,
  oracleFail: report.tasks.length - passed,
  failing: report.tasks.filter(t => !t.oracle.pass).map(t => ({ name: t.name, decisionCount: t.decisionCount, decisions: t.decisions, jargon: t.jargon })),
  unsuccessful: report.tasks.filter(t => !t.success).map(t => ({ name: t.name, note: t.note })),
  findings: report.tasks.filter(t => t.finding).map(t => ({ name: t.name, finding: t.finding })),
};

// ---------------------------------------------------------------------------
// Console report
// ---------------------------------------------------------------------------
const lines = [];
lines.push(`Phase-16 product task eval — ${succeeded}/${report.tasks.length} tasks succeed, ${passed}/${report.tasks.length} pass <=1-decision/no-jargon oracle`);
lines.push('');
for (const t of report.tasks) {
  lines.push(`${t.oracle.pass ? 'PASS' : 'FAIL'} ${t.success ? '✓' : '✗'} ${t.name.padEnd(28)} clicks=${t.clicks} text=${t.textSteps} decisions=${t.decisionCount} jargon=[${t.jargon.join(',')}] deadEnds=[${t.deadEnds.join(',')}]`);
  lines.push(`     ${t.note}`);
  if (t.finding) lines.push(`     FINDING: ${t.finding}`);
  if (t.decisions.length) lines.push(`     decision points: ${t.decisions.join(' | ')}`);
}
console.log(lines.join('\n'));

if (jsonOut) {
  const out = join(repoRoot, jsonOut);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(`\nReport written: ${out}`);
}
