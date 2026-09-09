import http from 'node:http';
import { BootstrapCredentialError, BootstrapCredentialStore } from './bootstrap-credentials.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AGENT_PORT, loadAgentConfig, saveAgentConfig } from './config.js';
import { FlovartAgentService } from './flovart.js';
import { createFlovartAgentTools } from './tools.js';
import { SkillRegistry, BUNDLED_SKILL_IDS } from './skill-registry.js';
import { WorkflowAgentSession, WorkflowAgentSessionError } from './session.js';
import { CrewStore } from './crew/store.js';
import { CrewService, CrewServiceError } from './crew/service.js';
import { prepareAgentHostProjection } from './host-projection.js';
import { importFlovartModule } from './flovart-modules.js';

const { discoverAgentHosts } = await importFlovartModule('host-discovery');
const { getAgentIdentity, resolveDirectorBinding } = await importFlovartModule('host-registry');

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_ROOT = path.resolve(process.env.FLOVART_PROJECT_DIR || REPOSITORY_ROOT);
const WORKSPACE_ONLY = process.env.FLOVART_WORKSPACE_ONLY === '1';

const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body, (key, value) => key === 'stack' || key === 'cause' ? undefined : value));
};

const MAX_BODY_BYTES = 36 * 1024 * 1024;

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

const requestToken = request => String(request.headers['x-flovart-agent-token'] || '');
const validPersistentToken = (request, url, token) => {
  const queryToken = url.searchParams.get('token');
  const headerToken = requestToken(request);
  return Boolean(token) && (queryToken === token || headerToken === token);
};

