import { executeFlovartCommand } from '../tools/flovart/core.js';
import { getFlovartRuntimeApi } from './flovartRuntime';
import { dispatchWorkflowCommand, redactWorkflowAgentValue, type WorkflowCommandEnvelope, type WorkflowCommandResult } from './workflowDispatcher';

const READ_COMMANDS = new Set(['status', 'provider.status', 'canvas.inspect', 'canvas.list-media', 'asset.list', 'workflow.project.list', 'workflow.inspect', 'command.list', 'command.schema']);
const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 24 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 45_000;

export interface WorkflowAgentAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  previewUrl?: string;
}

export function redactWorkflowAgentSnapshot<T>(snapshot: T): T {
  return redactWorkflowAgentValue(snapshot);
}

export function validateWorkflowAgentAttachments(attachments: WorkflowAgentAttachment[]) {
  if (attachments.length > MAX_ATTACHMENTS) throw new Error(`最多上传 ${MAX_ATTACHMENTS} 张图片。`);
  let total = 0;
  attachments.forEach(attachment => {
    if (!attachment.type.startsWith('image/')) throw new Error(`仅支持图片附件：${attachment.name}`);
    if (!Number.isFinite(attachment.size) || attachment.size <= 0 || attachment.size > MAX_ATTACHMENT_BYTES) throw new Error(`单张图片不能超过 8MB：${attachment.name}`);
    if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(attachment.dataUrl)) throw new Error(`图片附件格式无效：${attachment.name}`);
    total += attachment.size;
  });
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('图片附件总大小不能超过 24MB。');
}

export interface WorkflowAgentBridgeOptions {
  url: string;
  token: string;
  onEvent?: (type: string, payload: any) => void;
  onStatus?: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
  confirm?: (summary: string) => boolean | Promise<boolean>;
}

export class WorkflowAgentBridge {
  private eventSource: EventSource | null = null;
  private readonly clientId = crypto.randomUUID();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private enabled = false;

  constructor(private options: WorkflowAgentBridgeOptions) {}

  connect() {
    this.enabled = true;
    this.openEvents();
  }

  disconnect() {
    this.enabled = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.eventSource?.close();
    this.eventSource = null;
    this.options.onStatus?.('disconnected');
  }

  async pushSnapshot(snapshot: unknown) {
    return this.post('/workflow/state', redactWorkflowAgentSnapshot(snapshot), { clientId: this.clientId });
  }

  async sendPrompt(input: { projectId: string; prompt: string; threadId?: string; attachments?: WorkflowAgentAttachment[] }) {
    const attachments = input.attachments || [];
    validateWorkflowAgentAttachments(attachments);
    return this.post('/agent/codex/turn', {
      projectId: input.projectId,
      prompt: input.prompt,
      threadId: input.threadId,
      attachments: attachments.map(({ name, type, size, dataUrl }) => ({ name, type, size, dataUrl })),
    });
  }

  async listThreads(projectId: string, searchTerm = '') {
    const url = new URL('/agent/codex/threads', this.options.url);
    url.searchParams.set('projectId', projectId);
    if (searchTerm) url.searchParams.set('searchTerm', searchTerm);
    return this.request(url, { method: 'GET' });
  }

  async newThread(projectId: string) {
    return this.post('/agent/codex/threads/new', { projectId });
  }

  async readThread(projectId: string, threadId: string) {
    const url = new URL(`/agent/codex/threads/${encodeURIComponent(threadId)}`, this.options.url);
    url.searchParams.set('projectId', projectId);
    return this.request(url, { method: 'GET' });
  }

  async resumeThread(projectId: string, threadId: string) {
    return this.post(`/agent/codex/threads/${encodeURIComponent(threadId)}/resume`, { projectId });
  }

  async archiveThread(projectId: string, threadId: string) {
    return this.post(`/agent/codex/threads/${encodeURIComponent(threadId)}/archive`, { projectId });
  }

