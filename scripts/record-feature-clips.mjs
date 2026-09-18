// Feature-clip recording driver for the Flovart README.
//
// One invocation records one REAL, UI-driven operation inside a VISIBLE,
// video-recorded Chrome-for-Testing window. Three scenario kinds share the same
// bootstrap, project seeding and encoding path:
//
//   node-tool  seed one media node, then click through the node toolbar and its
//              tool dialog exactly as a user would
//   canvas     drive the canvas itself (add / connect / drag / group / align /
//              tidy / prompt), using only real toolbar buttons, handles and
//              keyboard shortcuts
//   agent      show the external-agent link: typed CLI operations landing on
//              the live canvas, and the Agent surface
//
// Nothing here fabricates frames. A clip is the recording of a real commit; the
// only injected material is the locally generated fixture media
// (see ensureFixtures) and, for agent clips, CLI operations recorded as they run.
//
// Usage:
//   node scripts/record-feature-clips.mjs --clip rotate
//   node scripts/record-feature-clips.mjs --clip all
//   node scripts/record-feature-clips.mjs --clip reftab=crop,rotate --keep-raw
//   node scripts/record-feature-clips.mjs --list
//
// Prerequisites: the local Flovart Agent + Web are already running — the same
// services scripts/record-hero.mjs uses. ffmpeg is required for MP4/GIF output;
// set FLOVART_FFMPEG to override the auto-detected binary.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, copyFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  buildBrowserBootstrapUrl,
  issueBrowserBootstrapToken,
  probeWebUi,
} from '../tools/flovart/local-agent.js';
import { resolveTestTempRoot } from './test-temp-root.mjs';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// README embeds resolve against the repo tree, and artifacts/ is gitignored —
// so finished clips belong next to the other README assets under pic/readme/.
const outDir = join(projectDir, 'pic', 'readme', 'features');
const rawDir = join(projectDir, 'artifacts', 'features', 'raw');
const tmpDir = join(projectDir, '.tmp');
const fixtureDir = join(tmpDir, 'demo-fixtures');
for (const dir of [outDir, rawDir, tmpDir, fixtureDir]) mkdirSync(dir, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const FLAGS = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
const argOf = name => {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
};

// ---------------------------------------------------------------------------
// 1. Clip catalog.
//
// node-tool entries: toolbarLabel must equal the aria-label WorkflowNodeToolbar
// renders, dialogTitle the antd Modal title, action the real confirm click.
// canvas/agent entries carry a `run` that only uses user-reachable controls.
// ---------------------------------------------------------------------------
const TOOL = (media, toolbarLabel, dialogTitle, action, extra = {}) =>
  ({ kind: 'node-tool', media, toolbarLabel, dialogTitle, action, ...extra });

// Canvas controls carry aria-labels, but accessible-name matching is
// substring-based by default — and the project-title button is named after the
// project ("添加节点 Demo…"), which collides with the toolbar's "添加节点".
// Scope to the owning toolbar and require an exact name.
const tbBtn = (page, name) => page.locator('.workflow-toolbar').getByRole('button', { name, exact: true });
const ccBtn = (page, name) => page.locator('.workflow-canvas-controls').getByRole('button', { name, exact: true });

// Marquee-select every node the way a user does: drag a selection box across
// empty canvas. Shift+click multi-select is unreliable here because the node
// toolbar floats over the neighbouring node's click target.
async function selectAllNodes(page, wait) {
  const boxes = await page.evaluate(() => [...document.querySelectorAll('[data-workflow-node-id]')]
    .map(el => el.getBoundingClientRect())
    .map(r => ({ x: r.x, y: r.y, w: r.width, h: r.height })));
  if (!boxes.length) return;
  const minX = Math.min(...boxes.map(b => b.x));
  const minY = Math.min(...boxes.map(b => b.y));
  const maxX = Math.max(...boxes.map(b => b.x + b.w));
  const maxY = Math.max(...boxes.map(b => b.y + b.h));
  const sx = Math.max(8, minX - 40);
  const sy = Math.max(60, minY - 40);
  const ex = Math.min(1430, maxX + 40);
  const ey = Math.min(800, maxY + 40);
  await page.mouse.move(sx, sy);
  await wait(250);
  await page.mouse.down();
  await page.mouse.move(sx + 60, sy + 40, { steps: 10 });
  await page.mouse.move(ex, ey, { steps: 24 });
  await wait(450);
  await page.mouse.up();
  await wait(600);
}

// Clear the selection by clicking bare canvas well away from any node, so the
// PromptBar folds away. Escape alone only dismisses open menus.
async function deselect(page, wait) {
  await page.keyboard.press('Escape').catch(() => {});
  for (let i = 0; i < 6; i += 1) {
    const x = 300 + i * 90;
    const y = 170 + i * 40;
    const hitsNode = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return Boolean(el && el.closest('[data-workflow-node-id]'));
    }, [x, y]);
    if (!hitsNode) { await page.mouse.click(x, y); break; }
  }
  await wait(600);
}

