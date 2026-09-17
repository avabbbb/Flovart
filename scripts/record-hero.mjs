// Hero recording driver: records a REAL `codex exec` driving the live
// Workflow in a VISIBLE (non-headless) Chromium window.
//
// What it does, in order:
//   1. Launches a real, windowed Chrome-for-Testing against the already-running
//      local Flovart Agent + Web (same bootstrap as codex-session-browser.mjs),
//      with Playwright recordVideo on.
//   2. Asks the agent to create a fresh project named "Hero Demo" so the canvas
//      starts empty (idempotent via a stable idempotency key).
//   3. Spawns the REAL `codex exec --json --skip-git-repo-check` with the
//      golden-task prompt verbatim. The transcript is captured to .tmp.
//   4. Waits until the visible Workflow shows 3 nodes + 2 connections, then
//      performs a real mouse drag on the first node.
//   5. Holds a beat, closes, and writes artifacts/hero-codex.webm (+ .mp4 copy).
//      A GIF conversion command is printed; ffmpeg is required for GIF output.
//
// Usage: node scripts/record-hero.mjs [--no-drag]
// The Agent (127.0.0.1:17373) and Web (127.0.0.1:37522) must already be
// running — the same services codex-session-browser.mjs uses.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
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

const noDrag = process.argv.includes('--no-drag');
const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = join(projectDir, 'artifacts');
const tmpDir = join(projectDir, '.tmp');
mkdirSync(artifactsDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(check, timeoutMs = 90_000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw lastError || new Error('Timed out waiting for Flovart services.');
}

// ---------------------------------------------------------------------------
// 1. Resolve the running Agent + Web from ~/.flovart (same as session browser).
// ---------------------------------------------------------------------------
const agentConfigPath = process.env.FLOVART_AGENT_CONFIG || join(homedir(), '.flovart', 'agent.json');
const webDiscoveryPath = process.env.FLOVART_WEB_DISCOVERY || join(homedir(), '.flovart', 'web.json');

const agent = await waitFor(() => {
  if (!existsSync(agentConfigPath)) return null;
  const c = JSON.parse(readFileSync(agentConfigPath, 'utf8'));
  return c?.url && c?.token ? c : null;
});
const web = await waitFor(async () => {
  if (!existsSync(webDiscoveryPath)) return null;
  const d = JSON.parse(readFileSync(webDiscoveryPath, 'utf8'));
  return await probeWebUi(d.url, { timeoutMs: 1200 }).catch(() => null);
});
const webDiscovery = JSON.parse(readFileSync(webDiscoveryPath, 'utf8'));
console.log(`[hero] agent ${agent.url}  web ${webDiscovery.url}`);

// ---------------------------------------------------------------------------
// 2. Launch a VISIBLE, video-recorded browser and claim the workspace writer.
// ---------------------------------------------------------------------------
const tempRoot = resolveTestTempRoot(projectDir);
await mkdir(tempRoot, { recursive: true });
const testRoot = await mkdtemp(join(tempRoot, 'flovart-hero-'));
process.env.TEMP = testRoot;
process.env.TMP = testRoot;
process.env.TMPDIR = testRoot;

const chromeExecutable = process.env.FLOVART_CHROME_PATH || chromium.executablePath();
if (!existsSync(chromeExecutable)) {
  throw new Error(`Chrome for Testing executable not found: ${chromeExecutable}`);
}

const videoDir = join(testRoot, 'video');
await mkdir(videoDir, { recursive: true });

const bootstrapToken = await issueBrowserBootstrapToken(agent);
const bootstrapUrl = buildBrowserBootstrapUrl(web, { ...agent, bootstrapToken }, '#/app');
const profileDir = join(testRoot, 'chrome-profile');
await mkdir(profileDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  executablePath: chromeExecutable,
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  args: ['--no-first-run', '--no-default-browser-check', '--window-size=1464,980'],
});
const page = await context.newPage();
await page.goto(bootstrapUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
await page.locator('body[data-flovart-mounted="1"]').waitFor({ state: 'attached', timeout: 60_000 });

const health = await waitFor(async () => {
  const r = await fetch(new URL('/health', agent.url));
  if (!r.ok) return null;
  const v = await r.json();
  return Number(v.clients || 0) > 0 && v.hasWorkflow ? v : null;
}, 45_000);
console.log(`[hero] browser connected, clients=${health.clients}`);

// Helper: drive the flovart CLI synchronously and return parsed JSON.
// The CLI wraps every op in { ok, command, data: { ok, result } }; for
// workflow.inspect the `result` IS the project { id, title, nodes, connections }.
function cli(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('npm', ['run', 'flovart:cli', '--', ...args, '--json'], {
      cwd: projectDir,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.once('error', rejectPromise);
    child.once('close', code => {
      if (code !== 0) return rejectPromise(new Error(`cli exited ${code}: ${err.slice(-400)}`));
      const lines = out.split(/\r?\n/).filter(l => l.trim().startsWith('{'));
      try {
        resolvePromise(JSON.parse(lines[lines.length - 1] || '{}'));
      } catch {
        resolvePromise({ raw: out });
      }
    });
  });
}

async function inspect() {
  const r = await cli(['workflow.inspect', '--agent-identity', 'codex']);
  return r?.data?.result ?? r?.result ?? null;
}

// ---------------------------------------------------------------------------
// 3. Fresh "Hero Demo" project so the canvas starts empty.
// ---------------------------------------------------------------------------
const created = await cli([
  'workflow.project.create',
  '--title', 'Hero Demo',
  '--agent-identity', 'codex',
  '--idempotency-key', 'hero-demo-proj',
]);
console.log('[hero] project.create →', JSON.stringify(created).slice(0, 300));
// Give the canvas a moment to settle into the new project.
await sleep(1500);

// ---------------------------------------------------------------------------
// 4. Run the REAL codex exec. Prompt verbatim from the golden-task contract.
// ---------------------------------------------------------------------------
const prompt = [
  'Create a three-shot product video workflow: three video nodes connected in sequence (Shot 1 -> Shot 2 -> Shot 3). Read the Flovart skill at .agents/skills/flovart/SKILL.md first, then use the Flovart CLI operations (npm run flovart:cli -- ...). Do not modify any source files; only operate the live Workflow through the CLI.',
  'Use the Flovart CLI (npm run flovart:cli -- …) to drive the visible Workflow.',
  'Read .agents/skills/flovart/SKILL.md first. Do not modify any source files.',
].join(' ');

const transcriptPath = join(tmpDir, 'hero-codex-trial.jsonl');
console.log('[hero] spawning codex exec …');
// Pass the prompt via STDIN (codex exec reads instructions from stdin when
// piped). This avoids Windows cmd arg-quoting mangling the '->' and '…'
// characters in the prompt. `codex` resolves to codex.cmd via shell:true.
const codex = spawn('codex', ['exec', '--json', '--skip-git-repo-check'], {
  cwd: projectDir,
  env: process.env,
  shell: process.platform === 'win32',
  stdio: ['pipe', 'pipe', 'pipe'],
});
codex.stdin.write(prompt);
codex.stdin.end();
let transcript = '';
let codexErr = '';
codex.stdout.on('data', c => { transcript += c; });
codex.stderr.on('data', c => { codexErr += c; });

// ---------------------------------------------------------------------------
// 5. While codex works, watch the live workflow until 3 nodes + 2 edges show.
// ---------------------------------------------------------------------------
let sawThreeNodes = false;
const watchDeadline = Date.now() + 300_000; // codex can take a while
while (Date.now() < watchDeadline) {
  const project = await inspect().catch(() => null);
  const nodes = project?.nodes || [];
  const conns = project?.connections || [];
  if (nodes.length >= 3 && conns.length >= 2) {
    sawThreeNodes = true;
    console.log(`[hero] canvas shows ${nodes.length} nodes / ${conns.length} connections`);
    break;
  }
  if (codex.exitCode !== null) break; // codex finished; still verify below
  await sleep(800);
}

// Let codex finish cleanly (bounded).
const codexDone = new Promise(res => codex.once('close', res));
await Promise.race([codexDone, sleep(60_000)]);
writeFileSync(transcriptPath, transcript, 'utf8');
if (codexErr) writeFileSync(join(tmpDir, 'hero-codex-trial.err'), codexErr, 'utf8');
console.log(`[hero] codex exit=${codex.exitCode} transcript→${transcriptPath}`);

// Final verification of the end-state.
const finalProject = await inspect().catch(() => null);
const finalNodes = finalProject?.nodes || [];
const finalConns = finalProject?.connections || [];
console.log(`[hero] final graph: ${finalNodes.length} nodes, ${finalConns.length} connections`);

// ---------------------------------------------------------------------------
// 6. The human touch: drag the first node so the video shows interactivity.
// ---------------------------------------------------------------------------
if (!noDrag && finalNodes.length >= 3) {
  try {
    // Flovart nodes render as .workflow-node with data-workflow-node-id; the
    // draggable surface is the node body. Prefer the first node element.
    const nodeSel = [
      '[data-workflow-node-id]',
      '.workflow-node',
      '.react-flow__node',
    ];
    let handle = null;
    for (const sel of nodeSel) {
      const loc = page.locator(sel).first();
      if (await loc.count()) { handle = loc; break; }
    }
    if (handle) {
      const box = await handle.boundingBox();
      if (box) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await page.mouse.move(cx, cy);
        await sleep(250);
        await page.mouse.down();
        await sleep(200);
        await page.mouse.move(cx + 160, cy + 90, { steps: 18 });
        await sleep(200);
        await page.mouse.up();
        console.log('[hero] dragged node by (160,90)');
      }
    } else {
      console.log('[hero] WARN: no node element matched — drag skipped');
    }
  } catch (e) {
    console.log('[hero] WARN: drag failed:', e.message);
  }
}

