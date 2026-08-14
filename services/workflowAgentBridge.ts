import { executeFlovartCommand } from '../tools/flovart/core.js';
import { canonicalize } from 'json-canonicalize';
import { useWorkflowStore } from '../components/workflow/store';
import type { WorkflowProject } from '../components/workflow/types';
import { getFlovartRuntimeApi, type RuntimeCommandEnvelope } from './flovartRuntime';
import { dispatchWorkflowCommand, redactWorkflowAgentValue, type WorkflowCommandEnvelope, type WorkflowCommandResult } from './workflowDispatcher';
import { workflowCommandSummary } from '../components/workflow/agentOps';
import { getWorkflowOperationCapabilityByNodeTool } from '../components/workflow/operationRegistry';

const RUNTIME_COMMANDS = new Set([
  'runtime.status', 'command.list', 'command.schema', 'provider.status',
  'production.dry-run', 'production.status', 'production.approve', 'production.run',
  'task.get', 'task.cancel', 'workflow.projection.get',
]);
const RUNTIME_CONFIRM_COMMANDS = new Set(['production.approve', 'production.run', 'task.cancel']);
const READ_COMMANDS = new Set(['runtime.status', 'status', 'provider.status', 'asset.list', 'workflow.project.list', 'workflow.inspect', 'command.list', 'command.schema']);
const WORKFLOW_READ_COMMANDS = new Set(['workflow.project.list', 'workflow.inspect']);
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
  confirmWrite?: (summary: string) => boolean | Promise<boolean>;
}

export function requiresRuntimeAgentConfirmation(command: string) {
  return RUNTIME_CONFIRM_COMMANDS.has(command);
}

export function runtimeAgentConfirmationSummary(envelope: WorkflowCommandEnvelope) {
  if (envelope.command === 'production.approve') {
    const gate = String(envelope.args.gateType || '未知门禁');
    const action = envelope.args.decision === 'rejected' ? '拒绝' : '批准';
    const limit = Number(envelope.args.hardLimitMicros);
    if (gate === 'run-budget' && Number.isFinite(limit)) return `${action} Production 预算上限 ¥${(limit / 1_000_000).toFixed(2)}`;
    if (gate === 'style-reference') {
      const stage = String(envelope.args.approvedStageKey || '未指定候选').slice(0, 200);
      return `${action} VOX 风格参考：${stage}`;
    }
    return `${action} Production 门禁：${gate}`;
  }
  if (envelope.command === 'production.run') return `开始 ProductionRun ${String(envelope.args.runId || '')}；已批准阶段将提交 Provider`;
  if (envelope.command === 'task.cancel') return `取消 Runtime Task ${String(envelope.args.taskId || '')}`;
  return envelope.command;
}

