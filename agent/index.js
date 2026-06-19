import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentConfig, saveAgentConfig, workspaceForProject } from './config.js';
import { CodexAppServer } from './codex.js';
import { startMcpServer } from './mcp.js';
import { WorkflowAgentSession } from './session.js';

const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};

const MAX_BODY_BYTES = 36 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 24 * 1024 * 1024;

const readBody = request => new Promise((resolve, reject) => {
  let body = '';
  let bytes = 0;
  let failed = false;
  request.on('data', chunk => {
    if (failed) return;
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      failed = true;
      reject(new Error('request body too large'));
      return;
    }
    body += chunk;
  });
  request.on('end', () => {
    if (failed) return;
    try { resolve(body ? JSON.parse(body) : {}); }
    catch (error) { reject(error); }
  });
  request.on('error', reject);
});

const threadValue = result => result?.thread || result || {};
const threadInWorkspace = (thread, cwd) => {
  const threadCwd = String(threadValue(thread)?.cwd || '');
  return Boolean(threadCwd && path.resolve(threadCwd) === path.resolve(cwd));
};

async function requireWorkspaceThread(app, threadId, cwd, includeTurns = false) {
  const result = await app.readThread(threadId, includeTurns);
  if (!threadInWorkspace(result, cwd)) throw new Error('该 Codex 线程不属于当前 Workflow 工作空间');
  return result;
}

function validateAttachments(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 6) throw new Error('最多上传 6 张图片');
  let total = 0;
  return value.map(item => {
    const type = String(item?.type || '');
    const name = String(item?.name || '未命名图片').slice(0, 180);
    const size = Number(item?.size || 0);
    const dataUrl = String(item?.dataUrl || '');
    if (!type.startsWith('image/') || !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(dataUrl)) throw new Error(`图片附件格式无效：${name}`);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_ATTACHMENT_BYTES) throw new Error(`单张图片不能超过 8MB：${name}`);
    total += size;
    return { type, name, size, dataUrl };
  }).filter(item => {
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('图片附件总大小不能超过 24MB');
    return true;
  });
}

async function writeAttachments(attachments) {
  return Promise.all(attachments.map(async item => {
    const matched = item.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matched) throw new Error(`图片附件无效：${item.name}`);
    const extension = matched[1].includes('png') ? 'png' : matched[1].includes('webp') ? 'webp' : matched[1].includes('gif') ? 'gif' : 'jpg';
    const file = path.join(os.tmpdir(), `flovart-agent-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`);
    await fs.writeFile(file, Buffer.from(matched[2], 'base64'));
    return file;
  }));
}

const validToken = (request, url, token) => url.searchParams.get('token') === token || request.headers['x-flovart-agent-token'] === token;

function setCors(request, response, url, config) {
  const origin = request.headers.origin;
  response.setHeader('Access-Control-Allow-Origin', origin || '*');
  response.setHeader('Access-Control-Allow-Headers', 'content-type,x-flovart-agent-token');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (!origin || request.method === 'OPTIONS' || url.pathname === '/health' || url.pathname === '/config') return true;
  if (!config.origin && validToken(request, url, config.token)) {
    config.origin = origin;
    saveAgentConfig(config);
  }
  response.setHeader('Vary', 'Origin');
  return config.origin === origin;
}