const CATALOG = {
  // ---------------- image node tools ----------------
  crop: { title: '裁剪图片', ...TOOL('image', '裁剪图片', '裁剪图片', async page => {
    await page.getByRole('button', { name: '应用裁剪' }).click();
  }) },
  rotate: { title: '旋转镜像', ...TOOL('image', '旋转镜像', '旋转镜像', async page => {
    await page.getByRole('button', { name: /顺时针 90/ }).click();
  }) },
  'split-grid': { title: '宫格切分', ...TOOL('image', '宫格切分', '宫格切分', async page => {
    // antd Segmented renders each option as a label + radio, not a button.
    const dialog = page.getByRole('dialog');
    await dialog.getByText('2 行', { exact: true }).click();
    await page.waitForTimeout(250);
    await dialog.getByText('2 列', { exact: true }).click();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: /^切分为 4 张/ }).click();
  }) },
  filter: { title: '图片调色', ...TOOL('image', '图片滤镜', '图片调色', async page => {
    await page.getByRole('button', { name: '完成调色' }).click();
  }) },
  upscale: { title: '高清放大', ...TOOL('image', '高清放大', '高清放大', async page => {
    const dialog = page.getByRole('dialog');
    await dialog.getByText('2K', { exact: true }).click();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: '开始放大' }).click();
  }), provider: true },
  'remove-background': { title: '移除背景', ...TOOL('image', '移除背景', '移除背景', async page => {
    await page.getByRole('button', { name: /移除背景|开始/ }).first().click();
  }), provider: true },
  'split-layers': { title: '拆分图层', ...TOOL('image', '拆分图层', '拆分图层', async page => {
    await page.getByRole('button', { name: '拆分图层' }).click();
  }), provider: true },
  outpaint: { title: '扩展画面', ...TOOL('image', '扩展画面', '扩展画面', async page => {
    await page.getByRole('button', { name: '开始扩展' }).click();
  }), provider: true },

  // ---------------- video node tools ----------------
  'video-trim': { title: '视频剪辑', ...TOOL('video', '视频剪辑', '视频剪辑', async page => {
    await page.getByRole('button', { name: '裁取片段' }).click();
  }) },
  'video-av-split': { title: '音视频分离', ...TOOL('video', '音视频分离', '音视频分离', async page => {
    await page.getByRole('button', { name: '分离音视频' }).click();
  }) },
  'extract-last-frame': {
    title: '导出尾帧', kind: 'node-tool', media: 'video',
    toolbarLabel: '导出尾帧为图片', dialogTitle: null, action: null,
  },
  'extract-first-frame': {
    title: '导出首帧', kind: 'node-tool', media: 'video',
    toolbarLabel: '导出首帧为图片', dialogTitle: null, action: null,
  },
  'extract-frame-at': { title: '提取指定帧', ...TOOL('video', '提取指定帧', '提取指定帧', async page => {
    await page.getByRole('button', { name: '提取此帧' }).click();
  }) },
  'video-merge': {
    title: '视频拼接', kind: 'node-tool', media: 'video', selectAllOfType: 'video',
    toolbarLabel: '视频拼接', dialogTitle: '视频拼接', action: async page => {
      await page.getByRole('button', { name: '拼接视频' }).click();
    },
  },

  // ---------------- audio node tools ----------------
  'audio-trim': { title: '音频截取', ...TOOL('audio', '音频截取', '音频截取', async page => {
    await page.getByRole('button', { name: '截取片段' }).click();
  }) },
  'audio-speed': { title: '音频变速', ...TOOL('audio', '音频变速', '音频变速', async page => {
    // The confirm button stays disabled at 1.00×, so nudge the slider first.
    const slider = page.getByRole('slider').first();
    await slider.focus();
    for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
    await page.getByRole('button', { name: '应用变速' }).click();
  }) },
  'audio-stem-split': { title: '人声伴奏分离', ...TOOL('audio', '人声/伴奏分离', '人声/伴奏分离', async page => {
    await page.getByRole('button', { name: '分离人声与伴奏' }).click();
  }) },

  // ---------------- canvas operations ----------------
  'canvas-add-node': {
    title: '添加节点', kind: 'canvas', seed: [],
    run: async ({ page, sleep: wait }) => {
      await tbBtn(page, '添加节点').click();
      await wait(700);
      await page.getByRole('menuitem', { name: '图片', exact: true }).click();
      await wait(1000);
      // Adding a node selects it, which raises the PromptBar over the bottom of
      // the canvas and would swallow the next menu click — deselect first.
      await deselect(page, wait);
      await tbBtn(page, '添加节点').click();
      await wait(700);
      await page.getByRole('menuitem', { name: '视频', exact: true }).click();
    },
  },
  'canvas-connect': {
    title: '连接节点', kind: 'canvas', seed: ['image', 'video'],
    run: async ({ page, sleep: wait }) => {
      const source = page.getByRole('button', { name: '从此节点连接' }).first();
      const target = page.getByRole('button', { name: '连接到此节点' }).nth(1);
      const a = await source.boundingBox();
      const b = await target.boundingBox();
      if (!a || !b) throw new Error('connection handles not found');
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await wait(300);
      await page.mouse.down();
      await page.mouse.move(a.x + 40, a.y + 20, { steps: 8 });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 24 });
      await wait(400);
      await page.mouse.up();
    },
  },
  'canvas-drag': {
    title: '拖动节点', kind: 'canvas', seed: ['image'],
    run: async ({ page, sleep: wait }) => {
      const node = page.locator('[data-workflow-node-id]').first();
      const box = await node.boundingBox();
      if (!box) throw new Error('no node box');
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 3;
      await page.mouse.move(cx, cy);
      await wait(300);
      await page.mouse.down();
      await page.mouse.move(cx + 190, cy + 130, { steps: 26 });
      await wait(300);
      await page.mouse.up();
    },
  },
  'canvas-group-align': {
    title: '打组与对齐', kind: 'canvas', seed: ['image', 'image', 'image'],
    run: async ({ page, sleep: wait }) => {
      await selectAllNodes(page, wait);
      const toolbar = page.locator('[data-testid="workflow-node-toolbar"]');
      await toolbar.getByRole('button', { name: '顶部对齐节点' }).click();
      await wait(900);
      await toolbar.getByRole('button', { name: /打组/ }).click();
      await wait(900);
    },
  },
  'canvas-tidy': {
    title: '一键整理画布', kind: 'canvas', seed: ['image', 'video', 'text'],
    run: async ({ page, sleep: wait }) => {
      await wait(600);
      await ccBtn(page, '一键整理节点').click();
    },
  },
  'canvas-prompt': {
    title: '编辑提示词', kind: 'canvas', seed: ['image'],
    run: async ({ page, sleep: wait }) => {
      const node = page.locator('[data-workflow-node-id]').first();
      const box = await node.boundingBox();
      if (!box) throw new Error('no node box');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
      await wait(900);
      const bar = page.locator('[data-testid="workflow-node-prompt-bar"]');
      await bar.waitFor({ state: 'visible', timeout: 15_000 });
      // The PromptBar also contains a hidden file input for reference media;
      // only the visible editor should receive the typing.
      const input = bar.locator('textarea:visible, [contenteditable="true"]:visible').first();
      await input.click();
      await wait(300);
      await input.type('黄昏时分的产品特写镜头，暖色侧逆光，浅景深，胶片颗粒感', { delay: 28 });
    },
  },
  'canvas-zoom': {
    title: '缩放与撤销', kind: 'canvas', seed: ['image', 'video'],
    run: async ({ page, sleep: wait }) => {
      await ccBtn(page, '重置缩放').click();
      await wait(700);
      await page.getByRole('menuitem', { name: '放大', exact: true }).click();
      await wait(1000);
      // The zoom menu stays open after picking an entry, so a second click on
      // the 重置缩放 trigger would only close it.
      await page.getByRole('menuitem', { name: '适应视图', exact: true }).click();
      await wait(1200);
      await tbBtn(page, '撤销').click();
      await wait(1100);
      await tbBtn(page, '重做').click();
    },
  },

  // ---------------- external-agent link ----------------
  'agent-open-panel': {
    title: '打开 Agent', kind: 'canvas', seed: ['image'],
    run: async ({ page, sleep: wait }) => {
      // Opening the Agent surface replaces the canvas toolbar, so there is no
      // matching "收起 Agent" control left to click — leave it open. The
      // accessible name is not exactly "打开 Agent", so match by prefix.
      await page.locator('.workflow-toolbar').getByRole('button', { name: /^打开 Agent/ }).click();
      await wait(3200);
    },
  },
  'agent-cli-live': {
    title: 'CLI 驱动画布', kind: 'agent', seed: [],
    run: async ({ page, cli, projectId, agentIdentity, runTag, sleep: wait }) => {
      // Every write re-checks the agent's Workflow lease. A fresh project can
      // leave the lease pointing elsewhere, so rebind with an inspect and retry
      // rather than losing the clip to LEASE_TARGET_CHANGED.
      const write = async (args) => {
        for (let attempt = 1; attempt <= 4; attempt += 1) {
          try { return await cli(args); } catch (error) {
            if (!/LEASE_TARGET_CHANGED|WORKSPACE_UNAVAILABLE/.test(error.message)) throw error;
            console.log(`[clip] rebinding lease (attempt ${attempt}): ${error.message.slice(0, 80)}`);
            await cli(['workflow.inspect', '--agent-identity', agentIdentity, '--project-id', projectId])
              .catch(() => null);
            await wait(1600);
          }
        }
        throw new Error(`write never settled: ${args[0]}`);
      };
      // Typed operations land on the canvas while we watch — the operation-level
      // view of the external-agent link.
      const mk = async (type, title, x, y, key) => {
        await write(['workflow.node.create', '--project-id', projectId, '--type', type,
          '--title', title, '--x', String(x), '--y', String(y),
          '--agent-identity', agentIdentity, '--idempotency-key', `clip-${runTag}-${key}`]);
        await wait(1300);
      };
      await mk('image', '首帧参考', 180, 150, 'a');
      await mk('image', '风格参考', 180, 470, 'b');
      await mk('video', '成片镜头', 660, 300, 'c');
      const inspected = await write(['workflow.inspect', '--agent-identity', agentIdentity,
        '--project-id', projectId]).catch(() => null);
      const nodes = inspected?.data?.result?.nodes || [];
      const find = t => nodes.find(n => n.title === t)?.id;
      const link = async (from, to, key) => {
        if (!from || !to) return;
        await write(['workflow.connect', '--project-id', projectId, '--from-node-id', from,
          '--to-node-id', to, '--agent-identity', agentIdentity,
          '--idempotency-key', `clip-${runTag}-${key}`]);
        await wait(1300);
      };
      await link(find('首帧参考'), find('成片镜头'), 'e1');
      await link(find('风格参考'), find('成片镜头'), 'e2');
      await wait(900);
      await ccBtn(page, '一键整理节点').click();
    },
  },
};

