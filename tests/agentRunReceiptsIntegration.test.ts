import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { createWorkflowDispatcher } from '../services/workflowDispatcher';
import { createWorkflowExecutor } from '../services/workflowExecutor';

/**
 * 2026-11-15 评测第 4 项的集成验证：真实 Agent 进程 + 真实 iris CLI 进程 + 真实浏览器侧 Workflow Dispatcher。
 * 只有「浏览器页面」与「Provider」是替身：浏览器侧经 SSE / HTTP 与 Agent 通信，收到的 tool_call 交给
 * services/workflowDispatcher.ts 执行（与页面同一份代码），生成执行器是不联网的 fake。
 * 断言 node.run 成功后经 CLI 的 receipts.list 能读到 run:<runId> 的 artifact 回执。
 */
const repoRoot = process.cwd();
let home = '';
let agent: ChildProcess | null = null;
let events: http.ClientRequest | null = null;
let env: NodeJS.ProcessEnv = {};
let agentUrl = '';
let token = '';
const executedNodeIds: string[] = [];

function request(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, agentUrl);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(url, { method, headers: { 'content-type': 'application/json', 'x-flovart-agent-token': token, authorization: 'Bearer ' + token } }, res => {
      let text = '';
      res.on('data', chunk => { text += String(chunk); });
      res.on('end', () => { try { resolve({ status: res.statusCode || 0, json: JSON.parse(text || 'null') }); } catch { resolve({ status: res.statusCode || 0, json: text }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function cli(args: string[]): Promise<any> {
  return new Promise(resolve => {
    execFile(process.execPath, ['tools/iris/cli.js', ...args, '--json'], { cwd: repoRoot, env, maxBuffer: 8 * 1024 * 1024 }, (_error, stdout) => {
      const text = String(stdout).trim();
      try { resolve(JSON.parse(text)); } catch { resolve({ raw: text }); }
    });
  });
}

async function waitFor<T>(check: () => T | Promise<T>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    try { const value = await check(); if (value) return value; last = value; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('timeout: ' + String(last));
}

function receiptsOf(response: any): any[] {
  const found: any[] = [];
  const walk = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.receipts)) { found.push(...value.receipts); return; }
    Object.values(value).forEach(walk);
  };
  walk(response);
  return found;
}

function runIdsOf(response: any): string[] {
  const ids: string[] = [];
  const walk = (value: any) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.runId === 'string') ids.push(value.runId);
    Object.values(value).forEach(walk);
  };
  walk(response);
  return [...new Set(ids)];
}

describe('auto artifact receipts through the real Agent + CLI path', () => {
  const project = createWorkflowProject('回执集成');

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'iris-receipts-'));
    env = {
      ...process.env,
      HOME: home,
      IRIS_AGENT_HOME: home,
      IRIS_AGENT_CONFIG: join(home, 'agent.json'),
      IRIS_AGENT_PORT: '0',
      IRIS_WORKSPACE_ONLY: '1',
      IRIS_WEB_DISCOVERY: join(home, 'web.json'),
      IRIS_BROWSER_LAUNCH_STATE: join(home, 'browser-launch.json'),
    };
    agent = spawn(process.execPath, ['agent/index.js'], { cwd: repoRoot, env, stdio: 'ignore' });
    const config = await waitFor(() => {
      if (!existsSync(env.IRIS_AGENT_CONFIG!)) return null;
      const parsed = JSON.parse(readFileSync(env.IRIS_AGENT_CONFIG!, 'utf8'));
      return parsed.token && parsed.url && !/:17373\b/.test(parsed.url) ? parsed : null;
    });
    agentUrl = config.url;
    token = config.token;
    await waitFor(async () => (await request('GET', '/health')).status === 200);

    // 浏览器侧：画布 store + 与页面相同的 Workflow Dispatcher；执行器不联网。
    project.nodes = ['shot-a', 'shot-b', 'shot-c', 'shot-slow'].map((id, index) => createWorkflowNode(id, 'image', { x: index * 400, y: 0 }, {
      prompt: '镜头 ' + id,
      config: { mode: 'image', modelId: 'flovart:gpt-image-2', count: 1 },
    }));
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
    const executor = createWorkflowExecutor({
      runNode: async ({ nodeId }) => {
        executedNodeIds.push(nodeId);
        if (nodeId === 'shot-slow') await new Promise(resolve => setTimeout(resolve, 3_000));
        return { status: 'completed', artifact: { kind: 'image', artifactId: 'artifact-' + nodeId, mimeType: 'image/png', name: nodeId + '.png' } } as never;
      },
    });
    const dispatch = createWorkflowDispatcher({
      getState: () => useWorkflowStore.getState() as never,
      createProject: title => useWorkflowStore.getState().createProject(title),
      setActiveProject: id => useWorkflowStore.getState().setActiveProject(id),
      deleteProjects: ids => useWorkflowStore.getState().deleteProjects(ids),
      updateProject: (id, patch) => useWorkflowStore.getState().updateProject(id, patch),
      executor,
    });

    const clientId = 'browser-receipts';
    await new Promise<void>((resolve, reject) => {
      events = http.get(new URL('/events?clientId=' + clientId + '&token=' + token, agentUrl), { headers: { 'x-flovart-agent-token': token } }, res => {
        let buffer = '';
        res.on('data', chunk => {
          buffer += String(chunk);
          let index: number;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const event = /event: (.+)/.exec(block)?.[1];
            const data = /data: (.+)/.exec(block)?.[1];
            if (event === 'hello') resolve();
            if (event === 'tool_call' && data) {
              const { requestId, envelope } = JSON.parse(data);
              void dispatch(envelope).then(result => request('POST', '/workflow/result?clientId=' + clientId, { requestId, clientId, result }));
            }
          }
        });
      });
      events.on('error', reject);
    });
    const latest = useWorkflowStore.getState().projects[0];
    await request('POST', '/workflow/state?clientId=' + clientId, { id: latest.id, title: latest.title, nodes: latest.nodes, connections: latest.connections, draftVersion: latest.draftVersion || 1 });
    await request('POST', '/workflow/activate', { clientId, projectId: latest.id });
    await waitFor(async () => (await request('GET', '/health')).json?.hasWorkflow === true);
  }, 60_000);

  afterAll(() => {
    events?.destroy();
    agent?.kill('SIGTERM');
    useWorkflowStore.setState({ projects: [], activeProjectId: null });
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it('writes one artifact receipt per successful node.run and receipts.list returns it', async () => {
    const before = await cli(['receipts.list', '--project-id', project.id]);
    expect(receiptsOf(before)).toEqual([]);

    const run = await cli(['workflow.node.run', '--project-id', project.id, '--node-id', 'shot-a', '--idempotency-key', 'receipts-run-a']);
    expect(run.ok, JSON.stringify(run).slice(0, 600)).toBe(true);
    const [runId] = runIdsOf(run);
    expect(runId).toBeTruthy();
    expect(executedNodeIds).toEqual(['shot-a']);

    const listed = await cli(['receipts.list', '--project-id', project.id]);
    const receipts = receiptsOf(listed);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ projectId: project.id, kind: 'artifact', externalRef: 'run:' + runId, nodeIds: ['shot-a'] });
    expect(receipts[0].summary).toContain('artifactId=artifact-shot-a');

    // 同一幂等键重放：同一 runId，不重复写回执，也不重复执行
    const replay = await cli(['workflow.node.run', '--project-id', project.id, '--node-id', 'shot-a', '--idempotency-key', 'receipts-run-a']);
    expect(runIdsOf(replay)).toEqual([runId]);
    expect(receiptsOf(await cli(['receipts.list', '--project-id', project.id]))).toHaveLength(1);
    expect(executedNodeIds).toEqual(['shot-a']);
  }, 60_000);

  it('writes one receipt per node for a batch run', async () => {
    const batch = await cli(['workflow.node.run', '--project-id', project.id, '--node-ids', 'shot-b,shot-c', '--idempotency-key', 'receipts-run-bc']);
    expect(batch.ok, JSON.stringify(batch).slice(0, 600)).toBe(true);
    const runIds = runIdsOf(batch);
    expect(runIds).toHaveLength(2);
    const receipts = receiptsOf(await cli(['receipts.list', '--project-id', project.id]));
    expect(receipts).toHaveLength(3);
    expect(receipts.slice(1).map(item => item.externalRef).sort()).toEqual(runIds.map(id => 'run:' + id).sort());
    expect(receipts.slice(1).flatMap(item => item.nodeIds).sort()).toEqual(['shot-b', 'shot-c']);
  }, 60_000);

  it('--wait-seconds returns a running receipt and the same key later joins the in-flight run', async () => {
    const early = await cli(['workflow.node.run', '--project-id', project.id, '--node-id', 'shot-slow', '--idempotency-key', 'slow-run', '--wait-seconds', '1']);
    expect(early, JSON.stringify(early).slice(0, 600)).toMatchObject({ ok: true });
    expect(JSON.stringify(early)).toContain('"status":"running"');
    const done = await cli(['workflow.node.run', '--project-id', project.id, '--node-id', 'shot-slow', '--idempotency-key', 'slow-run']);
    expect(done.ok, JSON.stringify(done).slice(0, 600)).toBe(true);
    expect(runIdsOf(done)).toHaveLength(1);
    expect(executedNodeIds.filter(id => id === 'shot-slow')).toHaveLength(1);
  }, 60_000);
});
