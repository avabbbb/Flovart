/**
 * Agent 工具 v2 · P0-3：建与跑分离后的「按批审批」（纯函数）。
 *
 * Agent 先用 workflow.generate（run=false）把一批生成节点建好，再用一次
 * workflow.node.run { nodeIds }（别名 flovart_approve_run）请求运行：
 * - 审批卡列出的节点 = 本次会运行的节点，每个只运行一次（去重、保持顺序）；
 * - 费用在卡片上汇总一次确认；
 * - 列表里有不存在、文本备注或不能生成的节点时，在弹卡之前就拒绝，不让用户批准一张跑不起来的卡。
 */
import type { WorkflowNode } from '../components/workflow/types';
import type { GenerationGateDetails } from './generationGate';
import { spendDemand } from './agentSpendMandate';

export interface RunApprovalItem { nodeId: string; title: string; mode: 'image' | 'video' }

export type RunApprovalPlan =
  | { ok: true; nodeIds: string[]; items: RunApprovalItem[] }
  | { ok: false; code: 'NOT_FOUND' | 'NOTE_IS_ANNOTATION' | 'NOT_RUNNABLE'; message: string; nodeIds: string[] };

/** 与 workflow.generate 相同的「生成节点」判定：图片/视频节点，或 image.generate@1 操作节点。 */
export function runnableModeOf(node: WorkflowNode): 'image' | 'video' | null {
  const operation = node.metadata?.operation;
  if (operation) return operation.capabilityId === 'image.generate@1' ? 'image' : null;
  if (node.type === 'image' || node.type === 'video') return node.type as 'image' | 'video';
  return null;
}

/** 校验并整理一次批量运行的节点清单。 */
export function planRunApproval(nodes: readonly WorkflowNode[], requestedIds: readonly string[]): RunApprovalPlan {
  const nodeIds = [...new Set(requestedIds.map(id => id.trim()).filter(Boolean))];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const missing = nodeIds.filter(id => !byId.has(id));
  if (missing.length) return { ok: false, code: 'NOT_FOUND', message: '节点不存在：' + missing.join('、'), nodeIds: missing };
  const notes = nodeIds.filter(id => byId.get(id)!.type === 'text');
  if (notes.length) return { ok: false, code: 'NOTE_IS_ANNOTATION', message: `${notes.join('、')} 是文本备注，不能运行；只把生成节点放进审批清单。`, nodeIds: notes };
  const notRunnable = nodeIds.filter(id => !runnableModeOf(byId.get(id)!));
  if (notRunnable.length) {
    return { ok: false, code: 'NOT_RUNNABLE', message: `${notRunnable.join('、')} 不是图片/视频生成节点；画布工具请用 flovart_image_tool / flovart_video_tool / flovart_audio_tool。`, nodeIds: notRunnable };
  }
  return {
    ok: true,
    nodeIds,
    items: nodeIds.map(id => {
      const node = byId.get(id)!;
      return { nodeId: id, title: node.title?.trim() || '', mode: runnableModeOf(node)! };
    }),
  };
}

export interface RunCostEstimateItem {
  nodeId: string;
  title: string;
  mode: 'image' | 'video';
  model: string;
  service: string;
  route?: string;
  taskCount: number;
  /** null：没有匹配的计价规则，以 AI 服务账单为准。 */
  estimatedCost: { amount: number; currency: 'USD' | 'CNY' } | null;
  costBasis: 'pricing-rule' | 'unknown';
  resolution?: string;
  durationSec?: number;
  blockers?: string[];
  warnings?: string[];
}

export interface RunCostEstimate {
  nodeIds: string[];
  items: RunCostEstimateItem[];
  /** 合计：cost 为 null 表示至少一个节点没有估算，或币种不一致。 */
  total: { tasks: number; cost: { amount: number; currency: 'USD' | 'CNY' } | null };
  unknownCostNodeIds: string[];
  /** 有 blocker 的节点：确认卡上的「运行」按钮会被禁用，先修好再请求运行。 */
  blockedNodeIds: string[];
  /** 与确认卡第一行同一句（describeRunApproval）。 */
  summary: string;
}

/**
 * 运行前预估（workflow.cost.estimate）：与审批卡同一份计划（gateFor = planGenerationGate），
 * 只读、不弹卡、不扣费；让 Agent 在请求运行之前就能把清单与合计费用告诉用户。
 */