// Hold a beat so the recording breathes, then stop.
await sleep(2500);

// ---------------------------------------------------------------------------
// 7. Save the video into artifacts/.
// ---------------------------------------------------------------------------
const video = page.video();
await context.close(); // flushes the video to disk
let savedVideo = null;
if (video) {
  const rawPath = await video.path();
  const webmOut = join(artifactsDir, 'hero-codex.webm');
  await copyFile(rawPath, webmOut);
  savedVideo = webmOut;
  console.log(`[hero] video → ${webmOut}`);
}

// Best-effort mp4 copy (same container; most players handle it).
if (savedVideo) {
  const mp4Out = join(artifactsDir, 'hero-codex.mp4');
  await copyFile(savedVideo, mp4Out).catch(() => {});
  console.log(`[hero] mp4 copy → ${mp4Out}`);
}

console.log('\n[hero] To make the README GIF (requires ffmpeg):');
console.log('  ffmpeg -i artifacts/hero-codex.webm -vf "fps=12,scale=1120:-2:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 artifacts/hero-codex.gif');

await rm(testRoot, { recursive: true, force: true }).catch(() => {});

if (!sawThreeNodes || finalNodes.length < 3 || finalConns.length < 2) {
  console.log(`[hero] DONE (graph incomplete: nodes=${finalNodes.length} conns=${finalConns.length})`);
  process.exit(1);
}
console.log('[hero] DONE — 3 nodes + 2 connections recorded.');
process.exit(0);
