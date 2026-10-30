import type { GenerationGateDetails } from './generationGate';

/**
 * 自动模式的付费授权（Spend Mandate）。
 *
 * 对齐 LibTV「自动：直接出成片」的体验，但保留兜底：
 * - 自动模式下第一次付费生成时，用户确认一次上限（任务数，可选金额）；
 * - 之后本会话内累计不超上限的生成自动批准，超出则重新询问；
 * - 删除、取消、Production 门禁等非生成高风险操作永远不在授权范围内。
 *
 * Agent 生成当前多数拿不到价格估算，所以任务数是必填上限；
 * 金额上限只在每个任务都有同币种估算时生效，否则退回人工确认。
 */

export type AgentConfirmKind = 'generation' | 'destructive' | 'other';

export interface AgentConfirmRequest {
  kind: AgentConfirmKind;
  command: string;
  /** 仅 generation：每个待运行节点一项。 */
  gates?: readonly GenerationGateDetails[];
}

export type SpendCurrency = 'USD' | 'CNY';

export interface AgentSpendMandate {
  maxTasks: number;
  maxCost?: { amount: number; currency: SpendCurrency } | null;
  usedTasks: number;
  usedCost: number;
  grantedAt: number;
}

export interface AgentSpendDemand {
  tasks: number;
  /** null 表示至少一个任务没有估算，或币种不一致。 */
  cost: { amount: number; currency: SpendCurrency } | null;
}

export type MandateDenyReason = 'not-generation' | 'no-mandate' | 'unknown-demand' | 'tasks-exceeded' | 'cost-exceeded' | 'cost-unknown';

export type MandateDecision = { allow: true } | { allow: false; reason: MandateDenyReason };

export function spendDemand(gates: readonly GenerationGateDetails[] = []): AgentSpendDemand {
  let tasks = 0;
  let amount = 0;
  let currency: SpendCurrency | undefined;
  let costKnown = gates.length > 0;
  for (const gate of gates) {
    const count = Number(gate.taskCount);
    tasks += Number.isFinite(count) && count > 0 ? Math.ceil(count) : 1;
    const estimate = gate.estimatedCost;
    if (!estimate || !Number.isFinite(estimate.amount) || estimate.amount < 0) {
      costKnown = false;
      continue;
    }
    if (currency && currency !== estimate.currency) costKnown = false;
    currency = currency || estimate.currency;
    amount += estimate.amount;
  }
  return { tasks, cost: costKnown && currency ? { amount, currency } : null };
}

export function evaluateSpendMandate(mandate: AgentSpendMandate | null | undefined, request: AgentConfirmRequest | undefined): MandateDecision {
  if (!request || request.kind !== 'generation') return { allow: false, reason: 'not-generation' };
  if (!mandate) return { allow: false, reason: 'no-mandate' };
  const demand = spendDemand(request.gates);
  if (demand.tasks <= 0) return { allow: false, reason: 'unknown-demand' };
  if (mandate.usedTasks + demand.tasks > mandate.maxTasks) return { allow: false, reason: 'tasks-exceeded' };
  if (mandate.maxCost) {
    if (!demand.cost || demand.cost.currency !== mandate.maxCost.currency) return { allow: false, reason: 'cost-unknown' };
    if (mandate.usedCost + demand.cost.amount > mandate.maxCost.amount + 1e-9) return { allow: false, reason: 'cost-exceeded' };
  }
  return { allow: true };
}

export function createSpendMandate(limits: { maxTasks: number; maxCost?: AgentSpendMandate['maxCost'] }, now = Date.now()): AgentSpendMandate {
  const maxTasks = Math.floor(Number(limits.maxTasks));
  if (!Number.isFinite(maxTasks) || maxTasks < 1) throw new Error('自动模式任务上限必须是正整数。');
  const maxCost = limits.maxCost && Number.isFinite(limits.maxCost.amount) && limits.maxCost.amount > 0 ? { ...limits.maxCost } : null;
  return { maxTasks, maxCost, usedTasks: 0, usedCost: 0, grantedAt: now };
}

/** 把已批准的一次生成计入授权（无论是自动批准还是开启授权的那一次）。 */
export function consumeSpendMandate(mandate: AgentSpendMandate, request: AgentConfirmRequest): AgentSpendMandate {
  const demand = spendDemand(request.gates);
  return { ...mandate, usedTasks: mandate.usedTasks + demand.tasks, usedCost: mandate.usedCost + (demand.cost?.amount ?? 0) };
}

/** 开启授权时的默认任务上限：至少覆盖本批，且不少于 10。 */
export function defaultMandateTasks(request?: AgentConfirmRequest): number {
  return Math.max(10, spendDemand(request?.gates).tasks);
}

export function describeSpendMandate(mandate: AgentSpendMandate): string {
  const tasks = `已用 ${mandate.usedTasks}/${mandate.maxTasks} 个生成任务`;
  if (!mandate.maxCost) return tasks;
  const symbol = mandate.maxCost.currency === 'USD' ? '$' : '¥';
  return `${tasks}，${symbol}${mandate.usedCost.toFixed(2)}/${symbol}${mandate.maxCost.amount.toFixed(2)}`;
}
