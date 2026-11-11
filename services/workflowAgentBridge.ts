import { requestUiConfirm } from './uiConfirm';
import { executeFlovartCommand } from '../tools/flovart/core.js';
import { canonicalize } from 'json-canonicalize';
import { useWorkflowStore } from '../components/workflow/store';
import type { WorkflowNode, WorkflowProject } from '../components/workflow/types';
import { getFlovartRuntimeApi, type RuntimeCommandEnvelope } from './flovartRuntime';
import { createBrowserWorkflowContract, type BrowserWorkflowContract } from './browserWorkflowContract';
import { AgentRuntimeError, getBrowserAgentRuntime } from './browserAgentRuntime';
import { redactWorkflowAgentValue, withWorkflowHumanApproval, type WorkflowCommandEnvelope, type WorkflowCommandResult } from './workflowDispatcher';
import { workflowCommandSummary } from '../components/workflow/agentOps';
import { getWorkflowOperationCapabilityByNodeTool } from '../components/workflow/operationRegistry';
import { displayError } from './displayError';
import { buildGenerationGateSummary, getGenerationGateDetails, type GenerationGateDetails } from './generationGate';
import { planBlocked, type AgentConfirmRequest } from './agentSpendMandate';
import { applyPlanChecks, buildGenerationPlanChecks } from './generationPlan';
import type { UserApiKey as GateApiKey } from '../types';

let agentGateKeysProvider: () => GateApiKey[] = () => [];
/** 面板注入当前 API Key，让 Agent 确认摘要能估算费用；未注入时费用显示为未知。 */
export function setAgentGateKeysProvider(provider: (() => GateApiKey[]) | null) {
  agentGateKeysProvider = provider || (() => []);
}
function agentGateKeys(): GateApiKey[] {
  try { return agentGateKeysProvider(); } catch { return []; }
}

const RUNTIME_COMMANDS = new Set([
  'runtime.status', 'command.list', 'command.schema', 'provider.status',
  'production.dry-run', 'production.status', 'production.approve', 'production.run',
  'task.get', 'task.cancel', 'workflow.projection.get',
]);
const RUNTIME_CONFIRM_COMMANDS = new Set(['production.approve', 'production.run', 'task.cancel']);
const READ_COMMANDS = new Set(['runtime.status', 'status', 'provider.status', 'asset.list', 'workflow.project.list', 'workflow.inspect', 'workflow.selection.get', 'workflow.focus.nodes', 'command.list', 'command.schema']);
const WORKFLOW_READ_COMMANDS = new Set(['workflow.project.list', 'workflow.inspect', 'workflow.selection.get', 'workflow.focus.nodes']);
const REQUEST_TIMEOUT_MS = 45_000;

export function redactWorkflowAgentSnapshot<T>(snapshot: T): T {
  return redactWorkflowAgentValue(snapshot);
}

