/**
 * 生成计划卡（参考 RunningHub「创建并自动生成」卡）的视图模型：纯函数。
 *
 * 数据只来自已有审批数据流：确认请求（workflow.node.run 的 args.nodeIds + generation gates）
 * 与画布实时节点。推导不出的行（模型、编组）返回 undefined，卡片就不显示那一行。
 */
import type { WorkflowNode } from '../workflow/types';
import type { AgentConfirmRequest } from '../../services/agentSpendMandate';

/** 用户在计划卡上的选择：auto = 创建并自动生成；manual = 创建后手动生成；adjust = 调整后再创建。 */
export type RunPlanDecision = 'auto' | 'manual' | 'adjust';

export type RunPlanPhase = 'pending' | 'running' | 'done' | 'failed' | 'manual' | 'adjust';

export type RunPlanItemStatus = 'idle' | 'running' | 'done' | 'error';

export interface RunPlanItem {
  nodeId: string;
  /** 节点标题；没有标题时为空串，由界面给「未命名节点」。 */
  title: string;
  mediaType?: 'image' | 'video';
  status: RunPlanItemStatus;
}

export interface RunPlanView {
  /** 本批提交模型（多个模型用「、」连接）；拿不到时不显示。 */
  model?: string;
  /** 目标编组名：全部节点同属一个分组框时才有。 */
  groupName?: string;
  items: RunPlanItem[];
  total: number;
  done: number;
  failed: number;
  phase: RunPlanPhase;
}

/** 计划卡只接管「运行生成节点」的确认：workflow.node.run 且带门禁明细；其余确认仍走通用确认卡。 */
export function isRunPlanRequest(request: AgentConfirmRequest | undefined): request is AgentConfirmRequest {
  return Boolean(request && request.kind === 'generation' && request.command === 'workflow.node.run' && (request.gates?.length ?? 0) > 0);
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map(item => item.trim()).filter(Boolean);
  return [];
}

/** 与 planRunApproval 相同：nodeIds 去重保序；单节点调用退回 nodeId。 */
export function runPlanNodeIds(request: AgentConfirmRequest | undefined): string[] {
  const args = request?.args || {};
  const many = stringList(args.nodeIds);
  const ids = many.length ? many : stringList(args.nodeId ?? args.id);
  return [...new Set(ids)];
}

function uniqueModel(request: AgentConfirmRequest): string | undefined {
  const labels = [...new Set((request.gates || []).map(gate => gate.modelLabel?.trim()).filter((label): label is string => Boolean(label)))];
  return labels.length ? labels.join('、') : undefined;
}

/** 全部节点在同一个分组框里（parentId 指向 groupKind=group 的子画布节点）时给出分组名。 */
function sharedGroupName(ids: readonly string[], byId: ReadonlyMap<string, WorkflowNode>): string | undefined {
  if (!ids.length) return undefined;
  const parents = new Set(ids.map(id => byId.get(id)?.parentId));
  if (parents.size !== 1) return undefined;
  const [parentId] = [...parents];
  if (!parentId) return undefined;
  const parent = byId.get(parentId);
  const title = parent?.title?.trim();
  return parent && parent.metadata?.groupKind === 'group' && title ? title : undefined;
}

/**
 * 单个节点在这次批准之后的状态。批准前已有的旧成功结果不算本批完成：
 * 节点记录了 generationStartedAt 且早于批准时间时，视为还没开始。
 */
export function runPlanItemStatus(node: WorkflowNode | undefined, decidedAt?: number): RunPlanItemStatus {
  if (!node) return 'idle';
  const metadata = node.metadata || {};
  const status = metadata.status;
  if (status === 'loading') return 'running';
  const stale = decidedAt !== undefined && typeof metadata.generationStartedAt === 'number' && metadata.generationStartedAt < decidedAt;
  if (decidedAt !== undefined && stale) return 'idle';
  if (status === 'success') return decidedAt === undefined ? 'idle' : 'done';
  if (status === 'error') return decidedAt === undefined ? 'idle' : 'error';
  return 'idle';
}

export function buildRunPlanView(input: {
  request: AgentConfirmRequest;
  nodes: readonly WorkflowNode[];
  /** 用户的选择；未决定时为 undefined。 */
  decision?: RunPlanDecision;
  /** 做出选择的时间（毫秒）；用于排除批准前的旧结果。 */
  decidedAt?: number;
}): RunPlanView {
  const { request, nodes, decision, decidedAt } = input;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const ids = runPlanNodeIds(request);
  const gates = request.gates || [];
  const tracking = decision === 'auto';
  const items: RunPlanItem[] = ids.map((nodeId, index) => {
    const node = byId.get(nodeId);
    const gate = gates.length === ids.length ? gates[index] : undefined;
    const nodeType: 'image' | 'video' | undefined = node?.type === 'image' ? 'image' : node?.type === 'video' ? 'video' : undefined;
    return {
      nodeId,
      title: node?.title?.trim() || gate?.nodeTitle?.trim() || '',
      mediaType: nodeType ?? gate?.mediaType,
      status: tracking ? runPlanItemStatus(node, decidedAt) : 'idle',
    };
  });
  const total = items.length;
  const done = items.filter(item => item.status === 'done').length;
  const failed = items.filter(item => item.status === 'error').length;
  let phase: RunPlanPhase = 'pending';
  if (decision === 'manual') phase = 'manual';
  else if (decision === 'adjust') phase = 'adjust';
  else if (decision === 'auto') {
    if (total > 0 && done === total) phase = 'done';
    else if (total > 0 && done + failed === total && failed > 0) phase = 'failed';
    else phase = 'running';
  }
  return {
    model: uniqueModel(request),
    groupName: sharedGroupName(ids, byId),
    items,
    total,
    done,
    failed,
    phase,
  };
}

/** 计划卡按钮 → 现有审批结果：只有「创建并自动生成」批准运行；另两个都不运行，并告诉 Agent 原因。 */
export function runPlanApproved(decision: RunPlanDecision): boolean {
  return decision === 'auto';
}