export function estimateRunCost(
  nodes: readonly WorkflowNode[],
  requestedIds: readonly string[],
  gateFor: (node: WorkflowNode) => GenerationGateDetails,
): RunCostEstimate | Extract<RunApprovalPlan, { ok: false }> {
  const plan = planRunApproval(nodes, requestedIds);
  if (plan.ok === false) return plan;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const gates = plan.nodeIds.map(id => gateFor(byId.get(id)!));
  const items = plan.items.map((item, index): RunCostEstimateItem => {
    const gate = gates[index];
    return {
      nodeId: item.nodeId,
      title: item.title,
      mode: gate.mediaType,
      model: gate.modelLabel,
      service: gate.serviceLabel,
      ...(gate.routeLabel ? { route: gate.routeLabel } : {}),
      taskCount: gate.taskCount,
      estimatedCost: gate.estimatedCost ?? null,
      costBasis: gate.estimatedCost ? 'pricing-rule' : 'unknown',
      ...(gate.resolution ? { resolution: gate.resolution } : {}),
      ...(gate.durationSec ? { durationSec: gate.durationSec } : {}),
      ...(gate.blockers?.length ? { blockers: gate.blockers.map(notice => notice.message) } : {}),
      ...(gate.warnings?.length ? { warnings: gate.warnings.map(notice => notice.message) } : {}),
    };
  });
  const demand = spendDemand(gates);
  const copy = describeRunApproval(plan.nodeIds.length, gates, 'zho');
  return {
    nodeIds: plan.nodeIds,
    items,
    total: { tasks: demand.tasks, cost: demand.cost },
    unknownCostNodeIds: items.filter(item => !item.estimatedCost).map(item => item.nodeId),
    blockedNodeIds: items.filter(item => item.blockers?.length).map(item => item.nodeId),
    summary: copy.title + ' · ' + copy.detail,
  };
}

const money = (currency: 'USD' | 'CNY', amount: number) => (currency === 'USD' ? '$' : '¥') + amount.toFixed(2);

/** 审批卡的一句话：N 个节点各运行一次 + 合计任务与费用（只确认一次）。 */
export function describeRunApproval(nodeCount: number, gates: readonly GenerationGateDetails[], language: 'en' | 'zho') {
  const demand = spendDemand(gates);
  const tasks = gates.length ? demand.tasks : nodeCount;
  const cost = demand.cost ? money(demand.cost.currency, demand.cost.amount) : null;
  if (language === 'en') {
    return {
      title: `Approve ${nodeCount} node${nodeCount === 1 ? '' : 's'} to run once each`,
      detail: `${tasks} task(s) · ${cost ? 'est. ' + cost : 'cost unknown'} · one approval covers the whole list`,
    };
  }
  return {
    title: `批准运行这 ${nodeCount} 个节点（各一次）`,
    detail: `共 ${tasks} 个任务 · ${cost ? '预估 ' + cost : '预估额度未知'} · 一次确认覆盖整张清单`,
  };
}

/**
 * 确认结果：大多数确认只有批准 / 拒绝（boolean）；生成计划卡的「不运行」选项另带一句给 Agent 的说明，
 * 让它知道节点已保留、不要重复创建，而不是笼统的「用户拒绝」。
 */
export type AgentConfirmVerdict = boolean | { approved: false; note: string };

export const CONFIRM_DENIED_MESSAGE = '用户拒绝了该操作';

/** 把确认结果拆成「是否批准 + 拒绝时抛给 Agent 的说明」。 */
export function readConfirmVerdict(verdict: AgentConfirmVerdict): { approved: boolean; message: string } {
  if (verdict === true) return { approved: true, message: '' };
  if (verdict && typeof verdict === 'object' && verdict.note.trim()) return { approved: false, message: verdict.note.trim() };
  return { approved: false, message: CONFIRM_DENIED_MESSAGE };
}

/** 生成计划卡上「不运行」两个选项回给 Agent 的说明（写给模型，不是界面文案）。 */
export function runPlanDenialNote(decision: 'manual' | 'adjust', nodeCount: number): string {
  if (decision === 'manual') {
    return `用户选择「创建后手动生成」：这 ${nodeCount} 个节点已保留在画布上，由用户自己运行。本次不要运行，也不要重复创建这些节点；简短告诉用户节点已就绪即可。`;
  }
  return `用户选择「调整后再创建」：本次不运行。先不要重复创建或运行这些节点，等用户在下一条消息里说明要调整什么，再按要求修改。`;
}
