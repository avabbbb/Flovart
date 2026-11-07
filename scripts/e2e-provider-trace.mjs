// End-to-end trace: real browser UI + real HTTP fake provider + Flovart CLI.
// The fake service is added through the Settings dialog (the user path), the
// canvas is driven only through public flovart CLI commands, and the plan card
// is answered in the UI. Output: .tmp/e2e-trace/<scenario>.json (+ .png).
//
// Usage: node scripts/e2e-provider-trace.mjs [success|cancel|double|submit_lost|download_error|rate_limit|reload_mid|overlimit_ref|dsh_three_shot]
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildBrowserBootstrapUrl, issueBrowserBootstrapToken, probeWebUi, redactBootstrapUrl } from '../tools/flovart/local-agent.js';
import { createFakeProviderServer } from './fake-provider-server.mjs';
import { resolveTestTempRoot } from './test-temp-root.mjs';

const scenario = process.argv[2] || 'success';
// reload_mid keeps the task processing until the page has reloaded, then lets it finish.
const providerMode = scenario === 'reload_mid' ? 'polling_timeout' : ['submit_lost', 'download_error', 'rate_limit', 'submit_no_task_id', 'poll_error'].includes(scenario) ? scenario : 'success';
const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(projectDir, '.tmp', 'e2e-trace');
await mkdir(outDir, { recursive: true });
const tempRoot = resolveTestTempRoot(projectDir);
await mkdir(tempRoot, { recursive: true });
const testRoot = await mkdtemp(join(tempRoot, 'flovart-e2e-'));
const env = {
  ...process.env,
  TEMP: testRoot, TMP: testRoot, TMPDIR: testRoot,
  FLOVART_PROJECT_DIR: projectDir,
  FLOVART_AGENT_CONFIG: join(testRoot, 'agent.json'),
  FLOVART_WEB_DISCOVERY: join(testRoot, 'web.json'),
  FLOVART_BROWSER_LAUNCH_STATE: join(testRoot, 'browser-launch.json'),
};
process.env.TEMP = testRoot; process.env.TMP = testRoot; process.env.TMPDIR = testRoot;
const AGENT = process.env.FLOVART_E2E_AGENT || 'codex';
const MODEL = 'flovart:grok-imagine-video';
const sleep = ms => new Promise(done => setTimeout(done, ms));
const steps = [];
const t0 = Date.now();
function step(name, detail = {}) { steps.push({ atMs: Date.now() - t0, name, ...detail }); }
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

async function waitFor(stage, check, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() <= deadline) {
    try { const value = await check(); if (value) return value; last = value; } catch (error) { last = error instanceof Error ? error.message : String(error); }
    await sleep(300);
  }
  throw new Error('timeout at ' + stage + ' last=' + JSON.stringify(last));
}

