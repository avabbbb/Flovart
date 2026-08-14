import crypto from 'node:crypto';

const sendEvent = (response, type, payload) => response.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);

export class WorkflowAgentSession {
  constructor({ timeoutMs = 60000 } = {}) {
    this.timeoutMs = timeoutMs;
    this.clients = new Map();
    this.pending = new Map();
    this.snapshot = null;
  }

  health() {
    return {
      ok: true,
      hasWorkflow: Boolean(this.snapshot),
      clients: this.clients.size,
      pending: this.pending.size,
      activeProjectId: this.snapshot?.id || null,
      snapshotUpdatedAt: this.snapshot?.snapshotUpdatedAt || null,
    };
  }

  openEvents(url, response) {
    const clientId = url.searchParams.get('clientId') || crypto.randomUUID();
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    this.clients.set(clientId, response);
    sendEvent(response, 'hello', { ok: true, clientId });
    const timer = setInterval(() => sendEvent(response, 'ping', { time: Date.now() }), 15000);
    response.on('close', () => {
      clearInterval(timer);
      this.clients.delete(clientId);
      if (this.snapshot?.clientId === clientId) this.snapshot = null;
      this.pending.forEach((pending, requestId) => {
        if (pending.clientId !== clientId) return;
        this.pending.delete(requestId);
        pending.reject(new Error('Flovart 浏览器连接已断开'));
      });
    });
  }

  updateSnapshot(snapshot, clientId) {
    this.snapshot = {
      ...(snapshot && typeof snapshot === 'object' ? snapshot : {}),
      clientId,
      snapshotUpdatedAt: new Date().toISOString(),
    };
  }

  emit(type, payload) {
    this.clients.forEach((client, clientId) => {
      try { sendEvent(client, type, payload); }
      catch {
        this.clients.delete(clientId);
        try { client.end(); } catch { /* connection already closed */ }
      }
    });
  }

  resolveResult({ requestId, clientId, result, error }) {
    const pending = requestId ? this.pending.get(requestId) : null;
    if (!pending) return false;
    if (clientId && pending.clientId !== clientId) return false;
    this.pending.delete(requestId);
    error ? pending.reject(new Error(typeof error === 'string' ? error : error.message || 'Workflow command failed')) : pending.resolve(result);
    return true;
  }

  async callCommand(command, args = {}, source = 'mcp', idempotencyKey, signal) {
    const clientId = this.clients.has(this.snapshot?.clientId) ? this.snapshot.clientId : null;
    const client = this.clients.get(clientId);
    if (!client) throw new Error('当前没有已连接并同步项目的 Flovart Workflow');
    if (signal?.aborted) throw new Error('Workflow 操作已取消');
    const requestId = crypto.randomUUID();
    const envelope = { id: requestId, command, args, source, idempotencyKey: idempotencyKey || args.idempotencyKey };
    sendEvent(client, 'tool_call', { requestId, envelope });
    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', onAbort);
      const onAbort = () => {
        this.pending.delete(requestId);
        cleanup();
        reject(new Error('Workflow 操作已取消'));
      };
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        cleanup();
        reject(new Error('Workflow 操作超时'));
      }, this.timeoutMs);
      this.pending.set(requestId, {
        clientId,
        resolve: value => { clearTimeout(timer); cleanup(); resolve(value); },
        reject: error => { clearTimeout(timer); cleanup(); reject(error); },
      });
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
