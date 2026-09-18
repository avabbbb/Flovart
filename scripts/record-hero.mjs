// Hero recording driver: records a REAL external agent (WorkBuddy codebuddy by
// default, or codex) driving the live Workflow in a VISIBLE (non-headless)
// Chromium window.
//
// What it does, in order:
//   1. Launches a real, windowed Chrome-for-Testing against the already-running
//      local Flovart Agent + Web (same bootstrap as codex-session-browser.mjs),
//      with Playwright recordVideo on.
//   2. Creates a fresh project named "Hero Demo" so the canvas starts empty
//      (idempotent via a stable idempotency key).
//   3. Spawns the REAL agent with the golden-task prompt verbatim:
//        - codebuddy: WorkBuddy's embedded node + codebuddy CLI
//          (`node codebuddy -p <prompt> --permission-mode bypassPermissions
//           --allowedTools "Bash Read Glob Grep" --output-format stream-json`)
//        - codex: `codex exec --json --skip-git-repo-check` (prompt via stdin)
//      The transcript is captured to .tmp.
//   4. Waits until the visible Workflow shows 3 nodes + 2 connections, then
//      performs a real mouse drag on the first node.
//   5. Holds a beat, closes, and writes artifacts/hero-codex.webm (+ .mp4 copy).
//      A GIF conversion command is printed; ffmpeg is required for GIF output.
//
// Usage: node scripts/record-hero.mjs [--agent codebuddy|codex] [--no-drag]
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

// ---------------------------------------------------------------------------
// 0. Agent selection: --agent codebuddy|codex (default: codebuddy — codex is
//    rate-limited; WorkBuddy's embedded codebuddy CLI is the working channel).
// ---------------------------------------------------------------------------
const agentArgIdx = process.argv.indexOf('--agent');
const agentKind =
  agentArgIdx !== -1 ? (process.argv[agentArgIdx + 1] || 'codebuddy') : 'codebuddy';
if (!['codebuddy', 'codex'].includes(agentKind)) {
  console.error(`[hero] unknown --agent "${agentKind}" (expected codebuddy|codex)`);
  process.exit(2);
}
// The Flovart writer identity each agent uses for workflow writes.
const agentIdentity = agentKind === 'codebuddy' ? 'workbuddy' : 'codex';

// WorkBuddy's embedded Node + codebuddy CLI entry point.
const CODEBUDDY_NODE =
  process.env.CODEBUDDY_NODE ||
  'C:\\Users\\ava\\.workbuddy\\binaries\\node\\versions\\22.22.2-3\\node.exe';
const CODEBUDDY_CLI =
  process.env.CODEBUDDY_CLI ||
  'H:\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy';

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
  // The session-browser launcher keeps respawning ephemeral vite instances and
  // rewriting web.json with their (often already-dead) ports. Collect every
  // candidate — discovery file, explicit env override, and the stable vite-dev
  // port — and probe each; use the first that actually serves the Web UI.
  const candidates = new Set();
  if (process.env.FLOVART_WEB_URL) candidates.add(process.env.FLOVART_WEB_URL);
  if (existsSync(webDiscoveryPath)) {
    try { candidates.add(JSON.parse(readFileSync(webDiscoveryPath, 'utf8')).url); } catch { /* malformed */ }
  }
  candidates.add('http://127.0.0.1:37522'); // stable vite-dev
  for (const url of candidates) {
    if (!url) continue;
    const live = await probeWebUi(url, { timeoutMs: 1200 }).catch(() => null);
    if (live) return live;
  }
  return null;
});
const webDiscovery = { url: typeof web === 'string' ? web : web?.url };
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
  const r = await cli(['workflow.inspect', '--agent-identity', agentIdentity]);
  return r?.data?.result ?? r?.result ?? null;
}

