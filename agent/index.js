import http from 'node:http';
import { BootstrapCredentialError, BootstrapCredentialStore } from './bootstrap-credentials.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AGENT_PORT, loadAgentConfig, saveAgentConfig } from './config.js';
import { FlovartAgentService } from './flovart.js';
import { createFlovartAgentTools } from './tools.js';
import { SkillRegistry, BUNDLED_SKILL_IDS } from './skill-registry.js';
import { WorkflowAgentSession, WorkflowAgentSessionError } from './session.js';
import { prepareAgentHostProjection } from './host-projection.js';
import { importFlovartModule } from './flovart-modules.js';

const { discoverAgentHosts } = await importFlovartModule('host-discovery');
const { getAgentIdentity } = await importFlovartModule('host-registry');
const { getCanonicalRegistry } = await importFlovartModule('registry');
const { AGENT_PUBLIC_COMMAND_SET } = await importFlovartModule('agent-surface');

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = path.resolve(process.env.FLOVART_PROJECT_DIR || REPOSITORY_ROOT);
const WORKSPACE_ONLY = process.env.FLOVART_WORKSPACE_ONLY === '1';

const json = (response, status, body) => {
  // SSE 等流式端点可能已经写出响应头：二次 writeHead 会抛 ERR_HTTP_HEADERS_SENT
  // 并击穿进程，此时只能降级为补写一行 SSE error 事件后收尾。
  if (response.headersSent || response.writableEnded) {
    try {
      if (!response.writableEnded && !response.destroyed) {
        response.write(`event: error\ndata: ${JSON.stringify(body)}\n\n`);
        response.end();
      }
    } catch { /* connection already closed */ }
    return;
  }
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body, (key, value) => key === 'stack' || key === 'cause' ? undefined : value));
};

const MAX_BODY_BYTES = 36 * 1024 * 1024;

const readBody = request => new Promise((resolve, reject) => {
  // 用 Buffer 数组收集、end 时统一解码，避免字符串累加切断跨 chunk 的多字节 UTF-8 字符。
  const chunks = [];
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
    chunks.push(chunk);
  });
  request.on('end', () => {
    if (failed) return;
    try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
    catch (error) { reject(error); }
  });
  request.on('error', reject);
});

const requestToken = request => String(request.headers['x-flovart-agent-token'] || '');
// 持久 token 只接受 header 通道，避免长期凭证经 URL query 泄漏到日志/历史；
// 短期一次性 session token 保留 query 通道（EventSource 无法自定义 header）。
const validPersistentToken = (request, token) => Boolean(token) && requestToken(request) === token;

const validToken = (request, url, token, credentials) => (
  validPersistentToken(request, token)
  || credentials.isSessionToken(url.searchParams.get('token'))
  || credentials.isSessionToken(requestToken(request))
);

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && new Set(['127.0.0.1', 'localhost', '[::1]']).has(url.hostname);
  } catch {
    return false;
  }
}

function originTokenAllowed(request, url, config, credentials) {
  return config.origin === request.headers.origin
    || credentials.isSessionToken(url.searchParams.get('token'))
    || credentials.isSessionToken(requestToken(request));
}

function setCors(request, response, url, config, credentials) {
  const origin = request.headers.origin;
  // 无 Origin 的本机 CLI/脚本调用没有 CORS 语义，不再无条件回写 ACAO。
  if (!origin) return true;
  response.setHeader('Vary', 'Origin');
  const applyCorsHeaders = () => {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Headers', 'content-type,x-flovart-agent-token,x-flovart-bootstrap-token');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
  };
  // 预检响应体不会被页面脚本读取，数据面判定在随后的实际请求上执行；
  // 首次绑定 origin 的 bootstrap 流程依赖预检可达。
  if (request.method === 'OPTIONS') {
    applyCorsHeaders();
    return true;
  }
  if (url.pathname === '/bootstrap/exchange') {
    if (isLoopbackOrigin(origin)) applyCorsHeaders();
    return isLoopbackOrigin(origin);
  }
  if (url.pathname === '/bootstrap/issue') return false;
  // /health、/config 是无鉴权就绪探针：保持跨源可读（浏览器首连依赖），
  // 未授权来源的响应字段已在路由层收敛为最小就绪信号。
  if (url.pathname === '/health' || url.pathname === '/config') {
    applyCorsHeaders();
    return true;
  }
  // 其余端点先完成 origin/token 判定，仅判定通过时才回写 ACAO。
  if (config.origin !== origin && validPersistentToken(request, config.token)) {
    config.origin = origin;
    saveAgentConfig(config);
  }
  const allowed = originTokenAllowed(request, url, config, credentials);
  if (allowed) applyCorsHeaders();
  return allowed;
}