// Clips that run through the in-page ffmpeg.wasm core. They are recorded like
// any other clip now that the client can actually load a core — they just need
// the core pre-warmed before the recorded action (see the prewarm step below),
// because a cold start fetches and instantiates ~30MB of wasm and showing that
// download as the "operation" would misrepresent the feature.
//
// Historical note: these were unrecordable until 2026-09-18 because of three
// stacked defects in the ffmpeg load path — the core was loaded from the *umd*
// build (no default export, so the module-worker path always threw), the
// multi-thread branch asked @ffmpeg/core for a worker file only @ffmpeg/core-mt
// ships (404), and Vite's dependency pre-bundling broke
// `new Worker(new URL('./worker.js', import.meta.url))` so `ffmpeg.load()` never
// settled. See docs/maintenance/readme/DEMO_RECORDING.md.
const FFMPEG_TOOLS = new Set([
  'video-trim', 'video-av-split', 'extract-last-frame', 'extract-first-frame',
  'extract-frame-at', 'video-merge', 'audio-trim', 'audio-speed', 'audio-stem-split',
]);

// Deferred scenarios — left in the catalog for whoever picks them up, excluded
// from `all`:
//   canvas-group-align  multi-select never reached the toolbar (Shift+click and
//                       a marquee drag both left a single selection, so
//                       WorkflowNodeToolbar never rendered align/group)
//   canvas-zoom         never captured: two runs died on a transient
//                       "Timed out waiting for Flovart services" probe, which is
//                       a local-service issue rather than a script one.
const DEFERRED = new Set(['canvas-group-align', 'canvas-zoom']);