const validToken = (request, url, token, credentials) => (
  validPersistentToken(request, url, token)
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

function setCors(request, response, url, config, credentials) {
  const origin = request.headers.origin;
  response.setHeader('Access-Control-Allow-Origin', origin || '*');
  response.setHeader('Access-Control-Allow-Headers', 'content-type,x-flovart-agent-token,x-flovart-bootstrap-token');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (!origin || request.method === 'OPTIONS' || url.pathname === '/health' || url.pathname === '/config') return true;
  if (url.pathname === '/bootstrap/exchange') return isLoopbackOrigin(origin);
  if (url.pathname === '/bootstrap/issue') return false;
  if (config.origin !== origin && validPersistentToken(request, url, config.token)) {
    config.origin = origin;
    saveAgentConfig(config);
  }
  response.setHeader('Vary', 'Origin');
  return config.origin === origin
    || credentials.isSessionToken(url.searchParams.get('token'))
    || credentials.isSessionToken(requestToken(request));
}

export function startHttpServer() {
  const config = loadAgentConfig(true);
  const requestedPort = process.env.FLOVART_AGENT_PORT === '0'
    ? 0
    : Number(process.env.FLOVART_AGENT_PORT) || Number(new URL(config.url).port) || DEFAULT_AGENT_PORT;
  const bootstrapCredentials = new BootstrapCredentialStore();
  const session = new WorkflowAgentSession({ isKnownAgentIdentity: id => Boolean(getAgentIdentity(id)) });
  const crew = new CrewService({
    store: new CrewStore(),
    callCommand: (command, args, source, idempotencyKey) => session.callCommand(command, args, source, idempotencyKey),
  });
  crew.recoverAfterRestart();
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
    const url = new URL(request.url || '/', config.url);
    bootstrapCredentials.expire();
    if (!setCors(request, response, url, config, bootstrapCredentials)) return json(response, 403, { ok: false, error: 'origin not allowed' });
    if (request.method === 'OPTIONS') return json(response, 200, { ok: true });
    if (url.pathname === '/health') return json(response, 200, { ...session.health(), serviceMode: WORKSPACE_ONLY ? 'workspace-only' : 'agent' });
    if (url.pathname === '/config') return json(response, 200, { ok: true, url: config.url, hasToken: true, originBound: Boolean(config.origin) });
    if (request.method === 'POST' && url.pathname === '/bootstrap/issue') {
      if (request.headers.origin || !validPersistentToken(request, url, config.token)) {
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

    try {
      if (request.method === 'GET' && url.pathname === '/events') {
        session.openEvents(url, response);
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
        return json(response, 200, { ok: true, ...crew.protocol() });
      }
      if (request.method === 'POST' && url.pathname === '/crew/intent') {
        const body = await readBody(request);
        const result = crew.submitIntent({
          intentText: body.intentJson || body.intentText,
          projectId: body.projectId,
          idempotencyKey: body.idempotencyKey,
          director: body.director || null,
        });
        return json(response, 200, { ok: true, ...result });
      }
      if (request.method === 'GET' && /^\/crew\/intent\/[^/]+$/.test(url.pathname)) {
        return json(response, 200, { ok: true, intent: crew.getIntent(decodeURIComponent(url.pathname.split('/').pop())) });
      }
      if (request.method === 'POST' && /^\/crew\/intent\/[^/]+\/cancel$/.test(url.pathname)) {
        const body = await readBody(request);
        const intentId = decodeURIComponent(url.pathname.split('/').slice(-2)[0]);
        const { intent, receipt, alreadyFinal } = crew.cancelIntent(intentId, body.reason);
        return json(response, 200, { ok: true, intent, receipt, alreadyFinal });
      }
      if (request.method === 'GET' && /^\/crew\/receipt\/[^/]+$/.test(url.pathname)) {
        return json(response, 200, { ok: true, receipt: crew.getReceipt(decodeURIComponent(url.pathname.split('/').pop())) });
      }
      if (request.method === 'GET' && url.pathname === '/crew/events') {
        const after = Number(url.searchParams.get('afterEventId') ?? url.searchParams.get('after') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 100);
        return json(response, 200, { ok: true, ...crew.listEvents({ afterEventId: after, limit }) });
      }
      if (request.method === 'POST' && url.pathname === '/director/bind') {
        const body = await readBody(request);
        const binding = crew.bindDirector({
          hostKind: resolveDirectorBinding(body.agentIdentity || body.host || body.hostKind)?.runtimeHostKind,
          sessionId: body.sessionId,
          hostInstanceId: body.hostInstanceId,
          projectId: body.projectId,
        });
        return json(response, 200, { ok: true, binding });
      }
      if (request.method === 'POST' && url.pathname === '/director/handoff') {
        const body = await readBody(request);
        const binding = crew.handoffDirector({
          hostKind: resolveDirectorBinding(body.agentIdentity || body.host || body.hostKind)?.runtimeHostKind,
          sessionId: body.sessionId,
          hostInstanceId: body.hostInstanceId,
          projectId: body.projectId,
          expectedBindingId: body.expectedBindingId,
        });
        return json(response, 200, { ok: true, binding });
      }
      if (request.method === 'GET' && url.pathname === '/director/status') {
        return json(response, 200, { ok: true, ...crew.directorStatus({
          hostKind: resolveDirectorBinding(url.searchParams.get('agentIdentity') || url.searchParams.get('host'))?.runtimeHostKind,
          sessionId: url.searchParams.get('sessionId') || undefined,
          projectId: url.searchParams.get('projectId') || undefined,
        }) });
      }
      if (request.method === 'POST' && url.pathname === '/director/unbind') {
        const body = await readBody(request);
        return json(response, 200, crew.unbindDirector({ bindingId: body.bindingId }));
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
          packageResponse = await fetch(new URL(`/api/skills/${encodeURIComponent(id)}/package.json`, hub.origin));
        } catch {
          return json(response, 502, { ok: false, error: { message: `无法从 Skill Hub 下载 ${id}。` } });
        }
        if (!packageResponse.ok) {
          return json(response, 502, { ok: false, error: { message: `Skill Hub 返回 HTTP ${packageResponse.status}。` } });
        }
        const pkg = await packageResponse.json().catch(() => null);
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
      if (error instanceof CrewServiceError) {
        const status = error.code === 'NOT_FOUND' ? 404
          : error.code === 'BINDING_CONFLICT' || error.code === 'IDEMPOTENCY_CONFLICT' ? 409
            : error.code === 'RECEIPT_PENDING' ? 202 : 400;
        return json(response, status, { ok: false, error: error.toJSON(), crew: true });
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