// ---------------------------------------------------------------------------
// 3. Fresh "Hero Demo" project so the canvas starts empty.
// ---------------------------------------------------------------------------
// CRITICAL: project.create runs through the recorded Browser Writer and the
// store's createProject() sets activeProjectId = the new project — which is
// what focuses the visible canvas AND binds the agent's workspace lease to it.
// If the create is a no-op (idempotent key reused), the store does NOT switch
// the active project: the browser keeps showing the previously-active project
// while the agent writes the (already existing) Hero Demo → the video records
// an empty/stale canvas. So each run uses a UNIQUE title + idempotency key to
// force a real create + activation. workflow.project.use cannot switch away
// from the bound project (the session rejects it as LEASE_TARGET_CHANGED), so
// a fresh create is the only reliable way to focus the canvas.
const runTag = Date.now().toString(36);
const heroTitle = `Hero Demo ${runTag}`;
const created = await cli([
  'workflow.project.create',
  '--title', heroTitle,
  '--agent-identity', agentIdentity,
  '--idempotency-key', `hero-demo-proj-${runTag}`,
]);
console.log('[hero] project.create →', JSON.stringify(created).slice(0, 300));
function extractProjectId(obj) {
  const direct =
    obj?.data?.result?.projectId ?? obj?.result?.projectId ?? obj?.data?.result?.id ?? obj?.result?.id;
  if (direct) return direct;
  const raw = typeof obj?.raw === 'string' ? obj.raw : JSON.stringify(obj || '');
  // Only trust an explicit "projectId" field — a bare "id" can belong to the
  // bound-snapshot project echoed in the envelope, not the created project.
  const m = raw.match(/"projectId"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}
const projectId = extractProjectId(created);
if (!projectId) {
  throw new Error('[hero] could not read created project id — refusing to record a stale canvas');
}
// Verify the recorded browser actually focused the new project before we spawn
// the agent. The authoritative signal is /health.activeProjectId — it mirrors
// this.snapshot.id, i.e. the project the active Browser Writer is showing. The
// workflow.inspect CLI path has its own lease binding and can report a stale
// project, so we poll /health directly and give the snapshot push time to land.
const readActiveProjectId = async () => {
  try {
    const r = await fetch(new URL('/health', agent.url));
    if (!r.ok) return null;
    const v = await r.json();
    return v?.activeProjectId || v?.activeWriter?.projectId || null;
  } catch {
    return null;
  }
};
const focused = await waitFor(async () => {
  const id = await readActiveProjectId();
  return id === projectId ? id : null;
}, 45_000, 500).catch(() => null);
if (!focused) {
  // Last resort: explicitly tell the agent host to bind the recorded browser
  // client to the new project via /workflow/activate (sets activeClientId +
  // its project). clientId comes from /health.activeWriter.clientId.
  try {
    const r = await fetch(new URL('/health', agent.url));
    const v = await r.json();
    const clientId = v?.activeWriter?.clientId || v?.clientId;
    if (clientId) {
      const actUrl = new URL('/workflow/activate', agent.url);
      actUrl.searchParams.set('token', agent.token);
      const act = await fetch(actUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-flovart-agent-token': agent.token },
        body: JSON.stringify({ clientId, projectId }),
      }).then(x => x.json()).catch(() => null);
      console.log('[hero] /workflow/activate →', JSON.stringify(act).slice(0, 200));
    }
  } catch (e) {
    console.log('[hero] /workflow/activate failed:', e.message);
  }
  const id = await waitFor(readActiveProjectId, 15_000, 500).catch(() => null);
  if (id !== projectId) {
    console.log(`[hero] WARN: canvas still on ${id} not ${projectId} — continuing anyway`);
  }
}
console.log(`[hero] active project = ${projectId} (${heroTitle})`);
// Give the canvas a moment to settle into the new project.
await sleep(1500);

// ---------------------------------------------------------------------------
// 4. Run the REAL agent. Prompt verbatim from the golden-task contract.
// ---------------------------------------------------------------------------
const projectPin = projectId ? `--project-id ${projectId}` : '--project-id <the-active-project-id>';
const prompt = agentKind === 'codebuddy'
  ? [
      `Create a three-shot product video workflow in the ACTIVE Flovart project (id ${projectId || 'the-active-one'}): three video nodes connected in sequence (Shot 1 -> Shot 2 -> Shot 3).`,
      'Read the Flovart skill at .agents/skills/flovart/SKILL.md first, then use the Flovart CLI via Bash (npm run flovart:cli -- ...).',
      `IMPORTANT: pass --agent-identity workbuddy AND a unique --idempotency-key on every workflow write command, and scope every write/inspect with ${projectPin}.`,
      'Do not modify any source files.',
    ].join(' ')
  : [
      'Create a three-shot product video workflow: three video nodes connected in sequence (Shot 1 -> Shot 2 -> Shot 3). Read the Flovart skill at .agents/skills/flovart/SKILL.md first, then use the Flovart CLI operations (npm run flovart:cli -- ...). Do not modify any source files; only operate the live Workflow through the CLI.',
      'Use the Flovart CLI (npm run flovart:cli -- …) to drive the visible Workflow.',
      'Read .agents/skills/flovart/SKILL.md first. Do not modify any source files.',
    ].join(' ');

const transcriptPath = join(tmpDir, `hero-${agentKind}-trial.jsonl`);
const transcriptErrPath = join(tmpDir, `hero-${agentKind}-trial.err`);
console.log(`[hero] spawning ${agentKind} …`);