// ---------------------------------------------------------------------------
// 3. ffmpeg.
// ---------------------------------------------------------------------------
function resolveFfmpeg() {
  const candidates = [process.env.FLOVART_FFMPEG, 'H:\\ffmpeg\\bin\\ffmpeg.exe',
    'D:\\ffmpeg\\bin\\ffmpeg.exe', 'ffmpeg'].filter(Boolean);
  for (const c of candidates) if (c === 'ffmpeg' || existsSync(c)) return c;
  throw new Error('ffmpeg not found — set FLOVART_FFMPEG to the ffmpeg binary.');
}

function runFfmpeg(args, label) {
  const bin = resolveFfmpeg();
  return new Promise((res, rej) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', c => { err += c; });
    child.once('error', rej);
    child.once('close', code => (code === 0 ? res() : rej(new Error(`${label} failed (${code}): ${err.slice(-500)}`))));
  });
}

// ---------------------------------------------------------------------------
// 3. Fixtures — locally generated test media, never user material.
// ---------------------------------------------------------------------------
const PLATE_HTML = `<!doctype html><html><body style="margin:0">
<div style="width:1280px;height:720px;position:relative;overflow:hidden;background:#141118;font-family:system-ui,sans-serif">
  <div style="position:absolute;inset:-20%;background:
    radial-gradient(38% 46% at 26% 30%, #E8453C 0%, rgba(232,69,60,0) 62%),
    radial-gradient(34% 40% at 78% 72%, #F5A623 0%, rgba(245,166,35,0) 60%),
    radial-gradient(30% 36% at 62% 18%, #4A6CF7 0%, rgba(74,108,247,0) 58%)"></div>
  <div style="position:absolute;inset:0;background-image:
    linear-gradient(rgba(255,255,255,.10) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.10) 1px, transparent 1px);
    background-size:80px 80px"></div>
  <div style="position:absolute;left:96px;top:210px;width:230px;height:230px;border-radius:50%;
    background:rgba(255,255,255,.94);box-shadow:0 24px 70px rgba(0,0,0,.45)"></div>
  <div style="position:absolute;left:300px;top:262px;width:118px;height:118px;
    background:#141118;transform:rotate(12deg)"></div>
  <div style="position:absolute;left:472px;top:210px;width:0;height:0;
    border-left:82px solid transparent;border-right:82px solid transparent;border-bottom:212px solid rgba(232,69,60,.95)"></div>
  <div style="position:absolute;left:96px;top:496px;color:#fff;letter-spacing:.34em;font-size:26px;font-weight:700">FLOVART DEMO PLATE</div>
  <div style="position:absolute;left:98px;top:540px;color:rgba(255,255,255,.62);font-size:17px;letter-spacing:.16em">1280 × 720 · locally generated fixture</div>
  <div style="position:absolute;right:76px;top:74px;width:210px;height:150px;border:3px solid rgba(255,255,255,.8);border-radius:6px"></div>
  <div style="position:absolute;right:96px;bottom:70px;display:flex;gap:16px">
    <div style="width:52px;height:52px;background:#E8453C;border-radius:10px"></div>
    <div style="width:52px;height:52px;background:#F5A623;border-radius:10px"></div>
    <div style="width:52px;height:52px;background:#4A6CF7;border-radius:10px"></div>
  </div>
</div></body></html>`;

async function ensureFixtures() {
  const imagePath = join(fixtureDir, 'plate.png');
  const videoPath = join(fixtureDir, 'plate.mp4');
  const audioPath = join(fixtureDir, 'tone.m4a');

  if (!existsSync(imagePath)) {
    // Pass the full Chrome-for-Testing binary explicitly: `headless: true` alone
    // resolves to the chromium_headless_shell channel, absent on this machine.
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.FLOVART_CHROME_PATH || chromium.executablePath(),
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent(PLATE_HTML, { waitUntil: 'load' });
    await page.screenshot({ path: imagePath });
    await browser.close();
    console.log(`[clip] fixture image → ${imagePath}`);
  }
  if (!existsSync(videoPath)) {
    // A silent stereo track is included so the audio-split / stem-split clips
    // have a real second stream to separate, not just a video-only file.
    await runFfmpeg(['-y',
      '-loop', '1', '-i', imagePath,
      '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-t', '8',
      '-vf', 'zoompan=z=\'min(zoom+0.0006,1.14)\':d=200:x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':s=1280x720,fps=25,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
      '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', videoPath,
    ], 'fixture video');
    console.log(`[clip] fixture video → ${videoPath}`);
  }
  if (!existsSync(audioPath)) {
    await runFfmpeg(['-y',
      '-f', 'lavfi', '-i', 'sine=frequency=392:duration=8',
      '-f', 'lavfi', '-i', 'sine=frequency=587.33:duration=8',
      '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=shortest,volume=0.35[a]',
      '-map', '[a]', '-c:a', 'aac', '-b:a', '128k', audioPath,
    ], 'fixture audio');
    console.log(`[clip] fixture audio → ${audioPath}`);
  }
  return { image: imagePath, video: videoPath, audio: audioPath };
}

