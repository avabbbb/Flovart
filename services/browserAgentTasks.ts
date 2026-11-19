// 内置 Agent 的后台任务（与本机 Agent 的 agent.task.* 同一个任务层、同一份工具定义）。
// 长命令（批量 / 整组生成、视频、导出…）不再把这一轮对话卡住几分钟：
// 先在当前回合完成审批（策略层 + 付费确认卡），批准后才放进后台执行，立即返回 taskId；
// 之后的回合用 iris_task_get 轮询、iris_task_cancel 取消（会停止它启动的画布节点）。
// 任务按项目写进浏览器任务台账（IndexedDB）：刷新页面后任务仍可 get / cancel，在途任务按画布节点
// 状态对账（视频任务由 App 的刷新恢复续接上游，这里跟随节点状态），无法确认是否已提交的标为 unknown_submit。
import { createAgentTaskLayer, AgentTaskError, TASKABLE_COMMANDS } from '../agent/task-layer.js';
import { AGENT_BROWSER_COMMANDS } from '../tools/iris/agent-surface.js';
import type { WorkflowCommandEnvelope, WorkflowCommandResult } from './workflowDispatcher';
import { withWorkflowHumanApproval } from './workflowDispatcher';
import { createBrowserAgentTaskStore, type AgentTaskLedgerStore } from './agentTaskStore';
import { useWorkflowStore } from '../components/workflow/store';

type Dispatch = (envelope: WorkflowCommandEnvelope) => Promise<WorkflowCommandResult>;
type TaskView = Record<string, unknown>;

/** 内置 Agent 能放到后台的命令：任务层可包装、且浏览器命令面有的（不含 agent.turn）。 */
export const BROWSER_TASKABLE_COMMANDS: readonly string[] = Object.freeze(
  TASKABLE_COMMANDS.filter(command => (AGENT_BROWSER_COMMANDS as readonly string[]).includes(command)),
);

interface BrowserTaskCaller {
  agentIdentity: 'builtin';
  /** 已在启动前完成用户确认：后台执行时带人工批准重发，不再弹卡。 */
  approved: boolean;
}

export interface BrowserAgentTaskLayer {
  /** 台账加载与首次对账完成（start / get 之前会自动等待）。 */
  ready: Promise<void>;
  /** resubmit：用户已确认重新提交刷新前状态未知的同参数任务。 */
  start(input: { command: string; args: Record<string, unknown>; idempotencyKey?: string; approved: boolean; resubmit?: boolean }): Promise<TaskView>;
  get(input: { taskId: string; afterSeq?: number }): Promise<TaskView>;
  cancel(input: { taskId: string; reason?: string }): Promise<TaskView>;
  settled(taskId: string): Promise<void>;
  /** 同一幂等键已经启动过的任务（还在保留期内），用来在重试时跳过第二张确认卡。 */
  existing(idempotencyKey: string): Promise<TaskView | null>;
  /** 同命令、同规范化参数的在途 / 提交状态未知任务（含刷新前的）。 */
  inflight(input: { command: string; args: Record<string, unknown> }): Promise<TaskView | null>;
  /** 按节点状态对账一次（测试 / 手动刷新）。 */
  reconcile(): Promise<void>;
}