function cli(args) {
  return new Promise(done => {
    execFile(process.execPath, ['tools/flovart/cli.js', ...args, '--agent-identity', AGENT, '--json'], { cwd: projectDir, env, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      const out = String(stdout).trim();
      let json = null;
      try { json = JSON.parse(out || 'null'); } catch { try { json = JSON.parse(out.split('\n').filter(Boolean).pop() || 'null'); } catch {} }
      const redact = text => String(text).replace(/(token["'=:\s]+)[A-Za-z0-9._-]+/gi, '$1<redacted>').replaceAll('fake-secret', '<redacted>');
      done({ args: args.filter(a => !/token/i.test(a)), exit: error ? (error.code ?? 1) : 0, json, stdout: json ? undefined : redact(out.slice(-1500)), stderr: redact(String(stderr).slice(-1500)) });
    });
  });
}

function findDeep(value, predicate) {
  if (!value || typeof value !== 'object') return undefined;
  if (predicate(value)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const hit = findDeep(child, predicate);
    if (hit) return hit;
  }
  return undefined;
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {} return; }
  try { child.kill('SIGTERM'); } catch {}
}

// Setup (service validation, model list) always runs against a healthy provider; the fault mode is switched on just before the run.
const provider = createFakeProviderServer({ mode: 'success' });
const listening = Promise.withResolvers();
provider.once('error', listening.reject);
provider.listen(0, '127.0.0.1', () => listening.resolve());
await listening.promise;
const providerOrigin = 'http:' + '//' + '127.0.0.1:' + provider.address().port;
step('fake-provider-up', { mode: providerMode });

const agentCli = spawn(process.execPath, ['tools/flovart/cli.js', 'start', '--source', '--web', '--web-port=0', '--agent-port=0', '--no-open'], { cwd: projectDir, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let cliOutput = '';
agentCli.stdout.on('data', chunk => { cliOutput += String(chunk); });
agentCli.stderr.on('data', chunk => { cliOutput += String(chunk); });

let browser = null;
let page = null;
const trace = { scenario, providerMode, ok: false, steps, cli: [], checks: {} };
try {
  const web = await waitFor('web-discovery', async () => existsSync(env.FLOVART_WEB_DISCOVERY) && probeWebUi(readJson(env.FLOVART_WEB_DISCOVERY).url, { timeoutMs: 800 }).catch(() => null), 90_000);
  const agent = await waitFor('agent-config', () => existsSync(env.FLOVART_AGENT_CONFIG) && readJson(env.FLOVART_AGENT_CONFIG)?.token ? readJson(env.FLOVART_AGENT_CONFIG) : null);
  const bootstrapUrl = buildBrowserBootstrapUrl(web, { ...agent, bootstrapToken: await issueBrowserBootstrapToken(agent) }, '#/app');
  browser = await chromium.launchPersistentContext(join(testRoot, 'chrome-profile'), { headless: true, executablePath: process.env.FLOVART_CHROME_PATH || chromium.executablePath(), args: ['--no-first-run', '--no-default-browser-check'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300)); });
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.flovartVideoPosts = 0;
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        const method = (init && init.method) || (input && input.method) || 'GET';
        if (/post/i.test(method) && /videos/.test(url)) window.flovartVideoPosts += 1;
      } catch { /* observation only */ }
      return originalFetch.apply(this, arguments);
    };
  });
  await page.goto(bootstrapUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('body[data-flovart-mounted="1"]').waitFor({ state: 'attached', timeout: 120_000 });
  step('browser-mounted');

  // 1. Add the fake service through the real Settings dialog.
  await page.getByRole('button', { name: '设置', exact: true }).last().click();
  const addService = page.getByRole('button', { name: '+ 添加 AI 服务', exact: true });
  await addService.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(800);
  await addService.click({ timeout: 30_000 });
  await page.waitForSelector('.settings-key-dialog', { state: 'visible', timeout: 15_000 });
  await page.locator('input[name="baseUrl"]').fill(providerOrigin + '/v1');
  await page.locator('input[name="apiKey"]').fill('fake-secret');
  await page.waitForTimeout(1500);
  // The fake endpoint offers image/video only; the dialog defaults to text+image, so validation fails unless the capabilities match.
  const dialog = page.locator('.settings-key-dialog');
  await dialog.locator('button', { hasText: /^\s*\W?\s*视频\s*$/ }).first().click();
  await dialog.locator('button', { hasText: /^\s*\W?\s*文本\s*$/ }).first().click();
  await page.waitForTimeout(300);
  await page.locator('.settings-key-dialog__footer-actions .isl-go').click();
  await page.waitForSelector('.settings-key-dialog', { state: 'detached', timeout: 30_000 });
  step('service-saved-via-ui');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click().catch(() => {});
  await page.locator('.studio-top-menu__modes').getByRole('button', { name: '工作流', exact: true }).click().catch(() => {});

  // 2. Build the canvas through public CLI commands only.
  const created = await cli(['workflow.project.create', '--title', 'E2E ' + scenario, '--idempotency-key', 'e2e-create-' + scenario]);
  trace.cli.push(created);
  const projectId = findDeep(created.json, v => typeof v.projectId === 'string')?.projectId || findDeep(created.json, v => typeof v.id === 'string' && Array.isArray(v.nodes))?.id;
  if (!projectId) throw new Error('project.create returned no project id');
  trace.cli.push(await cli(['workflow.project.use', '--project-id', projectId, '--idempotency-key', 'e2e-use-' + scenario]));
  // node.create fills node defaults (storageKey etc.) and needs no expectedRevision/mutationId, unlike raw workflow.apply.
  const nodeMetadata = { prompt: '产品镜头缓慢推进，柔光', config: { mode: 'video', modelId: MODEL, submode: scenario === 'overlimit_ref' ? 'image-to-video' : 'text-to-video', aspectRatio: '16:9', durationSec: 5, resolution: '720p', count: 1 } };
  const applied = await cli(['workflow.node.create', '--project-id', projectId, '--type', 'video', '--title', 'E2E 视频', '--x', '200', '--y', '200', '--metadata-json', JSON.stringify(nodeMetadata), '--idempotency-key', 'e2e-node-' + scenario]);
  trace.cli.push(applied);
  const inspected = await cli(['workflow.inspect', '--project-id', projectId]);
  trace.cli.push({ ...inspected, json: undefined, nodeCount: findDeep(inspected.json, v => Array.isArray(v.nodes))?.nodes?.length });
  const nodeId = findDeep(inspected.json, v => v.type === 'video' && typeof v.id === 'string')?.id;
  if (!nodeId) throw new Error('no video node on canvas after apply');
  step('canvas-ready', { projectId, nodeId });
  // A 429 on /v1/models during setup would stop the run at route mapping, before any submit.
  if (providerMode !== 'success') {
    const switched = await fetch(providerOrigin + '/__test__/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: providerMode }) });
    if (!switched.ok) throw new Error('fake provider mode switch failed: ' + switched.status);
    step('provider-mode', { mode: providerMode });
  }

  if (scenario === 'overlimit_ref') {
    // grok-imagine-video takes one image reference; a second must block the plan card before any submit.
    const refs = [];
    for (const [i, title] of ['参考图 A', '参考图 B'].entries()) {
      const created = await cli(['workflow.node.create', '--project-id', projectId, '--type', 'image', '--title', title, '--x', '-260', '--y', String(120 + i * 280), '--metadata-json', JSON.stringify({ status: 'success', href: providerOrigin + '/fixtures/image.png', mimeType: 'image/png', naturalWidth: 1280, naturalHeight: 720 }), '--idempotency-key', 'e2e-ref-' + i]);
      trace.cli.push(created);
      const refId = findDeep(created.json, v => Array.isArray(v.affectedNodeIds))?.affectedNodeIds?.[0];
      if (!refId) throw new Error('reference image node not created');
      const linked = await cli(['workflow.connect', '--project-id', projectId, '--from-node-id', refId, '--to-node-id', nodeId, '--idempotency-key', 'e2e-link-' + i]);
      trace.cli.push(linked);
      const linkId = findDeep(linked.json, v => Array.isArray(v.affectedConnectionIds))?.affectedConnectionIds?.[0];
      if (!linkId) throw new Error('reference connection not created');
      refs.push({ refId, linkId });
    }
    const blockedRun = cli(['workflow.node.run', '--project-id', projectId, '--node-id', nodeId, '--idempotency-key', 'e2e-run-blocked']);
    const blockedCard = page.locator('.flovart-confirm[role="alertdialog"]');
    await blockedCard.waitFor({ state: 'visible', timeout: 60_000 });
    const blockedButtons = blockedCard.locator('.flovart-confirm__actions button');
    trace.checks.blocked = { cardText: (await blockedCard.innerText()).slice(0, 1200), confirmDisabled: await blockedButtons.last().isDisabled() };
    await page.screenshot({ path: join(outDir, scenario + '-blocked-card.png') });
    // A forced click on the disabled confirm must still not submit.
    await blockedButtons.last().click({ force: true, timeout: 2000 }).catch(() => {});
    await sleep(500);
    await blockedButtons.nth((await blockedButtons.count()) - 2).click();
    trace.cli.push(await blockedRun.catch(error => ({ error: String(error) })));
    trace.checks.blocked.submitsWhileBlocked = provider.getState().requests.filter(r => r.method === 'POST' && /videos/.test(r.path)).length;
    // Fix the input: drop the second reference, then run normally below.
    trace.cli.push(await cli(['workflow.disconnect', '--project-id', projectId, '--connection-id', refs[1].linkId, '--idempotency-key', 'e2e-unlink-1']));
    await waitFor('blocked-card-closed', async () => !(await blockedCard.isVisible().catch(() => false)), 15_000);
    step('overlimit-blocked-then-fixed', { confirmDisabled: trace.checks.blocked.confirmDisabled, submitsWhileBlocked: trace.checks.blocked.submitsWhileBlocked });
  }
  if (scenario === 'dsh_three_shot') {
    // Stand-in for a DSH agent session, without any LLM call: only the five commands the DSH plugin exposes
    // (status, workflow.inspect, workflow.selection.get, workflow.apply, workflow.node.run).
    const used = [];
    const tool = async (args) => { used.push(args[0]); const out = await cli(args); trace.cli.push({ ...out, json: out.json?.ok === false ? out.json : undefined }); if (out.exit !== 0 && args[0] !== 'workflow.node.run') throw new Error(args[0] + ' failed (exit ' + out.exit + '): ' + JSON.stringify(out.json?.error ?? out.stderr ?? null).slice(0, 400)); return out; };
    const revisionOf = json => findDeep(json, v => typeof v.draftVersion === 'number')?.draftVersion ?? findDeep(json, v => typeof v.revision === 'number')?.revision;
    const metaOf = (json, id) => findDeep(json, v => v.id === id && v.metadata)?.metadata;
    await tool(['status']);
    const first = await tool(['workflow.inspect', '--project-id', projectId]);
    const base = findDeep(first.json, v => v.id === nodeId && v.metadata);
    const rev1 = revisionOf(first.json);
    if (!base || typeof rev1 !== 'number') throw new Error('inspect gave no base node or revision');
    const shotIds = [nodeId, 'dsh_shot_2', 'dsh_shot_3'];
    const prompts = ['镜头 1：产品全景，缓慢推进', '镜头 2：产品特写，侧光', '镜头 3：产品落幅，拉远'];
    const pos = base.position || { x: 200, y: 200 };
    const shape = n => ({ type: 'video', width: base.width, height: base.height, metadata: { ...base.metadata, prompt: prompts[n] } });
    const ops = [
      { type: 'update_node', id: nodeId, patch: { title: '镜头 1' }, metadata: { prompt: prompts[0] } },
      { type: 'add_node', node: { id: shotIds[1], title: '镜头 2', position: { x: pos.x + 460, y: pos.y }, ...shape(1) } },
      { type: 'add_node', node: { id: shotIds[2], title: '镜头 3', position: { x: pos.x + 920, y: pos.y }, ...shape(2) } },
    ];
    await tool(['workflow.apply', '--project-id', projectId, '--expected-revision', String(rev1), '--mutation-id', 'dsh-three-shot-create', '--intent', '三镜头工作流', '--operations', JSON.stringify(ops), '--idempotency-key', 'dsh-three-shot-create']);
    const created = await tool(['workflow.inspect', '--project-id', projectId]);
    const videoCount = shotIds.filter(id => metaOf(created.json, id)).length;
    trace.checks.dsh = { videoShots: videoCount };
    // One batch run, one plan card.
    const batch = tool(['workflow.node.run', '--project-id', projectId, '--node-ids', shotIds.join(','), '--idempotency-key', 'dsh-three-shot-run']);
    const card3 = page.locator('.flovart-confirm[role="alertdialog"]');
    await card3.waitFor({ state: 'visible', timeout: 60_000 });
    trace.checks.dsh.batchCardText = (await card3.innerText()).slice(0, 1200);
    await page.screenshot({ path: join(outDir, scenario + '-batch-card.png') });
    await card3.locator('.flovart-confirm__actions button').last().click();
    await sleep(1500);
    trace.checks.dsh.secondCardDuringBatch = await card3.isVisible().catch(() => false);
    await batch.catch(error => ({ error: String(error) }));
    const firstPass = await waitFor('three-shots-terminal', async () => {
      const view = await cli(['workflow.inspect', '--project-id', projectId]);
      const metas = shotIds.map(id => metaOf(view.json, id));
      return metas.every(m => m && m.status && m.status !== 'loading') ? view.json : null;
    }, 180_000);
    const snap = json => Object.fromEntries(shotIds.map(id => { const m = metaOf(json, id) || {}; return [id, { status: m.status, prompt: m.prompt, taskId: m.generationProviderTaskId, metaJson: JSON.stringify(m) }]; }));
    trace.checks.dsh.afterBatch = snap(firstPass);
    trace.checks.dsh.firstPassSubmits = provider.getState().requests.filter(r => r.method === 'POST' && /videos/.test(r.path)).length;
    await page.screenshot({ path: join(outDir, scenario + '-after-batch.png') });
    // Edit only shot 2.
    const rev2 = revisionOf((await tool(['workflow.inspect', '--project-id', projectId])).json);
    if (typeof rev2 !== 'number') throw new Error('inspect gave no revision before edit');
    trace.checks.dsh.editedPrompt = '镜头 2：产品特写，换成暖色逆光';
    await tool(['workflow.apply', '--project-id', projectId, '--expected-revision', String(rev2), '--mutation-id', 'dsh-edit-shot-2', '--intent', '只改第二个镜头', '--operations', JSON.stringify([{ type: 'update_node', id: shotIds[1], metadata: { prompt: trace.checks.dsh.editedPrompt } }]), '--idempotency-key', 'dsh-edit-shot-2']);
    trace.checks.dsh.toolsUsed = [...new Set(used)];
    step('dsh-three-shot-batch-then-edit', { submits: trace.checks.dsh.firstPassSubmits });
  }
  const runNodeId = scenario === 'dsh_three_shot' ? 'dsh_shot_2' : nodeId;
  // 3. Run, then answer the plan card in the UI.
  const runKey = 'e2e-run-' + scenario;
  const runs = [cli(['workflow.node.run', '--project-id', projectId, '--node-id', runNodeId, '--idempotency-key', runKey])];
  if (scenario === 'double') runs.push(cli(['workflow.node.run', '--project-id', projectId, '--node-id', nodeId, '--idempotency-key', runKey + '-again']));
  const card = page.locator('.flovart-confirm[role="alertdialog"]');
  await card.waitFor({ state: 'visible', timeout: 60_000 });
  trace.checks.planCardText = (await card.innerText()).slice(0, 1200);
  await page.screenshot({ path: join(outDir, scenario + '-plan-card.png') });
  const buttons = card.locator('.flovart-confirm__actions button');
  if (scenario === 'cancel') await buttons.nth((await buttons.count()) - 2).click();
  else await buttons.last().click();
  step(scenario === 'cancel' ? 'plan-cancelled' : 'plan-confirmed');
  if (scenario === 'double') {
    // A second card would mean the second trigger got as far as a new run.
    await sleep(1500);
    trace.checks.secondPlanCardShown = await card.isVisible().catch(() => false);
    if (trace.checks.secondPlanCardShown) await buttons.last().click();
  }
  if (scenario === 'reload_mid') {
    // Reload only once the provider task id is persisted: recovery must poll that task, never submit again.
    const pending = await waitFor('task-id-persisted', async () => {
      const node = findDeep((await cli(['workflow.inspect'])).json, v => v.id === nodeId && v.metadata);
      return node?.metadata?.status === 'loading' && node.metadata.generationProviderTaskId ? node.metadata : null;
    }, 60_000);
    trace.checks.beforeReload = { status: pending.status, providerTaskId: pending.generationProviderTaskId };
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('body[data-flovart-mounted="1"]').waitFor({ state: 'attached', timeout: 120_000 });
    step('reloaded-mid-run', { providerTaskId: pending.generationProviderTaskId });
    const healed = await fetch(providerOrigin + '/__test__/mode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'success' }) });
    if (!healed.ok) throw new Error('fake provider mode switch failed: ' + healed.status);
  }
  // The run started before a reload may end with the old page; its outcome is read from the canvas below.
  const runResults = scenario === 'reload_mid'
    ? (await Promise.allSettled(runs)).map(r => r.status === 'fulfilled' ? r.value : { error: String(r.reason) })
    : await Promise.all(runs);
  trace.cli.push(...runResults);

  // 4. Terminal state from the canvas, as the Agent sees it.
  const terminal = await waitFor('node-terminal', async () => {
    const view = await cli(['workflow.inspect']);
    const node = findDeep(view.json, v => v.id === runNodeId && v.metadata);
    const status = node?.metadata?.status;
    return status && status !== 'loading' ? node : null;
  }, scenario === 'cancel' ? 15_000 : 120_000).catch(async () => findDeep((await cli(['workflow.inspect'])).json, v => v.id === runNodeId && v.metadata));
  const meta = terminal?.metadata || {};
  trace.checks.node = { status: meta.status, error: meta.error, storageKey: meta.storageKey, providerTaskId: meta.generationProviderTaskId, downloadPending: meta.generationDownloadPending, billableState: meta.generationBillableState };

  // 5. Real HTTP the provider saw.
  const requests = provider.getState().requests.map(r => ({ method: r.method, path: r.path, status: r.status, socketPort: r.socketPort, bodyKeys: r.bodyKeys, duration: r.duration, resolution: r.resolution, aspectRatio: r.aspectRatio, referenceCount: r.referenceCount }));
  trace.checks.http = requests;
  trace.checks.submitCount = requests.filter(r => r.method === 'POST' && /videos/.test(r.path)).length;
  // Read-only observation: how many video POSTs the app itself issued via window.fetch (before any reload).
  trace.checks.appFetchVideoPosts = await page.evaluate(() => window.flovartVideoPosts ?? null).catch(() => null);

  // 6. Playback in the browser.
  trace.checks.video = await page.evaluate(() => Array.from(document.querySelectorAll('video')).map(v => ({ readyState: v.readyState, duration: Number.isFinite(v.duration) ? v.duration : null, hasSrc: Boolean(v.currentSrc) })));
  await page.screenshot({ path: join(outDir, scenario + '-final.png') });
  trace.checks.consoleErrors = consoleErrors.slice(0, 20);
  const finalUrl = page.url().toLowerCase();
  trace.checks.secretInBrowserUrl = finalUrl.includes('agenttoken=') || finalUrl.includes('token=');
  if (scenario === 'success') {
    // Refresh and read the node back: the result must survive a reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('body[data-flovart-mounted="1"]').waitFor({ state: 'attached', timeout: 120_000 });
    await sleep(1500);
    const after = findDeep((await cli(['workflow.inspect'])).json, v => v.id === nodeId && v.metadata)?.metadata || {};
    trace.checks.afterReload = { status: after.status, storageKey: after.storageKey };
    trace.checks.videoAfterReload = await page.evaluate(() => Array.from(document.querySelectorAll('video')).map(v => ({ readyState: v.readyState, hasSrc: Boolean(v.currentSrc) })));
    step('reloaded');
  }
  if (scenario === 'dsh_three_shot') {
    const fin = (await cli(['workflow.inspect', '--project-id', projectId])).json;
    trace.checks.dshFinal = Object.fromEntries(Object.keys(trace.checks.dsh?.afterBatch || {}).map(id => { const m = findDeep(fin, v => v.id === id && v.metadata)?.metadata || {}; return [id, { status: m.status, prompt: m.prompt, taskId: m.generationProviderTaskId, metaJson: JSON.stringify(m) }]; }));
  }
  const node = trace.checks.node;
  const submits = trace.checks.submitCount;
  const expectations = {
    success: { submitsOnce: submits === 1, nodeSucceeded: node.status === 'success', saved: Boolean(node.storageKey), survivesReload: trace.checks.afterReload?.storageKey === node.storageKey && trace.checks.afterReload?.status === 'success' },
    cancel: { noSubmit: submits === 0, nodeNotLoading: node.status !== 'loading' },
    double: { submitsOnce: submits === 1, noSecondCard: !trace.checks.secondPlanCardShown },
    submit_lost: { noResubmit: submits === 1, appIssuedOneSubmit: trace.checks.appFetchVideoPosts === 1, notReportedSuccess: node.status !== 'success', showsSubmitUnknown: /提交结果未知/.test(node.error || '') },
    download_error: { submitsOnce: submits === 1, notReportedSuccess: node.status !== 'success', keepsTaskForRedownload: Boolean(node.downloadPending && node.providerTaskId) },
    rate_limit: { notReportedSuccess: node.status !== 'success', hasError: Boolean(node.error) },
    overlimit_ref: { blockedBeforeSubmit: trace.checks.blocked?.confirmDisabled === true, zeroSubmitsWhileBlocked: trace.checks.blocked?.submitsWhileBlocked === 0, fixedRunSubmitsOnce: submits === 1, fixedRunSentOneReference: (trace.checks.http || []).some(r => r.method === 'POST' && /videos/.test(r.path) && r.referenceCount === 1), fixedRunSucceeded: node.status === 'success' },
    dsh_three_shot: (() => { const d = trace.checks.dsh || {}; const a = d.afterBatch || {}; const ids = Object.keys(a); const finalView = trace.checks.dshFinal || {}; return { usedOnlyPluginTools: (d.toolsUsed || []).every(t => ['status', 'workflow.inspect', 'workflow.selection.get', 'workflow.apply', 'workflow.node.run'].includes(t)), threeVideoShots: d.videoShots === 3, oneCardForBatch: d.secondCardDuringBatch === false, firstPassSubmits3: d.firstPassSubmits === 3, allThreeSucceeded: ids.length === 3 && ids.every(id => a[id].status === 'success'), totalSubmits4: submits === 4, shot2Rerun: node.status === 'success' && Boolean(node.providerTaskId) && node.providerTaskId !== a.dsh_shot_2?.taskId, shot2PromptChanged: finalView.dsh_shot_2?.prompt === d.editedPrompt, shot1Unchanged: Boolean(a[ids[0]]) && finalView[ids[0]]?.metaJson === a[ids[0]].metaJson, shot3Unchanged: Boolean(a.dsh_shot_3) && finalView.dsh_shot_3?.metaJson === a.dsh_shot_3.metaJson }; })(),
    reload_mid: { submitsOnce: submits === 1, taskPersistedBeforeReload: Boolean(trace.checks.beforeReload?.providerTaskId), resumedSameTask: node.providerTaskId === trace.checks.beforeReload?.providerTaskId, nodeSucceeded: node.status === 'success', saved: Boolean(node.storageKey) },
  }[scenario] || {};
  trace.checks.expectations = expectations;
  trace.ok = Object.keys(expectations).length > 0 && Object.values(expectations).every(Boolean);
  if (!trace.ok) trace.error = 'expectations failed: ' + Object.entries(expectations).filter(([, v]) => !v).map(([k]) => k).join(', ');
} catch (error) {
  trace.error = redactBootstrapUrl(error instanceof Error ? error.message : String(error));
  trace.cliOutput = redactBootstrapUrl(cliOutput.slice(-3000));
  try { await page?.screenshot({ path: join(outDir, scenario + '-error.png'), fullPage: true }); } catch {}
} finally {
  trace.durationMs = Date.now() - t0;
  const serialized = JSON.stringify(trace, null, 2);
  trace.secretLeaked = serialized.includes('fake-secret');
  await writeFile(join(outDir, scenario + '.json'), JSON.stringify(trace, null, 2));
  try { await browser?.close(); } catch {}
  stopProcessTree(agentCli);
  provider.close();
  await sleep(500);
  await rm(testRoot, { recursive: true, force: true }).catch(() => {});
}
console.log(JSON.stringify({ scenario, ok: trace.ok, error: trace.error, checks: trace.checks, secretLeaked: trace.secretLeaked }, null, 1).slice(0, 6000));
if (!trace.ok) process.exitCode = 1;