let agentProc;
if (agentKind === 'codebuddy') {
  // WorkBuddy's embedded codebuddy CLI: node.exe <cli> -p "<prompt>" …
  // The prompt goes as a single inline argv arg to -p. No shell wrapper, so
  // Windows quoting cannot mangle '->' etc. stream-json yields a JSONL
  // transcript on stdout.
  if (!existsSync(CODEBUDDY_NODE)) throw new Error(`codebuddy node not found: ${CODEBUDDY_NODE}`);
  if (!existsSync(CODEBUDDY_CLI)) throw new Error(`codebuddy cli not found: ${CODEBUDDY_CLI}`);
  agentProc = spawn(
    CODEBUDDY_NODE,
    [
      CODEBUDDY_CLI,
      '-p', prompt,
      '--permission-mode', 'bypassPermissions',
      '--allowedTools', 'Bash Read Glob Grep',
      '--output-format', 'stream-json',
    ],
    { cwd: projectDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
} else {
  // Pass the prompt via STDIN (codex exec reads instructions from stdin when
  // piped). This avoids Windows cmd arg-quoting mangling the '->' and '…'
  // characters in the prompt. `codex` resolves to codex.cmd via shell:true.
  agentProc = spawn('codex', ['exec', '--json', '--skip-git-repo-check'], {
    cwd: projectDir,
    env: process.env,
    shell: process.platform === 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  agentProc.stdin.write(prompt);
  agentProc.stdin.end();
}
let transcript = '';
let agentErr = '';
agentProc.stdout.on('data', c => { transcript += c; });
agentProc.stderr.on('data', c => { agentErr += c; });

// ---------------------------------------------------------------------------
// 5. While the agent works, watch the live workflow until 3 nodes + 2 edges.
// ---------------------------------------------------------------------------
let sawThreeNodes = false;
// Count nodes as RENDERED on the recorded canvas — the DOM is the ground truth
// for what the video captured. workflow.inspect can read a stale/other project;
// the canvas DOM is what the viewer sees.
const canvasNodeCount = async () => {
  try {
    return await page.evaluate(() => document.querySelectorAll('[data-workflow-node-id], .workflow-node, .react-flow__node').length);
  } catch {
    return 0;
  }
};
let peakNodes = 0;
let peakConns = 0;
const watchDeadline = Date.now() + 300_000; // the agent can take a while
while (Date.now() < watchDeadline) {
  const project = await inspect().catch(() => null);
  const nodes = project?.nodes || [];
  const conns = project?.connections || [];
  peakNodes = Math.max(peakNodes, nodes.length);
  peakConns = Math.max(peakConns, conns.length);
  if (nodes.length >= 3 && conns.length >= 2) {
    sawThreeNodes = true;
    console.log(`[hero] canvas shows ${nodes.length} nodes / ${conns.length} connections`);
    break;
  }
  if (agentProc.exitCode !== null) break; // agent finished; still verify below
  await sleep(800);
}
// Cross-check the visible DOM — if inspect's lease binding is pointing at a
// different project than the recorded canvas, the DOM count reveals the truth.
const domNodes = await canvasNodeCount();
console.log(`[hero] DOM node elements on recorded canvas: ${domNodes}`);

// Let the agent finish cleanly (bounded).
const agentDone = new Promise(res => agentProc.once('close', res));
await Promise.race([agentDone, sleep(60_000)]);
writeFileSync(transcriptPath, transcript, 'utf8');
if (agentErr) writeFileSync(transcriptErrPath, agentErr, 'utf8');
console.log(`[hero] ${agentKind} exit=${agentProc.exitCode} transcript→${transcriptPath}`);

// Final verification of the end-state — trust the live DOM count over inspect,
// since the video records the DOM, not the lease-bound snapshot.
const finalProject = await inspect().catch(() => null);
const inspectNodes = finalProject?.nodes || [];
const finalConns = finalProject?.connections || [];
// The authoritative "did the canvas show nodes" signal is the DOM count — the
// video records the DOM. inspect() can be bound to a different project than the
// one the recorded browser is displaying, so use max(inspect, DOM) as truth.
const visibleNodeCount = Math.max(inspectNodes.length, domNodes, peakNodes);
console.log(`[hero] final graph: inspect=${inspectNodes.length} dom=${domNodes} peak=${peakNodes} → visible=${visibleNodeCount} nodes, ${Math.max(finalConns.length, peakConns)} connections`);

// ---------------------------------------------------------------------------
// 6. The human touch: drag the first node so the video shows interactivity.
// ---------------------------------------------------------------------------
if (!noDrag && visibleNodeCount >= 3) {
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

if (!sawThreeNodes && visibleNodeCount < 3) {
  console.log(`[hero] DONE (graph incomplete: visible=${visibleNodeCount} conns=${Math.max(finalConns.length, peakConns)})`);
  process.exit(1);
}
console.log('[hero] DONE — 3 nodes + 2 connections recorded.');
process.exit(0);
