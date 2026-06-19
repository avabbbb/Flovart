import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

function codexCommand() {
  try {
    return { command: process.execPath, args: [path.join(path.dirname(require.resolve('@openai/codex/package.json')), 'bin', 'codex.js')] };
  } catch {
    const globalBin = process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (globalBin && existsSync(globalBin)) return { command: process.execPath, args: [globalBin] };
    return { command: process.platform === 'win32' ? 'codex.cmd' : 'codex', args: [] };
  }
}

export class CodexAppServer {
  constructor(emit) {
    this.emit = emit;
    this.nextId = 1;
    this.buffer = '';
    this.pending = new Map();
    this.activeTurns = new Map();
    this.completedTurns = new Map();
    this.child = null;
  }

  async start() {
    if (this.child) return this;
    const launcher = codexCommand();
    this.child = spawn(launcher.command, [...launcher.args, 'app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child.stdout.on('data', chunk => this.read(chunk.toString()));
    this.child.stderr.on('data', chunk => this.emit('agent_log', { text: chunk.toString() }));
    this.child.on('error', error => this.emit('agent_error', { message: error.message }));
    this.child.on('exit', code => {
      this.pending.forEach(item => item.reject(new Error(`Codex app-server exited: ${code ?? 0}`)));
      this.activeTurns.forEach(item => item.reject(new Error(`Codex app-server exited: ${code ?? 0}`)));
      this.pending.clear();
      this.activeTurns.clear();
      this.child = null;
      this.emit('agent_log', { text: `Codex app-server exited: ${code ?? 0}` });
    });
    await this.request('initialize', { clientInfo: { name: 'flovart-agent', title: 'Flovart Agent', version: '0.2.0' }, capabilities: { experimentalApi: true, requestAttestation: false } });
    this.notify('initialized');
    return this;
  }

  mcpConfig() {
    return { mcp_servers: { flovart: { command: process.execPath, args: [fileURLToPath(new URL('./index.js', import.meta.url)), 'mcp'], default_tools_approval_mode: 'prompt', startup_timeout_sec: 20, tool_timeout_sec: 90 } } };
  }

  async startThread(cwd) {
    const result = await this.request('thread/start', { cwd, approvalPolicy: 'never', sandbox: 'workspace-write', config: this.mcpConfig(), threadSource: 'user' });
    return result.thread;
  }

  async resumeThread(threadId, cwd) {
    const result = await this.request('thread/resume', { threadId, cwd, approvalPolicy: 'never', sandbox: 'workspace-write', config: this.mcpConfig() });
    return result.thread;
  }

  listThreads(searchTerm = '', cwd) {
    return this.request('thread/list', { limit: 50, sortKey: 'updated_at', sortDirection: 'desc', sourceKinds: ['cli', 'vscode', 'appServer', 'exec'], searchTerm, ...(cwd ? { cwd } : {}) });
  }

  readThread(threadId) {
    return this.request('thread/read', { threadId, includeTurns: true });
  }

  archiveThread(threadId) {
    return this.request('thread/archive', { threadId });
  }

  async startTurn(threadId, prompt, images = []) {
    const result = await this.request('turn/start', { threadId, input: [{ type: 'text', text: prompt, text_elements: [] }, ...images.map(file => ({ type: 'localImage', path: file }))], approvalPolicy: 'never' });
    const turnId = String(result?.turn?.id || result?.id || '');
    if (!turnId) throw new Error('Codex app-server 没有返回 turn id');
    if (this.completedTurns.has(turnId)) {
      const completed = this.completedTurns.get(turnId);
      this.completedTurns.delete(turnId);
      if (completed) throw completed;
      return result;
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.activeTurns.delete(turnId); reject(new Error('Codex turn timed out')); }, 15 * 60_000);
      this.activeTurns.set(turnId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    });
    return result;
  }

  request(method, params) {
    const id = this.nextId++;
    if (!this.child?.stdin) return Promise.reject(new Error('Codex app-server 尚未启动'));
    this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex request timed out: ${method}`)); }, 30000);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    });
  }

  notify(method, params) {
    this.child?.stdin.write(`${JSON.stringify(params === undefined ? { method } : { method, params })}\n`);
  }

  read(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    lines.filter(Boolean).forEach(line => {
      try { this.handle(JSON.parse(line)); }
      catch { this.emit('agent_log', { text: line }); }
    });
  }

  handle(message) {
    if (message.id && this.pending.has(Number(message.id))) {
      const pending = this.pending.get(Number(message.id));
      this.pending.delete(Number(message.id));
      message.error ? pending.reject(new Error(message.error.message || 'Codex request failed')) : pending.resolve(message.result);
      return;
    }
    if (message.id && message.method) {
      const toolName = String(message.params?.toolName || message.params?.name || message.params?.item?.tool || '');
      const result = message.method === 'mcpServer/elicitation/request'
        ? { action: 'decline', content: {}, _meta: null }
        : { decision: toolName.includes('flovart') ? 'accept' : 'decline' };
      this.child?.stdin.write(`${JSON.stringify({ id: message.id, result })}\n`);
      return;
    }
    if (message.method) {
      const params = message.params || {};
      const turnId = String(params.turn?.id || params.turnId || '');
      if ((message.method === 'turn/completed' || message.method === 'turn/failed') && turnId) {
        const failed = message.method === 'turn/failed' || params.turn?.status === 'failed';
        const failure = failed ? new Error(params.error?.message || params.turn?.error?.message || 'Codex turn failed') : null;
        const active = this.activeTurns.get(turnId);
        if (active) {
          this.activeTurns.delete(turnId);
          failure ? active.reject(failure) : active.resolve(params.turn);
        } else {
          this.completedTurns.set(turnId, failure);
        }
      }
      this.emit('agent_event', { method: message.method, params });
    }
  }

  close() {
    this.activeTurns.forEach(item => item.reject(new Error('Codex app-server closed')));
    this.activeTurns.clear();
    this.child?.kill();
    this.child = null;
  }
}