export function startHttpServer() {
  const config = loadAgentConfig(true);
  const requestedPort = process.env.FLOVART_AGENT_PORT === '0'
    ? 0
    : Number(process.env.FLOVART_AGENT_PORT) || Number(new URL(config.url).port) || DEFAULT_AGENT_PORT;
  const bootstrapCredentials = new BootstrapCredentialStore();
  const session = new WorkflowAgentSession({ isKnownAgentIdentity: id => Boolean(getAgentIdentity(id)) });
  // /crew/protocol 仍是对外 readiness 握手（local-agent.js inspectLocalAgent
  // 与 CLI bootstrap/status 路径依赖）。Crew/Director 业务面已移除，这里只保留
  // 协议版本与 Registry Hash 的自报能力。
  const canonicalRegistry = getCanonicalRegistry();
  const protocolDescriptor = () => ({
    protocolVersion: canonicalRegistry.protocolVersion,
    registryHash: canonicalRegistry.registryHash,
    capabilities: ['command', 'events'],
    limits: { maxPayloadBytes: 1024 * 1024, eventRetention: 10000 },
  });
  const skillRegistry = new SkillRegistry({ repoRoot: PROJECT_ROOT });
  const flovart = WORKSPACE_ONLY ? null : new FlovartAgentService({
    tools: createFlovartAgentTools((...args) => session.callCommand(...args)),
  });

  const activeSse = new Set();
  const trackSse = response => {
    activeSse.add(response);
    response.on('close', () => activeSse.delete(response));
  };

  const server = http.createServer(async (request, response) => {
    let url;
    try {
      // 鉴权热路径纳入 try/catch：URL 解析、CORS/origin 判定、bootstrap 与
      // token 校验的异常只影响当前请求，不再击穿进程。
      url = new URL(request.url || '/', config.url);
      bootstrapCredentials.expire();
      if (!setCors(request, response, url, config, bootstrapCredentials)) return json(response, 403, { ok: false, error: 'origin not allowed' });
      if (request.method === 'OPTIONS') return json(response, 200, { ok: true });
      if (url.pathname === '/health') {
        const health = session.health();
        // 带 Origin 但未通过 origin/token 判定的调用（任意网站的脚本）只拿就绪信号；
        // 本机 CLI/脚本（无 Origin）与已授权来源仍拿全量状态。
        if (request.headers.origin && !originTokenAllowed(request, url, config, bootstrapCredentials)) {
          return json(response, 200, { ok: true, serviceMode: WORKSPACE_ONLY ? 'workspace-only' : 'agent', hasWorkflow: Boolean(health.hasWorkflow) });
        }
        return json(response, 200, { ...health, serviceMode: WORKSPACE_ONLY ? 'workspace-only' : 'agent' });
      }
      if (url.pathname === '/config') {
        if (request.headers.origin && !originTokenAllowed(request, url, config, bootstrapCredentials)) {
          return json(response, 200, { ok: true });
        }
        return json(response, 200, { ok: true, url: config.url, hasToken: true, originBound: Boolean(config.origin) });
      }
      if (request.method === 'POST' && url.pathname === '/bootstrap/issue') {
        if (request.headers.origin || !validPersistentToken(request, config.token)) {
          return json(response, 401, { ok: false, error: { code: 'BOOTSTRAP_ISSUE_UNAUTHORIZED', message: '只能由本机启动器签发 Browser bootstrap credential。' } });
        }
        return json(response, 200, { ok: true, ...bootstrapCredentials.issue() });
      }
      if (request.method === 'POST' && url.pathname === '/bootstrap/exchange') {
        try {
          const exchanged = bootstrapCredentials.exchange(request.headers['x-flovart-bootstrap-token']);
          return json(response, 200, { ok: true, ...exchanged });
        } catch (error) {
          const known = error instanceof BootstrapCredentialError ? error : new BootstrapCredentialError('BOOTSTRAP_INVALID', 'Browser bootstrap credential 无效。');
          return json(response, 401, { ok: false, error: known.toJSON() });
        }
      }
      if (!validToken(request, url, config.token, bootstrapCredentials)) return json(response, 401, { ok: false, error: 'invalid token' });
    } catch (error) {
      return json(response, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Agent 服务处理失败，请重试。' } });
    }

    try {
      if (request.method === 'GET' && url.pathname === '/events') {
        try {
          session.openEvents(url, response);
        } catch {
          // openEvents 已写出 SSE 头时，json() 内部会降级为单行 error 事件收尾，
          // 避免对已发送响应二次 writeHead。
          json(response, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Agent 服务处理失败，请重试。' } });
          return;
        }
        trackSse(response);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/hosts') {
        return json(response, 200, {
          ...discoverAgentHosts({
            refresh: url.searchParams.get('refresh') === 'true',
            includeVersion: url.searchParams.get('includeVersion') !== 'false',
          }),
          activeHostWriter: session.hostWriterState(),
        });
      }
      if (request.method === 'POST' && url.pathname === '/hosts/prepare') {
        const body = await readBody(request);
        const result = prepareAgentHostProjection({
          agentIdentity: body.agentIdentity || body.host,
          projectDir: PROJECT_ROOT,
        });
        const status = result.ok ? 200 : result.error?.code === 'HOST_UNAVAILABLE' ? 409 : 400;
        return json(response, status, result);
      }
      if (request.method === 'POST' && url.pathname === '/host/activate') {
        const body = await readBody(request);
        const agentIdentity = String(body.agentIdentity || body.host || '').trim().toLowerCase();
        const host = discoverAgentHosts({ includeVersion: false }).agents.find(item => item.id === agentIdentity);
        if (!host?.available && host?.status !== 'manual-import') {
          return json(response, 409, { ok: false, error: { code: 'HOST_UNAVAILABLE', message: `${agentIdentity || '该 Agent Host'} 当前未在本机就绪。` } });
        }
        return json(response, 200, { ok: true, ...session.activateAgentHost({
          agentIdentity,
          hostSessionId: body.hostSessionId || body['host-session-id'],
          projectId: body.projectId || body['project-id'],
        }) });
      }
      if (request.method === 'GET' && url.pathname === '/workspace/lease') {
        return json(response, 200, { ok: true, leases: session.workspaceLeaseState() });
      }
      if (request.method === 'POST' && url.pathname === '/workspace/lease/acquire') {
        const body = await readBody(request);
        return json(response, 200, { ok: true, lease: session.acquireWorkspaceLease(body) });
      }
      if (request.method === 'POST' && url.pathname === '/workspace/lease/validate') {
        const body = await readBody(request);
        return json(response, 200, { ok: true, lease: session.validateWorkspaceLease(body) });
      }
      if (request.method === 'POST' && url.pathname === '/workspace/lease/renew') {
        const body = await readBody(request);
        return json(response, 200, { ok: true, lease: session.renewWorkspaceLease(body.leaseId) });
      }
      if (request.method === 'POST' && url.pathname === '/workspace/lease/release') {
        const body = await readBody(request);
        return json(response, 200, { ok: true, released: session.releaseWorkspaceLease(body.leaseId) });
      }
      if (request.method === 'POST' && url.pathname === '/workspace/lease/expire') {
        return json(response, 200, { ok: true, leases: session.expireWorkspaceLeases() });
      }
      if (request.method === 'POST' && url.pathname === '/workflow/state') {
        session.updateSnapshot(await readBody(request), url.searchParams.get('clientId') || undefined);
        return json(response, 200, { ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/workflow/activate') {
        const body = await readBody(request);
        return json(response, 200, { ok: true, activeWriter: session.activateClient({
          clientId: body.clientId || url.searchParams.get('clientId'),
          projectId: body.projectId || url.searchParams.get('projectId'),
        }) });
      }
      if (request.method === 'POST' && url.pathname === '/workflow/result') {
        session.resolveResult(await readBody(request));
        return json(response, 200, { ok: true });
      }
      if (request.method === 'GET' && url.pathname === '/crew/protocol') {
        return json(response, 200, { ok: true, ...protocolDescriptor() });
      }
      if (request.method === 'GET' && url.pathname === '/api/skills') {
        return json(response, 200, { ok: true, skills: await skillRegistry.scan() });
      }
      if (request.method === 'GET' && /^\/api\/skills\/[^/]+$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.split('/').at(-1));
        let manifest;
        try {
          manifest = await skillRegistry.manifest(id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const notFound = /不在本机注册表|无效的 Skill id/.test(message);
          return json(response, notFound ? 404 : 400, { ok: false, error: { message } });
        }
        return json(response, 200, { ok: true, manifest });
      }
      if (request.method === 'POST' && url.pathname === '/api/skills/install') {
        const body = await readBody(request);
        const id = String(body.id || '');
        const hubUrl = String(body.hubUrl || '');
        let hub;
        try {
          hub = new URL(hubUrl);
        } catch {
          return json(response, 400, { ok: false, error: { message: 'Skill Hub 地址无效。' } });
        }
        const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
        const loopbackHttp = hub.protocol === 'http:' && loopbackHosts.has(hub.hostname);
        if (hub.protocol !== 'https:' && !loopbackHttp) {
          return json(response, 400, { ok: false, error: { message: 'Skill Hub 只允许 https 或本机 loopback http。' } });
        }
        let packageResponse;
        try {
          // 下载加 30s 超时，避免失联/恶意的 Skill Hub 挂住请求。
          packageResponse = await fetch(new URL(`/api/skills/${encodeURIComponent(id)}/package.json`, hub.origin), { signal: AbortSignal.timeout(30_000) });
        } catch {
          return json(response, 502, { ok: false, error: { message: `无法从 Skill Hub 下载 ${id}。` } });
        }
        if (!packageResponse.ok) {
          return json(response, 502, { ok: false, error: { message: `Skill Hub 返回 HTTP ${packageResponse.status}。` } });
        }
        let packageBuffer;
        try {
          packageBuffer = await packageResponse.arrayBuffer();
        } catch {
          return json(response, 502, { ok: false, error: { message: `无法从 Skill Hub 下载 ${id}。` } });
        }
        if (packageBuffer.byteLength > 8 * 1024 * 1024) {
          return json(response, 400, { ok: false, error: { message: 'Skill 包超过 8MB 大小上限。' } });
        }
        let pkg = null;
        try {
          pkg = JSON.parse(Buffer.from(packageBuffer).toString('utf8'));
        } catch { /* 解析失败走下方统一的 400 分支 */ }
        if (!pkg || typeof pkg !== 'object' || String(pkg.id) !== id) {
          return json(response, 400, { ok: false, error: { message: 'Skill 包格式无效。' } });
        }
        try {
          const skill = await skillRegistry.installPackage({
            id,
            version: typeof pkg.version === 'string' ? pkg.version : undefined,
            files: Array.isArray(pkg.files) ? pkg.files : [],
          });
          return json(response, 200, { ok: true, skill });
        } catch (error) {
          return json(response, 400, { ok: false, error: { message: error instanceof Error ? error.message : String(error) } });
        }
      }
      if (request.method === 'POST' && url.pathname === '/api/skills/uninstall') {
        const body = await readBody(request);
        try {
          await skillRegistry.uninstall(String(body.id || ''));
          return json(response, 200, { ok: true });
        } catch (error) {
          return json(response, 400, { ok: false, error: { message: error instanceof Error ? error.message : String(error) } });
        }
      }
      if (request.method === 'POST' && url.pathname === '/api/tools') {
        const body = await readBody(request);
        // Gate the forwarder on the same stable Agent surface the CLI/MCP
        // projections enforce — without this, any local caller could drive a
        // non-public canonical command (e.g. granular workflow.* / provider.*)
        // through the loopback endpoint, bypassing the operation gateway.
        if (!AGENT_PUBLIC_COMMAND_SET.has(String(body.command || ''))) {
          return json(response, 400, { ok: false, error: { code: 'UNKNOWN_COMMAND', message: `Operation is not part of the stable Agent surface: ${String(body.command)}` } });
        }
        const result = await session.callCommand(body.command, body.args || {}, body.source || 'agent', body.idempotencyKey, undefined, body.caller);
        return json(response, 200, { ok: true, result });
      }
      if (flovart && request.method === 'GET' && url.pathname === '/agent/flovart/session') {
        const projectId = url.searchParams.get('projectId') || 'default';
        return json(response, 200, { ok: true, ...(await flovart.snapshot(projectId)) });
      }
      if (flovart && request.method === 'POST' && url.pathname === '/agent/flovart/turn') {
        const body = await readBody(request);
        const projectId = String(body.projectId || 'default');
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
        });
        trackSse(response);
        const emit = (event, data) => {
          if (response.destroyed || request.aborted) return;
          try {
            response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          } catch (error) {
            if (error?.code === 'EPIPE' || error?.code === 'ERR_STREAM_DESTROYED') return;
            console.error('[flovart-agent] SSE write failed:', error);
          }
        };
        const unsubscribe = await flovart.subscribe(projectId, event => {
          const update = event.type === 'message_update' ? event.assistantMessageEvent : undefined;
          if (update?.type === 'text_delta') emit('text-delta', { delta: update.delta });
          if (event.type === 'agent_start') emit('status', { running: true });
          if (event.type === 'tool_execution_start') emit('tool-start', {
            id: event.toolCallId,
            name: event.toolName,
            args: event.args,
          });
          if (event.type === 'tool_execution_end') emit('tool-end', {
            id: event.toolCallId,
            name: event.toolName,
            result: event.result,
            isError: event.isError,
          });
        });
        try {
          const snapshot = await flovart.send(projectId, String(body.prompt || ''), [], body.skillAttachment);
          emit('snapshot', snapshot);
        } catch (error) {
          emit('error', { message: error instanceof Error ? error.message : String(error) });
        } finally {
          unsubscribe();
          response.end();
        }
        return;
      }
      if (flovart && request.method === 'POST' && url.pathname === '/agent/flovart/cancel') {
        const body = await readBody(request);
        await flovart.cancel(String(body.projectId || 'default'));
        return json(response, 200, { ok: true });
      }
      return json(response, 404, { ok: false, error: 'not found' });
    } catch (error) {
      if (error instanceof WorkflowAgentSessionError) {
        const status = ['AGENT_WRITER_INACTIVE', 'AGENT_HOST_REQUIRED', 'AGENT_HOST_SESSION_MISMATCH', 'AGENT_PROJECT_INACTIVE', 'LEASE_EXPIRED', 'LEASE_TARGET_CHANGED', 'REVISION_CONFLICT'].includes(error.code)
          ? 409
          : error.code === 'WORKSPACE_UNAVAILABLE' ? 503 : 400;
        return json(response, status, { ok: false, error: error.toJSON() });
      }
      return json(response, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Agent 服务处理失败，请重试。' } });
    }
  });

  const listen = port => {
    server.once('error', error => {
      if (error?.code === 'EADDRINUSE' && port !== 0 && process.env.FLOVART_AGENT_PORT !== '0') {
        listen(0);
        return;
      }
      console.error(`[flovart-agent] unable to listen on localhost:${port}: ${error?.message || error}`);
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      config.url = `http://127.0.0.1:${actualPort}`;
      saveAgentConfig(config);
      console.log(WORKSPACE_ONLY ? 'Flovart Workspace Operator' : 'Flovart Agent');
      console.log(`Local URL: ${config.url}`);
    });
  };
  listen(requestedPort);
  const close = () => {
    if (flovart) void flovart.close();
    for (const res of activeSse) {
      try { res.end(); } catch { /* SSE connection already closed */ }
    }
    activeSse.clear();
    server.close();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  return server;
}

startHttpServer();