export function prepareRuntimeAgentEnvelope(envelope: WorkflowCommandEnvelope): RuntimeCommandEnvelope {
  const { idempotencyKey: legacyIdempotencyKey, ...args } = envelope.args;
  const idempotencyKey = envelope.idempotencyKey
    || (typeof legacyIdempotencyKey === 'string' ? legacyIdempotencyKey : undefined);
  return {
    protocolVersion: '1',
    commandId: envelope.id,
    command: envelope.command,
    args,
    actor: { kind: 'ui', instanceId: 'workflow_agent_bridge' },
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

export async function bindProductionDraftEnvelope(
  envelope: WorkflowCommandEnvelope,
  project: WorkflowProject,
): Promise<WorkflowCommandEnvelope> {
  if (envelope.command !== 'production.dry-run') return envelope;
  if (envelope.args.projectId !== project.id) throw new Error('Production Plan 与当前 Workflow 项目不匹配。');
  const requested = envelope.args.draftBinding;
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) {
    throw new Error('production.dry-run 必须绑定 workflow.inspect 返回的 Draft 版本与来源节点。');
  }
  const requestedBinding = requested as Record<string, unknown>;
  const draftVersion = Number(requestedBinding.draftVersion);
  const currentDraftVersion = project.draftVersion || 1;
  if (!Number.isInteger(draftVersion) || draftVersion !== currentDraftVersion) {
    throw new Error(`Draft 版本已变化：期望 v${draftVersion || '?'}, 当前 v${currentDraftVersion}；请重新读取 workflow.inspect。`);
  }
  const sourceNodeIds = Array.isArray(requestedBinding.sourceNodeIds)
    ? [...new Set(requestedBinding.sourceNodeIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : [];
  if (!sourceNodeIds.length) throw new Error('Production Plan 至少要绑定一个当前画布来源节点。');
  if (sourceNodeIds.length > 200) throw new Error('Production Plan 最多绑定 200 个画布来源节点。');
  const nodeById = new Map(project.nodes.map(node => [node.id, node]));
  const missing = sourceNodeIds.find(id => !nodeById.has(id));
  if (missing) throw new Error(`画布来源节点不存在：${missing}；请重新读取 workflow.inspect。`);
  const nodes = sourceNodeIds.map(id => nodeById.get(id)!);
  const sourceIds = new Set(sourceNodeIds);
  const connections = project.connections.filter(connection => sourceIds.has(connection.fromNodeId) && sourceIds.has(connection.toNodeId));
  const snapshot = redactWorkflowAgentValue({ projectId: project.id, draftVersion, nodes, connections });
  const snapshotHash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(snapshot))));
  const changeSetIds = (project.draftChangeSets || []).filter(changeSet => (
    changeSet.nodeChanges.some(change => sourceIds.has(change.id))
    || changeSet.connectionChanges.some(change => {
      const connection = change.after || change.before;
      return Boolean(connection && sourceIds.has(connection.fromNodeId) && sourceIds.has(connection.toNodeId));
    })
  )).map(changeSet => changeSet.id);
  return {
    ...envelope,
    args: {
      ...envelope.args,
      draftBinding: {
        schemaVersion: 'flovart.workflow-draft-binding/1',
        projectId: project.id,
        draftVersion,
        sourceNodeIds,
        objectVersions: Object.fromEntries(nodes.map(node => [node.id, node.objectVersion || 1])),
        changeSetIds,
        snapshotHash,
      },
    },
  };
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
      if (RUNTIME_COMMANDS.has(envelope.command)) {
        if (requiresRuntimeAgentConfirmation(envelope.command) && !await this.confirm(runtimeAgentConfirmationSummary(envelope))) {
          result = { ok: false, error: { code: 'DENIED', message: '用户拒绝了 Production Runtime 命令。' } };
        } else {
          const runtime = getFlovartRuntimeApi();
          if (!runtime) {
            result = { ok: false, error: { code: 'RUNTIME_UNAVAILABLE', message: 'Production Runtime 仅可通过 Tauri 桌面端调用。' } };
          } else if (envelope.command === 'runtime.status') {
            result = await runtime.status();
          } else {
            const projectId = typeof envelope.args.projectId === 'string' ? envelope.args.projectId : '';
            const project = useWorkflowStore.getState().projects.find(item => item.id === projectId);
            let boundEnvelope = envelope;
            if (envelope.command === 'production.dry-run') {
              if (!project) throw new Error('当前 Workflow 项目不存在。');
              boundEnvelope = await bindProductionDraftEnvelope(envelope, project);
            }
            result = await runtime.execute(prepareRuntimeAgentEnvelope(boundEnvelope));
          }
        }
      } else if (envelope.command.startsWith('workflow.')) {
        if (this.options.confirmWrite && !WORKFLOW_READ_COMMANDS.has(envelope.command)
          && !requiresHighRiskWorkflowConfirmation(envelope)
          && !await this.options.confirmWrite(workflowCommandSummary(envelope.command, envelope.args))) {
          result = { ok: false, commandId: envelope.id, error: { code: 'DENIED', message: '用户拒绝了 Workflow 变更。' } };
          await this.post('/workflow/result', { requestId, clientId: this.clientId, result });
          this.emit('tool_result', { requestId, command: envelope.command, result });
          return;
        }
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
          result = await executeFlovartCommand(envelope.command, envelope.args, {});
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

function requiresHighRiskWorkflowConfirmation(envelope: WorkflowCommandEnvelope) {
  if (envelope.command === 'workflow.project.delete' || envelope.command === 'workflow.node.delete' || envelope.command === 'workflow.node.run') return true;
  if (envelope.command !== 'workflow.node.tool') return false;
  const tool = String(envelope.args.tool || '');
  return getWorkflowOperationCapabilityByNodeTool(tool)?.confirmation !== 'none';
}
