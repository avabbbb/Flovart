// 内置 Agent 的后台任务（与本机 Agent 的 agent.task.* 同一个任务层、同一份工具定义）。
// 长命令（批量 / 整组生成、视频、导出…）不再把这一轮对话卡住几分钟：
// 先在当前回合完成审批（策略层 + 付费确认卡），批准后才放进后台执行，立即返回 taskId；
// 之后的回合用 flovart_task_get 轮询、flovart_task_cancel 取消（会停止它启动的画布节点）。
// 任务按项目保存在当前页面内存中，刷新页面即清空（get 返回 NOT_FOUND）。
import { createAgentTaskLayer, AgentTaskError, TASKABLE_COMMANDS } from '../agent/task-layer.js';
import { AGENT_BROWSER_COMMANDS } from '../tools/flovart/agent-surface.js';
import type { WorkflowCommandEnvelope, WorkflowCommandResult } from './workflowDispatcher';
import { withWorkflowHumanApproval } from './workflowDispatcher';

type Dispatch = (envelope: WorkflowCommandEnvelope) => Promise<WorkflowCommandResult>;

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
  start(input: { command: string; args: Record<string, unknown>; idempotencyKey?: string; approved: boolean }): Record<string, unknown>;
  get(input: { taskId: string; afterSeq?: number }): Record<string, unknown>;
  cancel(input: { taskId: string; reason?: string }): Promise<Record<string, unknown>>;
  settled(taskId: string): Promise<void>;
  /** 同一幂等键已经启动过的任务（还在保留期内），用来在重试时跳过第二张确认卡。 */
  existing(idempotencyKey: string): Record<string, unknown> | null;
}

// task-layer.js 是 JS，参数类型由默认值推断得过窄；这里写明实际用到的形状。
interface TaskLayer {
  start(input: { command: string; args: Record<string, unknown>; idempotencyKey?: string; source: string; caller: BrowserTaskCaller }): Record<string, unknown>;
  get(input: { taskId: string; afterSeq?: number }): Record<string, unknown>;
  cancel(input: { taskId: string; reason?: string; source: string }): Promise<Record<string, unknown>>;
  settled(taskId: string): Promise<void>;
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

/**
 * 每个项目一个任务层，跨回合保留（Agent 下一轮还能 get / cancel）。
 * dispatch 每次取最新的（命令面实例按回合重建）。
 */
export function browserAgentTaskLayer(projectId: string, dispatch: Dispatch): BrowserAgentTaskLayer {
  let entry = layers.get(projectId);
  if (!entry) {
    const ref = { dispatch };
    const layer = createAgentTaskLayer({
      run: async (command: string, args: Record<string, unknown>, _source: string, idempotencyKey: string | undefined, _signal: AbortSignal, caller?: BrowserTaskCaller) => {
        const envelope = envelopeFor(command, args, idempotencyKey, projectId);
        return ref.dispatch(caller?.approved ? withWorkflowHumanApproval(envelope) : envelope);
      },
      // 取消：解析整组成员、停止节点。都是不扣费的命令，不需要批准。
      stop: async (command: string, args: Record<string, unknown>) => ref.dispatch(envelopeFor(command, args, undefined, projectId)),
    } as never) as unknown as TaskLayer;
    entry = { layer, ref, byKey: new Map() };
    layers.set(projectId, entry);
  }
  entry.ref.dispatch = dispatch;
  const { layer, byKey } = entry;
  return {
    start: ({ command, args, idempotencyKey, approved }) => {
      if (!BROWSER_TASKABLE_COMMANDS.includes(command)) {
        throw new AgentTaskError('INVALID_ARGUMENT', '内置 Agent 不能把 ' + (command || '(空)') + ' 放到后台。可用：' + BROWSER_TASKABLE_COMMANDS.join('、'));
      }
      const caller: BrowserTaskCaller = { agentIdentity: 'builtin', approved };
      const view = layer.start({ command, args, idempotencyKey, source: 'agent', caller });
      if (idempotencyKey) byKey.set(idempotencyKey, String(view.taskId));
      return view;
    },
    existing: idempotencyKey => {
      const taskId = byKey.get(idempotencyKey);
      if (!taskId) return null;
      try { return { ...layer.get({ taskId }), replayed: true }; } catch { byKey.delete(idempotencyKey); return null; }
    },
    get: input => layer.get(input),
    cancel: input => layer.cancel({ ...input, source: 'agent' }),
    settled: taskId => layer.settled(taskId),
  };
}

/** 测试用：清空所有项目的任务。 */
export function resetBrowserAgentTasks(): void {
  layers.clear();
}