async function startFixtureServer(fixtures) {
  const server = createServer(async (req, res) => {
    const name = new URL(req.url, 'http://127.0.0.1').pathname.replace(/^\//, '');
    const file = fixtures[name];
    if (!file || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.mp4') ? 'video/mp4' : 'audio/mp4';
    const body = await readFile(file);
    const headers = {
      // The canvas renders fixtures straight into <img>/<video>, which is why
      // these two headers matter: CORP keeps the page cross-origin isolated
      // under COEP, and CORS lets the app read the bytes for local transforms.
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes',
    };

    // Range support is required, not optional: <video preload="metadata"> asks
    // for a byte range, and without a 206 the element never fires
    // loadedmetadata — the trim dialog then reads a 0s duration, disables its
    // confirm button and the recorded clip stalls on an untouched dialog.
    const range = req.headers.range;
    const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      const size = body.length;
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (!Number.isFinite(start) || start >= size || end < start) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
        return res.end();
      }
      const chunk = body.subarray(start, end + 1);
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': chunk.length,
      });
      return res.end(chunk);
    }

    res.writeHead(200, { ...headers, 'Content-Length': body.length });
    res.end(body);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

// ---------------------------------------------------------------------------
// 4. Plain helpers.
// ---------------------------------------------------------------------------
async function cleanupTemp(dir) {
  if (FLAGS.has('--keep-temp')) { console.log(`[clip] temp kept → ${dir}`); return; }
  // Deleting a Chrome profile tree is slow on H: (many small files). Bound the
  // wait so a finished run is never held hostage by cleanup.
  const deletion = rm(dir, { recursive: true, force: true }).then(() => true).catch(() => true);
  const done = await Promise.race([deletion, sleep(15_000).then(() => false)]);
  if (!done) console.log(`[clip] temp cleanup still running in background → ${dir}`);
}

async function waitFor(check, timeoutMs = 90_000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try { const v = await check(); if (v) return v; } catch (e) { lastError = e; }
    await sleep(intervalMs);
  }
  throw lastError || new Error('Timed out waiting for Flovart services.');
}

// The workspace-writer handshake right after a fresh browser connects is racy:
// the writer lease can still be settling when the first CLI write arrives, and
// that write then fails. Retry the handshake-sensitive write instead of losing
// the whole clip.
async function retry(label, attempts, fn) {
  let lastError = null;
  for (let i = 1; i <= attempts; i += 1) {
    try { return await fn(); } catch (e) {
      lastError = e;
      console.log(`[clip] ${label} attempt ${i}/${attempts} failed: ${e.message}`);
      if (i < attempts) await sleep(2500);
    }
  }
  throw lastError;
}