// task-layer.js 是 JS，参数类型由默认值推断得过窄；这里写明实际用到的形状。
interface TaskLayer {
  ready: Promise<void>;
  start(input: { command: string; args: Record<string, unknown>; idempotencyKey?: string; source: string; caller: BrowserTaskCaller; resubmit?: boolean }): TaskView;
  get(input: { taskId: string; afterSeq?: number }): TaskView;
  cancel(input: { taskId: string; reason?: string; source: string }): Promise<TaskView>;
  settled(taskId: string): Promise<void>;
  inflight(input: { command: string; args: Record<string, unknown>; source: string; caller: BrowserTaskCaller }): TaskView | null;
  reconcile(): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserAgentTaskOptions {
  /** 任务台账；缺省为 IndexedDB（按项目）。 */
  store?: AgentTaskLedgerStore | null;
  /** 读取项目节点（对账用）；缺省读画布 store。 */
  getNodes?: (projectId: string) => readonly unknown[] | null;
  pollMs?: number;
}

const layers = new Map<string, { layer: TaskLayer; ref: { dispatch: Dispatch }; byKey: Map<string, string> }>();

function envelopeFor(command: string, args: Record<string, unknown>, idempotencyKey: string | undefined, projectId: string): WorkflowCommandEnvelope {
  return {
    id: crypto.randomUUID(),
    command,
    args: { ...args, projectId, workspaceMode: 'browser' },
    source: 'agent',
    ...(idempotencyKey ? { idempotencyKey } : {}),
  } as WorkflowCommandEnvelope;
}

function canvasNodes(projectId: string): readonly unknown[] | null {
  const project = useWorkflowStore.getState().projects.find(item => item.id === projectId);
  return project ? project.nodes : null;
}

const CALLER: BrowserTaskCaller = { agentIdentity: 'builtin', approved: false };

/**
 * 每个项目一个任务层，跨回合保留（Agent 下一轮还能 get / cancel），刷新后从台账恢复。
 * dispatch 每次取最新的（命令面实例按回合重建）。
 */
export function browserAgentTaskLayer(projectId: string, dispatch: Dispatch, options: BrowserAgentTaskOptions = {}): BrowserAgentTaskLayer {
  let entry = layers.get(projectId);
  if (!entry) {
    const ref = { dispatch };
    const getNodes = options.getNodes ?? canvasNodes;
    const layer = createAgentTaskLayer({
      run: async (command: string, args: Record<string, unknown>, _source: string, idempotencyKey: string | undefined, _signal: AbortSignal, caller?: BrowserTaskCaller) => {
        const envelope = envelopeFor(command, args, idempotencyKey, projectId);
        return ref.dispatch(caller?.approved ? withWorkflowHumanApproval(envelope) : envelope);
      },
      // 取消：解析整组成员、停止节点；费用预估。都是不扣费的命令，不需要批准。
      stop: async (command: string, args: Record<string, unknown>) => ref.dispatch(envelopeFor(command, args, undefined, projectId)),
      store: options.store === undefined ? createBrowserAgentTaskStore(projectId) : options.store ?? undefined,
      inspect: () => getNodes(projectId),
      ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}),
    } as never) as unknown as TaskLayer;
    entry = { layer, ref, byKey: new Map() };
    layers.set(projectId, entry);
  }
  entry.ref.dispatch = dispatch;
  const { layer, byKey } = entry;
  return {
    ready: layer.ready,
    start: async ({ command, args, idempotencyKey, approved, resubmit }) => {
      if (!BROWSER_TASKABLE_COMMANDS.includes(command)) {
        throw new AgentTaskError('INVALID_ARGUMENT', '内置 Agent 不能把 ' + (command || '(空)') + ' 放到后台。可用：' + BROWSER_TASKABLE_COMMANDS.join('、'));
      }
      await layer.ready;
      const caller: BrowserTaskCaller = { agentIdentity: 'builtin', approved };
      const view = layer.start({ command, args, idempotencyKey, source: 'agent', caller, ...(resubmit ? { resubmit: true } : {}) });
      if (idempotencyKey && !view.resubmitRequiresConfirmation) byKey.set(idempotencyKey, String(view.taskId));
      return view;
    },
    existing: async idempotencyKey => {
      await layer.ready;
      const taskId = byKey.get(idempotencyKey);
      if (!taskId) return null;
      try { return { ...layer.get({ taskId }), replayed: true }; } catch { byKey.delete(idempotencyKey); return null; }
    },
    inflight: async ({ command, args }) => {
      await layer.ready;
      return layer.inflight({ command, args, source: 'agent', caller: CALLER });
    },
    get: async input => {
      await layer.ready;
      return layer.get(input);
    },
    cancel: async input => {
      await layer.ready;
      return layer.cancel({ ...input, source: 'agent' });
    },
    settled: taskId => layer.settled(taskId),
    reconcile: () => layer.reconcile(),
  };
}

/** 测试用：丢弃所有项目的任务层（模拟页面刷新：台账仍在，下次创建时从台账恢复）。 */
export function resetBrowserAgentTasks(): void {
  for (const { layer } of layers.values()) void layer.close();
  layers.clear();
}