export function startHttpServer() {
  const config = loadAgentConfig(true);
  const port = Number(process.env.FLOVART_AGENT_PORT) || Number(new URL(config.url).port) || 17372;
  config.url = `http://127.0.0.1:${port}`;
  saveAgentConfig(config);
  const session = new WorkflowAgentSession();
  let codex;
  const getCodex = async () => {
    if (!codex) codex = await new CodexAppServer((type, payload) => session.emit(type, payload)).start();
    return codex;
  };

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', config.url);
    if (!setCors(request, response, url, config)) return json(response, 403, { ok: false, error: 'origin not allowed' });
    if (request.method === 'OPTIONS') return json(response, 200, { ok: true });
    if (url.pathname === '/health') return json(response, 200, session.health());
    if (url.pathname === '/config') return json(response, 200, { ok: true, url: config.url, hasToken: true, originBound: Boolean(config.origin) });
    if (!validToken(request, url, config.token)) return json(response, 401, { ok: false, error: 'invalid token' });

    try {
      if (request.method === 'GET' && url.pathname === '/events') return session.openEvents(url, response);
      if (request.method === 'POST' && url.pathname === '/workflow/state') {
        session.updateSnapshot(await readBody(request), url.searchParams.get('clientId') || undefined);
        return json(response, 200, { ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/workflow/result') {
        session.resolveResult(await readBody(request));
        return json(response, 200, { ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/api/tools') {
        const body = await readBody(request);
        const result = await session.callCommand(body.command, body.args || {}, body.source || 'agent');
        return json(response, 200, { ok: true, result });
      }
      if (request.method === 'GET' && url.pathname === '/agent/codex/threads') {
        const cwd = workspaceForProject(url.searchParams.get('projectId') || 'default');
        const result = await (await getCodex()).listThreads(url.searchParams.get('searchTerm') || '', cwd);
        const data = Array.isArray(result?.data) ? result.data.filter(thread => threadInWorkspace(thread, cwd)) : [];
        return json(response, 200, { ok: true, ...result, data });
      }
      if (request.method === 'GET' && url.pathname.startsWith('/agent/codex/threads/')) {
        const threadId = decodeURIComponent(url.pathname.split('/').pop());
        const cwd = workspaceForProject(url.searchParams.get('projectId') || 'default');
        return json(response, 200, { ok: true, ...(await requireWorkspaceThread(await getCodex(), threadId, cwd, true)) });
      }
      if (request.method === 'POST' && url.pathname === '/agent/codex/threads/new') {
        const body = await readBody(request);
        const projectId = String(body.projectId || 'default');
        const thread = await (await getCodex()).startThread(workspaceForProject(projectId));
        const threadId = String(thread?.id || '');
        config.threads ||= {};
        config.threads[projectId] = threadId;
        saveAgentConfig(config);
        return json(response, 200, { ok: true, thread, threadId, messages: [] });
      }
      if (request.method === 'POST' && /\/agent\/codex\/threads\/[^/]+\/resume$/.test(url.pathname)) {
        const body = await readBody(request);
        const threadId = decodeURIComponent(url.pathname.split('/').slice(-2)[0]);
        const projectId = String(body.projectId || 'default');
        const cwd = workspaceForProject(projectId);
        await requireWorkspaceThread(await getCodex(), threadId, cwd);
        const thread = await (await getCodex()).resumeThread(threadId, cwd);
        config.threads ||= {};
        config.threads[projectId] = threadId;
        saveAgentConfig(config);
        const history = await requireWorkspaceThread(await getCodex(), threadId, cwd, true);
        return json(response, 200, { ok: true, thread, ...history });
      }
      if (request.method === 'POST' && url.pathname === '/agent/codex/turn') {
        const body = await readBody(request);
        const projectId = String(body.projectId || 'default');
        const cwd = workspaceForProject(projectId);
        const app = await getCodex();
        let threadId = String(body.threadId || config.threads?.[projectId] || '');
        if (threadId) {
          await requireWorkspaceThread(app, threadId, cwd);
          await app.resumeThread(threadId, cwd);
        }
        else {
          const thread = await app.startThread(cwd);
          threadId = String(thread?.id || '');
          config.threads ||= {};
          config.threads[projectId] = threadId;
          saveAgentConfig(config);
        }
        const attachments = validateAttachments(body.attachments);
        const files = await writeAttachments(attachments);
        void app.startTurn(threadId, `你正在操作 Flovart Workflow。先使用 flovart_workflow_inspect 读取状态，修改时使用 Flovart MCP 原子命令。不得猜测节点 ID，不得读取或输出 API Key、storageKey、本地路径。\n\n用户请求：${String(body.prompt || '')}`, files)
          .catch(error => session.emit('agent_error', { message: error instanceof Error ? error.message : String(error) }))
          .finally(() => Promise.all(files.map(file => fs.unlink(file).catch(() => undefined))));
        return json(response, 200, { ok: true, threadId });
      }
      if (request.method === 'POST' && /\/agent\/codex\/threads\/[^/]+\/archive$/.test(url.pathname)) {
        const body = await readBody(request);
        const threadId = decodeURIComponent(url.pathname.split('/').slice(-2)[0]);
        const projectId = String(body.projectId || 'default');
        const cwd = workspaceForProject(projectId);
        const app = await getCodex();
        await requireWorkspaceThread(app, threadId, cwd);
        await app.archiveThread(threadId);
        if (config.threads?.[projectId] === threadId) delete config.threads[projectId];
        saveAgentConfig(config);
        return json(response, 200, { ok: true });
      }
      return json(response, 404, { ok: false, error: 'not found' });
    } catch (error) {
      return json(response, 500, { ok: false, error: { message: error instanceof Error ? error.message : String(error) } });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log('Flovart Agent');
    console.log(`Local URL: ${config.url}`);
    console.log(`Connect token: ${config.token}`);
    console.log(`Codex MCP: codex mcp add flovart -- node "${fileURLToPath(new URL('./index.js', import.meta.url))}" mcp`);
  });
  const close = () => { codex?.close(); server.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  return server;
}

if (process.argv[2] === 'mcp') await startMcpServer();
else startHttpServer();