// ~/.flovart/agent.json can drift from the agent that is actually running —
// a stale CLI `start` rewrites it to a dynamic port and then exits. Probe the
// configured URL and fall back to the well-known port instead of dying on a
// dead address.
async function agentHealthy(agent) {
  if (!agent?.url) return false;
  try {
    const r = await fetch(new URL('/health', agent.url), {
      headers: { 'x-flovart-agent-token': agent.token || '' },
      signal: AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch { return false; }
}

async function resolveServices() {
  // Honour the same override the CLI uses, so the recorded browser and the CLI
  // writes always talk to the SAME agent. Without this, a stale agent.json can
  // point the browser at one agent and the CLI at another.
  const agentConfigPath = process.env.FLOVART_AGENT_CONFIG
    || join(homedir(), '.flovart', 'agent.json');
  const webDiscoveryPath = join(homedir(), '.flovart', 'web.json');

  const configured = await waitFor(() => {
    if (!existsSync(agentConfigPath)) return null;
    const c = JSON.parse(readFileSync(agentConfigPath, 'utf8'));
    return c?.url && c?.token ? c : null;
  });
  const agentCandidates = [configured, { ...configured, url: 'http://127.0.0.1:17373' }];
  let agent = configured;
  for (const candidate of agentCandidates) {
    if (await agentHealthy(candidate)) { agent = candidate; break; }
  }
  if (agent.url !== configured.url) {
    console.log(`[clip] ${agentConfigPath} points at ${configured.url} (no /health) — using ${agent.url}`);
  }
  // The CLI child resolves the agent from FLOVART_AGENT_CONFIG independently of
  // what the browser was pointed at, so write the resolved endpoint to its own
  // config and hand that to the child. Otherwise a stale discovery file makes
  // the browser talk to one agent and every CLI write to another.
  const resolvedConfigPath = join(tmpDir, 'agent-resolved.json');
  writeFileSync(resolvedConfigPath, JSON.stringify(agent, null, 2));

  const web = await waitFor(async () => {
    const candidates = new Set();
    if (process.env.FLOVART_WEB_URL) candidates.add(process.env.FLOVART_WEB_URL);
    if (existsSync(webDiscoveryPath)) {
      try { candidates.add(JSON.parse(readFileSync(webDiscoveryPath, 'utf8')).url); } catch { /* malformed */ }
    }
    candidates.add('http://127.0.0.1:37522');
    for (const url of candidates) {
      if (!url) continue;
      const live = await probeWebUi(url, { timeoutMs: 1200 }).catch(() => null);
      if (live) return live;
    }
    return null;
  });
  return { agent, webUrl: typeof web === 'string' ? web : web?.url, resolvedConfigPath };
}

// The CLI prints npm's banner, then a pretty-printed JSON envelope. The
// top-level object is the only `{` sitting at column 0.
function parseCliJson(out) {
  const lines = out.split(/\r?\n/);
  const start = lines.findIndex(line => line.trimEnd() === '{' && !/^\s/.test(line));
  if (start === -1) throw new Error(`no JSON envelope in CLI output: ${out.slice(-400)}`);
  return JSON.parse(lines.slice(start).join('\n'));
}

function makeCli(agentConfigPath) {
  // Invoke the CLI through node directly instead of `npm run … -- …`.
  // An npm+shell hop on Windows re-splits argv, which silently truncates
  // titles at spaces and mangles the JSON metadata payload.
  const cliPath = join(projectDir, 'tools', 'flovart', 'cli.js');
  const env = agentConfigPath
    ? { ...process.env, FLOVART_AGENT_CONFIG: agentConfigPath }
    : process.env;
  return args => new Promise((res, rej) => {
    const child = spawn(process.execPath, [cliPath, ...args, '--json'], {
      cwd: projectDir, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.once('error', rej);
    child.once('close', code => {
      // The CLI sets exitCode=1 whenever the envelope says ok:false, so the
      // envelope is the real error source — never trust the exit code alone.
      let parsed = null;
      try { parsed = parseCliJson(out); } catch { /* fall through */ }
      if (!parsed) {
        return rej(new Error(`cli ${args[0]} exited ${code} with no parsable envelope: ${(err || out).slice(-300)}`));
      }
      if (parsed.ok === false) return rej(new Error(`cli ${args[0]} → ${parsed.error?.code}: ${parsed.error?.message}`));
      res(parsed);
    });
  });
}

// ---------------------------------------------------------------------------
// 5. Record one clip.
// ---------------------------------------------------------------------------
async function recordClip(key, clip, services, fixtureOrigin, runTag) {
  const { agent, webUrl } = services;
  const agentIdentity = 'workbuddy';
  const cli = makeCli(services.resolvedConfigPath);

  const tempRoot = resolveTestTempRoot(projectDir);
  await mkdir(tempRoot, { recursive: true });
  const testRoot = await mkdtemp(join(tempRoot, 'flovart-clip-'));
  process.env.TEMP = testRoot;
  process.env.TMP = testRoot;
  process.env.TMPDIR = testRoot;

  const chromeExecutable = process.env.FLOVART_CHROME_PATH || chromium.executablePath();
  if (!existsSync(chromeExecutable)) throw new Error(`Chrome for Testing not found: ${chromeExecutable}`);

  const videoDir = join(testRoot, 'video');
  await mkdir(videoDir, { recursive: true });
  const bootstrapToken = await issueBrowserBootstrapToken(agent);
  const bootstrapUrl = buildBrowserBootstrapUrl(webUrl, { ...agent, bootstrapToken }, '#/app');
  const profileDir = join(testRoot, 'chrome-profile');
  await mkdir(profileDir, { recursive: true });
  if (FLAGS.has('--keep-temp')) console.log(`[clip] temp root → ${testRoot}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    executablePath: chromeExecutable,
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
    args: ['--no-first-run', '--no-default-browser-check', '--window-size=1464,980'],
  });
  // Video capture starts with the context, so wall-clock deltas from here are
  // video offsets: marks let us cut dead lead-in/out deterministically.
  const recStart = Date.now();
  const marks = {};
  const mark = name => { marks[name] = (Date.now() - recStart) / 1000; };
  let savedVideo = null;
  try {
    const page = await context.newPage();
    // Surface in-page errors that would otherwise only be visible as a stuck
    // dialog — ffmpeg.wasm failures never reach the CLI log.
    page.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error' || /ffmpeg|worker|wasm|Failed to/i.test(text)) {
        console.log(`[clip] page:${msg.type()} ${text.slice(0, 200)}`);
      }
    });
    page.on('pageerror', err => console.log(`[clip] pageerror ${err.message.slice(0, 200)}`));
    await page.goto(bootstrapUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.locator('body[data-flovart-mounted="1"]').waitFor({ state: 'attached', timeout: 60_000 });
    const health = await waitFor(async () => {
      const r = await fetch(new URL('/health', agent.url));
      if (!r.ok) return null;
      const v = await r.json();
      return Number(v.clients || 0) > 0 ? v : null;
    }, 45_000);
    console.log(`[clip] browser connected as workspace writer, clients=${health.clients}`);
    await sleep(2000); // let the writer lease settle before the first CLI write

    // Fresh project so the canvas starts empty and focuses this clip.
    const projectTitle = `${clip.title} Demo ${runTag}`;
    await retry('project.create', 3, () => cli(['workflow.project.create', '--title', projectTitle,
      '--agent-identity', agentIdentity, '--idempotency-key', `clip-${key}-${runTag}`]));
    const projectId = await waitFor(async () => {
      try {
        const r = await fetch(new URL('/health', agent.url));
        const v = await r.json();
        return v?.activeProjectId || v?.activeWriter?.projectId || null;
      } catch { return null; }
    }, 45_000, 500);
    if (!projectId) throw new Error('no active project id');
    await sleep(1500);
    console.log(`[clip] project ${projectId} (${projectTitle})`);

    // ---- seed media nodes where the scenario needs them -------------------
    const seed = clip.kind === 'node-tool'
      ? [clip.media, ...(clip.selectAllOfType ? [clip.media] : [])]
      : (clip.seed || []);
    const mimeOf = t => (t === 'image' ? 'image/png' : t === 'video' ? 'video/mp4' : 'audio/mp4');
    const fileOf = t => (t === 'image' ? 'plate.png' : t === 'video' ? 'plate.mp4' : 'tone.m4a');
    let firstMediaNodeId = null;
    if (seed.length) {
      for (let i = 0; i < seed.length; i += 1) {
        const type = seed[i];
        const x = 260 + (i % 2) * 470;
        const y = 180 + Math.floor(i / 2) * 300;
        await cli(['workflow.node.create', '--project-id', projectId, '--type', type,
          '--title', `${clip.title} 素材 ${i + 1}`,
          '--x', String(x), '--y', String(y), '--width', '470', '--height', '264',
          '--metadata-json', JSON.stringify({
            href: `${fixtureOrigin}/${fileOf(type)}`, mimeType: mimeOf(type), name: fileOf(type),
          }),
          '--agent-identity', agentIdentity, '--idempotency-key', `clip-${key}-seed-${i}-${runTag}`]);
      }
      await sleep(2200);
      const inspected = await cli(['workflow.inspect', '--agent-identity', agentIdentity,
        '--project-id', projectId]).catch(() => null);
      const nodes = inspected?.data?.result?.nodes || [];
      firstMediaNodeId = nodes.find(n => n.title === `${clip.title} 素材 1`)?.id || nodes[0]?.id || null;
      const withMedia = nodes.filter(n => n.metadata?.hasMedia).length;
      console.log(`[clip] seeded ${nodes.length} node(s), ${withMedia} with media`);
      if (clip.kind === 'node-tool' && !withMedia) {
        throw new Error('seeded node has no media — fixture metadata did not attach');
      }
    }
    await sleep(900);
    mark('seeded');

    // Warm the in-page ffmpeg core before the recorded interaction for tools
    // that need it. Cold start fetches and instantiates a ~30MB wasm core, and
    // showing that download as the "operation" would misrepresent the feature.
    // Same module instance the app uses — getFFmpeg() memoises at module scope.
    if (FFMPEG_TOOLS.has(key) || clip.prewarmFfmpeg) {
      const t0 = Date.now();
      const warm = await page.evaluate(async () => {
        try {
          const mod = await import('/services/ffmpegClient.ts');
          const ff = await mod.getFFmpeg();
          return { ok: true, loaded: ff.loaded };
        } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
      });
      console.log(`[clip] ffmpeg prewarm: ${JSON.stringify(warm)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }

    // ---- run the scenario -------------------------------------------------
    let resultNodes = 0;
    if (clip.kind === 'node-tool') {
      const node = page.locator('[data-workflow-node-id]').first();
      await node.waitFor({ state: 'visible', timeout: 30_000 });
      const box = await node.boundingBox();
      if (!box) throw new Error('node has no bounding box');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
      await sleep(200);
      mark('select');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
      await sleep(900);

      const toolbar = page.locator('[data-testid="workflow-node-toolbar"]');
      await toolbar.waitFor({ state: 'visible', timeout: 20_000 });

      if (clip.selectAllOfType) {
        // Multi-node tools (merge) need every node of that type selected.
        const total = await page.locator('[data-workflow-node-id]').count();
        for (let i = 1; i < total; i += 1) {
          const b = await page.locator('[data-workflow-node-id]').nth(i).boundingBox();
          if (!b) continue;
          await page.keyboard.down('Shift');
          await page.mouse.click(b.x + b.width / 2, b.y + b.height / 3);
          await page.keyboard.up('Shift');
          await sleep(250);
        }
        await sleep(500);
      }

      const toolButton = toolbar.getByRole('button', { name: clip.toolbarLabel });
      await toolButton.waitFor({ state: 'visible', timeout: 20_000 });
      await sleep(500);
      await toolButton.click();
      await sleep(900);

      if (clip.dialogTitle) {
        const dialog = page.getByRole('dialog').filter({ hasText: clip.dialogTitle }).first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await sleep(1200); // let the viewer read the panel
        // Dump the panel text: it carries the parsed duration/parameters, which
        // is the fastest way to tell "loaded fine" from "metadata never arrived".
        const dialogText = await dialog.innerText().catch(() => '');
        console.log(`[clip] dialog: ${dialogText.replace(/\s+/g, ' ').slice(0, 220)}`);
        mark('confirm');
        await clip.action(page);
        // Wait for the dialog to close, but also watch for the panel's own error
        // region: a rejected operation surfaces there and would otherwise look
        // identical to a slow one.
        const outcome = await Promise.race([
          dialog.waitFor({ state: 'hidden', timeout: 300_000 }).then(() => 'committed'),
          (async () => {
            const alert = page.locator('.workflow-image-tool__error, [role="alert"]');
            for (let i = 0; i < 300; i += 1) {
              const text = await alert.first().innerText().catch(() => '');
              if (text && text.trim()) return `error: ${text.trim().slice(0, 200)}`;
              await sleep(1000);
            }
            return 'no result after 300s';
          })(),
        ]);
        console.log(`[clip] operation outcome: ${outcome}`);
      } else {
        mark('confirm');
      }
      await sleep(2600);
      mark('result');
      resultNodes = await page.evaluate(() => document.querySelectorAll('[data-workflow-node-id]').length);
    } else {
      mark('select');
      await clip.run({ page, cli, projectId, agentIdentity, runTag, sleep, mark });
      await sleep(2200);
      mark('result');
      resultNodes = await page.evaluate(() => document.querySelectorAll('[data-workflow-node-id]').length);
    }
    console.log(`[clip] canvas nodes after operation: ${resultNodes}`);

    await sleep(900);
    marks.end = (Date.now() - recStart) / 1000;
    const video = page.video();
    await context.close();
    if (video) {
      const rawPath = await video.path();
      savedVideo = join(testRoot, 'raw.webm');
      await copyFile(rawPath, savedVideo);
    }
    return { savedVideo, tempRoot: testRoot, marks };
  } finally {
    await context.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// 6. Main
// ---------------------------------------------------------------------------
if (FLAGS.has('--list')) {
  for (const [k, c] of Object.entries(CATALOG)) {
    const tags = [c.provider ? '[needs provider]' : '', FFMPEG_TOOLS.has(k) ? '[ffmpeg.wasm]' : '']
      .filter(Boolean).join(' ');
    console.log(`${k.padEnd(22)} ${c.kind.padEnd(10)} ${c.title}${tags ? '  ' + tags : ''}`);
  }
  process.exit(0);
}

const requested = argOf('--clip');
if (!requested) {
  console.error('usage: node scripts/record-feature-clips.mjs --clip <key|all> [--list]');
  process.exit(2);
}
// `all` records everything that can actually run here: no provider-backed tools
// (this run configures no BYOK service) and none of the deferred scenarios.
const keys = requested === 'all'
  ? Object.keys(CATALOG).filter(k => FLAGS.has('--include-blocked')
      || (!CATALOG[k].provider && !DEFERRED.has(k)))
  : requested.split(',').map(s => s.trim()).filter(Boolean);
for (const k of keys) if (!CATALOG[k]) { console.error(`unknown clip "${k}"`); process.exit(2); }

const fixtures = await ensureFixtures();
const { server: fixtureServer, origin: fixtureOrigin } = await startFixtureServer({
  'plate.png': fixtures.image, 'plate.mp4': fixtures.video, 'tone.m4a': fixtures.audio,
});
const services = await resolveServices();
console.log(`[clip] agent ${services.agent.url}  web ${services.webUrl}  fixtures ${fixtureOrigin}`);
console.log(`[clip] ${keys.length} clip(s): ${keys.join(', ')}`);

// The MP4 is the master: re-encode GIFs from it to retune size/legibility
// without paying for another recording run.
const gifScale = argOf('--gif-scale') || '900';
const gifFps = argOf('--gif-fps') || '10';
const gifColors = argOf('--gif-colors') || '128';
async function toGif(mp4, gif) {
  await runFfmpeg(['-y', '-i', mp4,
    '-vf', `fps=${gifFps},scale=${gifScale}:-2:flags=lanczos,split[s0][s1];`
      + `[s0]palettegen=max_colors=${gifColors}[p];[s1][p]paletteuse=dither=none`,
    '-loop', '0', gif], 'gif');
}
if (FLAGS.has('--regif')) {
  for (const key of keys) {
    const mp4 = join(outDir, `${key}.mp4`);
    const gif = join(outDir, `${key}.gif`);
    if (!existsSync(mp4)) { console.log(`[clip] skip ${key} — no mp4 master`); continue; }
    await toGif(mp4, gif);
    console.log(`[clip] ♻ ${key} → gif ${(statSync(gif).size / 1024).toFixed(0)} KB`
      + ` (scale=${gifScale} fps=${gifFps} colors=${gifColors})`);
  }
  fixtureServer.close();
  process.exit(0);
}

let failures = 0;
const failed = [];
for (const key of keys) {
  const clip = CATALOG[key];
  const runTag = `${Date.now().toString(36)}${key.replace(/[^a-z0-9]/gi, '')}`;
  console.log(`\n=== clip: ${key} (${clip.title}) ===`);
  try {
    const { savedVideo, tempRoot, marks } = await recordClip(key, clip, services, fixtureOrigin, runTag);
    if (!savedVideo) throw new Error('no video produced');
    const mp4 = join(outDir, `${key}.mp4`);
    const gif = join(outDir, `${key}.gif`);
    // Cut dead lead-in/out: open a beat before the first interaction, close as
    // soon as the result has rendered.
    const ss = Math.max(0, (marks?.select ?? marks?.seeded ?? 0) - 1.2);
    const end = marks?.result ?? marks?.end ?? 0;
    const t = Math.max(3, end - ss + 0.6);
    // ffmpeg.wasm-backed video/audio tools pay a real one-off wasm-core load, so
    // those clips run long. Speed the whole clip up uniformly rather than
    // splicing the wait out — a uniform change is visible and disclosed, whereas
    // a cut would misrepresent how long the operation actually takes.
    const speed = t > 12 ? Math.min(3.5, t / 9) : 1;
    console.log(`[clip] trim ${ss.toFixed(2)}s → ${(ss + t).toFixed(2)}s (${t.toFixed(2)}s of source)${speed > 1 ? `, played at ${speed.toFixed(2)}×` : ''}`);
    const pre = ['-ss', ss.toFixed(2), '-t', t.toFixed(2), '-i', savedVideo];
    const speedChain = speed > 1 ? `setpts=PTS/${speed.toFixed(4)},` : '';
    await runFfmpeg(['-y', ...pre,
      '-vf', `${speedChain}format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
      '-movflags', '+faststart', '-an', mp4], 'mp4');
    if (!FLAGS.has('--no-gif')) {
      // README embeds must stay light. Measured on this UI: 900px / 10fps /
      // 128 colours / no dither lands near 1.1 MB for a ~9s clip and keeps
      // toolbar and dialog text legible. Dithering roughly doubles the size for
      // a mostly-flat canvas UI, so it is deliberately off.
      const chain = [
        speedChain ? speedChain.replace(/,$/, '') : null,
        `fps=${gifFps}`, `scale=${gifScale}:-2:flags=lanczos`,
        `split[s0][s1];[s0]palettegen=max_colors=${gifColors}[p];[s1][p]paletteuse=dither=none`,
      ].filter(Boolean).join(',');
      await runFfmpeg(['-y', ...pre, '-vf', chain, '-loop', '0', gif], 'gif');
    }
    const size = f => (existsSync(f) ? `${(statSync(f).size / 1024).toFixed(0)} KB` : 'n/a');
    console.log(`[clip] ✔ ${key} → ${gif} (${size(gif)}) / mp4 (${size(mp4)})`);
    if (FLAGS.has('--keep-raw')) {
      const rawOut = join(rawDir, `${key}.webm`);
      await copyFile(savedVideo, rawOut);
      console.log(`[clip] raw kept → ${rawOut} (${size(rawOut)})`);
    }
    await cleanupTemp(tempRoot);
  } catch (error) {
    failures += 1;
    failed.push(key);
    console.error(`[clip] ✘ ${key} failed: ${error.message}`);
  }
}

fixtureServer.close();
console.log(`\n[clip] done — ${keys.length - failures}/${keys.length} clip(s) produced.`);
if (failed.length) console.log(`[clip] failed: ${failed.join(', ')}`);
process.exit(failures ? 1 : 0);