export interface WorkflowAgentBridgeOptions {
  url: string;
  token: string;
  onEvent?: (type: string, payload: any) => void;
  onStatus?: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
  confirm?: (summary: string, request?: AgentConfirmRequest) => boolean | Promise<boolean>;
  confirmWrite?: (summary: string, request?: AgentConfirmRequest) => boolean | Promise<boolean>;
  workflowContract?: BrowserWorkflowContract;
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

function workflowRunNodes(envelope: WorkflowCommandEnvelope) {
  const state = useWorkflowStore.getState();
  const projectId = String(envelope.args.projectId || state.activeProjectId || '');
  const project = state.projects.find(item => item.id === projectId);
  const rawIds = envelope.args.nodeIds;
  const nodeIds = Array.isArray(rawIds)
    ? rawIds.map(String)
    : typeof rawIds === 'string' ? rawIds.split(',').map(value => value.trim()).filter(Boolean) : [String(envelope.args.nodeId || envelope.args.id || '')];
  const nodes = nodeIds.flatMap(nodeId => {
    const node = project?.nodes.find(item => item.id === nodeId);
    return node ? [node] : [];
  });
  return { nodeIds, nodes, project };
}

/** 结构化确认请求：自动模式的付费授权只认 generation，且要求每个目标节点都能解析。 */
export function workflowConfirmRequest(envelope: WorkflowCommandEnvelope): AgentConfirmRequest {
  if (envelope.command === 'workflow.node.run') {
    const { nodeIds, nodes, project } = workflowRunNodes(envelope);
    return {
      kind: 'generation',
      command: envelope.command,
      args: envelope.args,
      gates: nodes.length === nodeIds.length ? nodes.map(node => agentPlanGate(node, project)) : [],
    };
  }
  if (envelope.command.endsWith('.delete')) return { kind: 'destructive', command: envelope.command, args: envelope.args };
  const operations = envelope.args.operations || envelope.args.ops;
  if (envelope.command === 'workflow.apply' && Array.isArray(operations)
    && operations.some(op => (op as { type?: string } | null)?.type === 'delete_nodes')) {
    return { kind: 'destructive', command: envelope.command, args: envelope.args };
  }
  return { kind: 'other', command: envelope.command, args: envelope.args };
}

/** 与画布入口同一份计划：门禁详情 + 提交前检查；操作节点（recipe）不预检，运行时仍兜底。 */
function agentPlanGate(
  node: WorkflowNode,
  project: WorkflowProject | undefined,
): GenerationGateDetails {
  const keys = agentGateKeys();
  const details = getGenerationGateDetails(node, undefined, keys);
  if (!project || node.metadata.operation) return details;
  return applyPlanChecks(details, buildGenerationPlanChecks({ node, project, keys, mode: details.mediaType }));
}

/** CLI/无宿主时的文本 body：与卡同一份计划，blocker 与提醒逐条列出。 */
export function planGateText(details: GenerationGateDetails) {
  return [
    buildGenerationGateSummary(details),
    ...(details.blockers ?? []).map(item => '无法生成：' + item.message),
    ...(details.warnings ?? []).map(item => '注意：' + item.message),
  ].join('\n');
}

function workflowConfirmationSummary(envelope: WorkflowCommandEnvelope) {
  if (envelope.command === 'workflow.node.run') {
    const { nodeIds, nodes, project } = workflowRunNodes(envelope);
    if (nodeIds.length === 1 && nodes.length === 1) return planGateText(agentPlanGate(nodes[0], project));
    if (nodes.length > 1) {
      const gates = nodes.map(node => agentPlanGate(node, project));
      const blocked = nodes.filter((_, index) => gates[index].blockers?.length).map(node => '「' + node.title + '」');
      return [
        '批量运行 ' + nodes.length + ' 个节点，一次确认覆盖本批：',
        ...(blocked.length ? ['以下节点无法生成，整批不可批准：' + blocked.join('、')] : []),
        ...nodes.map((node, index) => '「' + node.title + '」\n' + planGateText(gates[index])),
      ].join('\n\n');
    }
  }
  return workflowCommandSummary(envelope.command, envelope.args);
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

export function validateBrowserWorkspaceLease(envelope: WorkflowCommandEnvelope, clientId: string, now = Date.now()): WorkflowCommandResult | null {
  const lease = envelope.workspaceLease;
  if (!lease || !envelope.command.startsWith('workflow.')) return null;
  const state = useWorkflowStore.getState();
  const projectId = String(envelope.args.projectId || lease.projectId || '');
  const project = state.projects.find(item => item.id === lease.projectId);
  if (lease.expiresAt <= now) return { ok: false, commandId: envelope.id, error: { code: 'LEASE_EXPIRED', message: 'Workflow Lease 已过期，请重新开始任务。' } };
  if (lease.clientId !== clientId) return { ok: false, commandId: envelope.id, error: { code: 'LEASE_TARGET_CHANGED', message: 'Workflow Lease 的 Browser Writer 已改变。' } };
  if (projectId !== lease.projectId || state.activeProjectId !== lease.projectId) {
    return { ok: false, commandId: envelope.id, error: { code: 'LEASE_TARGET_CHANGED', message: '当前 Active Workflow 项目已改变，请结束当前任务后重新开始。' } };
  }
  if (!project) return { ok: false, commandId: envelope.id, error: { code: 'WORKSPACE_UNAVAILABLE', message: 'Workflow 项目已经不可用。' } };
  const expectedRevision = envelope.args.expectedRevision;
  const currentRevision = project.draftVersion || 1;
  if (expectedRevision !== undefined && Number(expectedRevision) !== currentRevision) {
    return { ok: false, commandId: envelope.id, error: { code: 'REVISION_CONFLICT', message: `Workflow 草稿版本已变化：期望 ${expectedRevision}，当前 ${currentRevision}。`, expectedRevision: Number(expectedRevision), actualRevision: currentRevision } };
  }
  return null;
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
  private readonly workflowContract: BrowserWorkflowContract;

  constructor(private options: WorkflowAgentBridgeOptions) {
    this.workflowContract = options.workflowContract || createBrowserWorkflowContract();
  }

  getClientId(): string {
    return this.clientId;
  }

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

  async activateWriter(projectId?: string) {
    return this.post('/workflow/activate', { clientId: this.clientId, ...(projectId ? { projectId } : {}) });
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
    ['agent_event', 'agent_log', 'agent_error', 'agent_done', 'writer_changed', 'writer_unavailable', 'host_writer_changed', 'activity', 'receipt'].forEach(type => source.addEventListener(type, event => this.emit(type, this.parseEvent(event))));
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
      const leaseFailure = validateBrowserWorkspaceLease(envelope, this.clientId);
      if (leaseFailure) {
        result = leaseFailure;
      } else if (envelope.command === 'agent.turn') {
        result = await this.runDelegatedAgentTurn(envelope);
      } else if (RUNTIME_COMMANDS.has(envelope.command)) {
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
        const highRisk = requiresHighRiskWorkflowConfirmation(envelope);
        const operatorDraftOnly = envelope.source === 'operator' && !highRisk;
        if (this.options.confirmWrite && !WORKFLOW_READ_COMMANDS.has(envelope.command) && !highRisk && !operatorDraftOnly
          && !await this.options.confirmWrite(workflowCommandSummary(envelope.command, envelope.args), { ...workflowConfirmRequest(envelope), risk: 'write' })) {
          result = { ok: false, commandId: envelope.id, error: { code: 'DENIED', message: '用户拒绝了 Workflow 变更。' } };
          await this.post('/workflow/result', { requestId, clientId: this.clientId, result });
          this.emit('tool_result', { requestId, command: envelope.command, result });
          return;
        }
        // Gap #14 hardening — sidecar lease blind window:
        // 入口处的 validateBrowserWorkspaceLease 只在收到 tool_call 时跑一次；
        // confirm/confirmWrite 是异步人审，期间 lease 可能 expiresAt 过期或
        // activeProject/clientId 被其它写入者抢占。dispatch 前必须复核一次，
        // 否则确认通过后会带着已失效的 Lease 落写。
        const leaseRecheck = validateBrowserWorkspaceLease(envelope, this.clientId);
        if (leaseRecheck) {
          result = leaseRecheck;
          await this.post('/workflow/result', { requestId, clientId: this.clientId, result });
          this.emit('tool_result', { requestId, command: envelope.command, result });
          return;
        }
        result = await this.workflowContract.dispatch(envelope);
        if (result.confirmation?.required) {
          const approved = await this.confirm(workflowConfirmationSummary(envelope), workflowConfirmRequest(envelope));
          // 第二道确认同样可能耗时——Lease 在批准后仍需再验一次。
          const postApprovalLease = approved ? validateBrowserWorkspaceLease(envelope, this.clientId) : null;
          result = !approved
            ? { ok: false, commandId: envelope.id, error: { code: 'DENIED', message: '用户拒绝了 Workflow 变更。' } } satisfies WorkflowCommandResult
            : postApprovalLease
              ? postApprovalLease
              : await this.workflowContract.dispatch(withWorkflowHumanApproval(envelope));
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
      const message = displayError(cause, 'Agent 命令执行失败。');
      try { await this.post('/workflow/result', { requestId, clientId: this.clientId, error: message }); } catch { /* SSE reconnect will surface the transport error. */ }
      this.emit('tool_result', { requestId, command: envelope.command, error: message });
    }
  }

  /** 外部 Agent 委派一轮内置对话：默认只读，写委派先问用户，结果只回摘要。 */
  private async runDelegatedAgentTurn(envelope: WorkflowCommandEnvelope): Promise<WorkflowCommandResult> {
    const args = envelope.args || {};
    const projectId = String(args.projectId || useWorkflowStore.getState().activeProjectId || '');
    const runtime = getBrowserAgentRuntime(projectId);
    if (!runtime) {
      return { ok: false, commandId: envelope.id, error: { code: 'AGENT_RUNTIME_UNAVAILABLE', message: '内置 Agent 尚未打开或没有可用的文本线路。' } };
    }
    const policy = args.policy === 'workspace-write' ? 'workspace-write' as const : 'read-only' as const;
    if (policy === 'workspace-write') {
      const approved = await this.confirm(`外部 Agent 请求让内置 Agent 修改画布：${String(args.prompt || '').slice(0, 160)}`);
      if (!approved) return { ok: false, commandId: envelope.id, error: { code: 'DENIED', message: '用户拒绝了委派回合。' } };
    }
    try {
      const turn = await runtime.runDelegatedTurn({
        prompt: String(args.prompt || ''),
        sessionId: typeof args.sessionId === 'string' && args.sessionId ? args.sessionId : undefined,
        policy,
        mutationId: String(args.mutationId || envelope.idempotencyKey || envelope.id),
        caller: envelope.caller?.agentIdentity,
      });
      return { ok: true, commandId: envelope.id, result: turn };
    } catch (cause) {
      const code = cause instanceof AgentRuntimeError ? cause.code : 'AGENT_TURN_FAILED';
      return { ok: false, commandId: envelope.id, error: { code, message: displayError(cause, '委派回合失败。') } };
    }
  }

  private confirm(summary: string, request?: AgentConfirmRequest) {
    if (this.options.confirm) return this.options.confirm(summary, request);
    const items = request?.kind === 'generation' ? [...(request.gates ?? [])] : [];
    const blocked = planBlocked(request);
    return requestUiConfirm({
      title: blocked ? '暂时无法生成' : 'Agent 请求执行',
      body: summary,
      ...(items.length ? { plan: { items } } : {}),
      confirmDisabled: blocked,
      confirmLabel: '允许',
      cancelLabel: blocked ? '关闭' : '拒绝',
    });
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