  private openEvents() {
    if (!this.enabled) return;
    this.eventSource?.close();
    this.options.onStatus?.('connecting');
    const url = new URL('/events', this.options.url);
    url.searchParams.set('token', this.options.token);
    url.searchParams.set('clientId', this.clientId);
    const source = new EventSource(url);
    this.eventSource = source;
    source.addEventListener('hello', event => {
      this.reconnectAttempt = 0;
      this.options.onStatus?.('connected');
      this.emit('hello', this.parseEvent(event));
    });
    source.addEventListener('ping', event => this.emit('ping', this.parseEvent(event)));
    source.addEventListener('tool_call', event => void this.handleToolCall(this.parseEvent(event)));
    ['agent_event', 'agent_log', 'agent_error', 'agent_done'].forEach(type => source.addEventListener(type, event => this.emit(type, this.parseEvent(event))));
    source.onerror = () => {
      source.close();
      if (this.eventSource === source) this.eventSource = null;
      if (!this.enabled) return;
      this.options.onStatus?.('error');
      const delay = Math.min(15_000, 500 * (2 ** this.reconnectAttempt++));
      this.reconnectTimer = setTimeout(() => this.openEvents(), delay);
    };
  }

  private parseEvent(event: Event) {
    try { return JSON.parse((event as MessageEvent).data); }
    catch { return { message: 'Agent 返回了无效事件。' }; }
  }

  private emit(type: string, payload: unknown) {
    this.options.onEvent?.(type, redactWorkflowAgentValue(payload));
  }

  private async handleToolCall(payload: { requestId?: unknown; envelope?: WorkflowCommandEnvelope }) {
    const requestId = String(payload?.requestId || '');
    const envelope = payload?.envelope;
    if (!requestId || !envelope) return;
    try {
      let result: any;
      if (envelope.command.startsWith('workflow.')) {
        result = await dispatchWorkflowCommand(envelope);
        if (result.confirmation?.required) {
          const approved = await this.confirm(result.confirmation.summary);
          result = approved
            ? await dispatchWorkflowCommand({ ...envelope, args: { ...envelope.args, confirmed: true } })
            : { ok: false, commandId: envelope.id, error: { code: 'DENIED', message: '用户拒绝了 Workflow 变更。' } } satisfies WorkflowCommandResult;
        }
      } else {
        if (!READ_COMMANDS.has(envelope.command) && !await this.confirm(envelope.command)) {
          result = { ok: false, error: { code: 'DENIED', message: '用户拒绝了命令。' } };
        } else {
          result = await executeFlovartCommand(envelope.command, envelope.args, getFlovartRuntimeApi() as any);
        }
      }
      await this.post('/workflow/result', { requestId, clientId: this.clientId, result });
      this.emit('tool_result', { requestId, command: envelope.command, result });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      try { await this.post('/workflow/result', { requestId, clientId: this.clientId, error: message }); } catch { /* SSE reconnect will surface the transport error. */ }
      this.emit('tool_result', { requestId, command: envelope.command, error: message });
    }
  }

  private confirm(summary: string) {
    return this.options.confirm ? this.options.confirm(summary) : window.confirm(`Agent 请求执行：${summary}`);
  }

  private post(path: string, body: unknown, params?: Record<string, string>) {
    const url = new URL(path, this.options.url);
    Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, value));
    return this.request(url, { method: 'POST', body: JSON.stringify(body) });
  }

  private async request(url: URL, init: RequestInit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { 'content-type': 'application/json', 'x-flovart-agent-token': this.options.token, ...(init.headers || {}) },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok === false) throw new Error(body.error?.message || body.error || `Agent 请求失败：${response.status}`);
      return body;
    } catch (cause) {
      if (controller.signal.aborted) throw new Error('Agent 请求超时。');
      throw cause;
    } finally {
      clearTimeout(timer);
    }
  }
}
