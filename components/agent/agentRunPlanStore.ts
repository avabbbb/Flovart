/**
 * 生成计划卡的本机持久化：按「项目 + 会话」保存用户已做出选择的计划卡，
 * 切换会话、刷新页面后回到这段对话时仍能挂回原来那一轮。
 *
 * 只存渲染计划卡需要的最小字段（命令、节点 id、门禁明细、选择与时间、轮次）；
 * 节点进度不存，回来后按画布实时节点重新推导。待选择（未决定）的卡不存：它属于正在进行的确认。
 */
import type { AgentConfirmRequest } from '../../services/agentSpendMandate';
import type { RunPlanDecision } from './agentRunPlan';
import { runPlanNodeIds } from './agentRunPlan';

export interface StoredRunPlan {
  id: string;
  request: AgentConfirmRequest;
  decision: RunPlanDecision;
  decidedAt: number;
  turnIndex: number;
}

type RWStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const RUN_PLAN_STORAGE_KEY = 'flovart.agent.runPlans.v1';
/** 每段会话最多保留的计划卡数（按选择时间保留最新的）。 */
export const MAX_PLANS_PER_SESSION = 30;
/** 最多保留的会话数（按最近一次写入保留）。 */
export const MAX_SESSIONS = 60;

interface StoreShape {
  /** key → { updatedAt, plans } */
  sessions: Record<string, { updatedAt: number; plans: StoredRunPlan[] }>;
}

const defaultStorage = (): RWStorage | undefined => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
};

export function runPlanSessionKey(projectId: string, sessionId: string): string {
  return `${projectId}\u0000${sessionId}`;
}

const DECISIONS: readonly RunPlanDecision[] = ['auto', 'manual', 'adjust'];

/** 只留计划卡用得到的请求字段，避免把整段 args（可能很大）写进 localStorage。 */
export function compactRunPlanRequest(request: AgentConfirmRequest): AgentConfirmRequest {
  const nodeIds = runPlanNodeIds(request);
  return {
    kind: request.kind,
    command: request.command,
    args: { nodeIds },
    ...(request.gates ? { gates: request.gates } : {}),
  } as AgentConfirmRequest;
}

function isStoredPlan(value: unknown): value is StoredRunPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<StoredRunPlan>;
  return typeof plan.id === 'string'
    && Boolean(plan.request && typeof plan.request === 'object')
    && DECISIONS.includes(plan.decision as RunPlanDecision)
    && typeof plan.decidedAt === 'number'
    && typeof plan.turnIndex === 'number';
}

function readStore(storage: RWStorage | undefined): StoreShape {
  try {
    const raw = storage?.getItem(RUN_PLAN_STORAGE_KEY);
    if (!raw) return { sessions: {} };
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    if (!parsed || typeof parsed !== 'object' || !parsed.sessions || typeof parsed.sessions !== 'object') return { sessions: {} };
    return { sessions: parsed.sessions as StoreShape['sessions'] };
  } catch {
    return { sessions: {} };
  }
}

function writeStore(store: StoreShape, storage: RWStorage | undefined): void {
  try {
    const entries = Object.entries(store.sessions)
      .filter(([, entry]) => entry && Array.isArray(entry.plans) && entry.plans.length > 0)
      .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
      .slice(0, MAX_SESSIONS);
    if (!entries.length) {
      storage?.removeItem(RUN_PLAN_STORAGE_KEY);
      return;
    }
    storage?.setItem(RUN_PLAN_STORAGE_KEY, JSON.stringify({ sessions: Object.fromEntries(entries) }));
  } catch {
    // 存储满或不可用（隐私模式）：计划卡只是回看用，失败不影响当前会话。
  }
}

export function readRunPlans(projectId: string, sessionId: string, storage: RWStorage | undefined = defaultStorage()): StoredRunPlan[] {
  if (!projectId || !sessionId) return [];
  const entry = readStore(storage).sessions[runPlanSessionKey(projectId, sessionId)];
  if (!entry || !Array.isArray(entry.plans)) return [];
  return entry.plans.filter(isStoredPlan).sort((a, b) => a.decidedAt - b.decidedAt);
}

/** 写入或覆盖同 id 的计划卡；没有会话 id 时不写（会话还没落定）。 */
export function saveRunPlan(projectId: string, sessionId: string, plan: StoredRunPlan, storage: RWStorage | undefined = defaultStorage(), now = Date.now()): StoredRunPlan[] {
  if (!projectId || !sessionId) return [];
  const store = readStore(storage);
  const key = runPlanSessionKey(projectId, sessionId);
  const compact: StoredRunPlan = { ...plan, request: compactRunPlanRequest(plan.request) };
  const current = (store.sessions[key]?.plans || []).filter(isStoredPlan).filter(item => item.id !== plan.id);
  const plans = [...current, compact].sort((a, b) => a.decidedAt - b.decidedAt).slice(-MAX_PLANS_PER_SESSION);
  store.sessions[key] = { updatedAt: now, plans };
  writeStore(store, storage);
  return plans;
}

/** 删除会话时一起清掉它的计划卡。 */
export function clearRunPlans(projectId: string, sessionId: string, storage: RWStorage | undefined = defaultStorage()): void {
  if (!projectId || !sessionId) return;
  const store = readStore(storage);
  const key = runPlanSessionKey(projectId, sessionId);
  if (!(key in store.sessions)) return;
  delete store.sessions[key];
  writeStore(store, storage);
}
