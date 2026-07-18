import localforage from 'localforage';
import { nanoid } from 'nanoid';
import type { ApiPricingRule, UserApiKey } from '../types';

const usageStore = localforage.createInstance({ name: 'flovart', storeName: 'api_usage_v2' });
const RECORDS_KEY = 'records';

export type UsageStatus = 'reserved' | 'submission_unknown' | 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'polling_unknown';
export type BillableState = 'estimated' | 'actual' | 'unknown' | 'not_billable' | 'refunded';

export interface UsageRecord {
  id: string;
  keyId: string;
  provider: string;
  productModelId?: string;
  model: string;
  timestamp: number;
  updatedAt: number;
  type: 'text' | 'image' | 'video';
  status: UsageStatus;
  billableState: BillableState;
  estimatedCost?: number;
  actualCost?: number;
  estimatedTokens?: number;
  actualTokens?: number;
  currency?: 'USD' | 'CNY';
  providerTaskId?: string;
  idempotencyKey?: string;
  submitTime?: number;
  startTime?: number;
  finishTime?: number;
  error?: string;
}

export interface KeyUsageSummary {
  keyId: string;
  provider: string;
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  totalCostCents: number;
  currentMonthCostCents: number;
  currency: 'USD' | 'CNY';
  pendingCostCalls: number;
  byType: { text: number; image: number; video: number };
  last24h: number;
  last7d: number;
  lastUsed: number | null;
}

const readRecords = async (): Promise<UsageRecord[]> => (await usageStore.getItem<UsageRecord[]>(RECORDS_KEY)) || [];
const writeRecords = async (records: UsageRecord[]) => usageStore.setItem(RECORDS_KEY, records.slice(-10_000));

function pricingRulesFor(key: UserApiKey, productModelId: string | undefined, routeId: string, type: 'text' | 'image' | 'video', resolution?: string, quality?: string): ApiPricingRule[] {
  const rules = key.pricingRules || [];
  const supportedUnits = type === 'video' ? ['video_second', 'request'] : type === 'image' ? ['image', 'request'] : ['input_token', 'output_token', 'request'];
  const supported = rules.filter(rule => supportedUnits.includes(rule.unit));
  const productRules = supported.filter(rule => rule.productModelId === productModelId);
  const routeRules = supported.filter(rule => rule.routeId === routeId);
  const scoped = productRules.length ? productRules : routeRules.length ? routeRules : supported.filter(rule => !rule.productModelId && !rule.routeId);
  const compatible = scoped.filter(rule => (!rule.resolution || rule.resolution.toLowerCase() === resolution?.toLowerCase()) && (!rule.quality || rule.quality.toLowerCase() === quality?.toLowerCase()));
  if (!compatible.length) return [];
  const maxSpecificity = Math.max(...compatible.map(rule => Number(Boolean(rule.resolution)) + Number(Boolean(rule.quality))));
  return compatible.filter(rule => Number(Boolean(rule.resolution)) + Number(Boolean(rule.quality)) === maxSpecificity);
}

export function estimateApiCost(input: {
  key: UserApiKey;
  productModelId?: string;
  routeId: string;
  type: 'text' | 'image' | 'video';
  durationSec?: number;
  count?: number;
  resolution?: string;
  quality?: string;
}): { amount: number; currency: 'USD' | 'CNY' } | null {
  const rules = pricingRulesFor(input.key, input.productModelId, input.routeId, input.type, input.resolution, input.quality)
    .filter(rule => rule.unit !== 'input_token' && rule.unit !== 'output_token');
  if (!rules.length || new Set(rules.map(rule => rule.currency)).size !== 1) return null;
  const count = Math.max(1, input.count || 1);
  const amount = rules.reduce((sum, rule) => {
    const units = rule.unit === 'video_second' ? Math.max(1, input.durationSec || 1) * count : count;
    return sum + rule.rate * units;
  }, 0);
  return { amount, currency: rules[0].currency };
}

export async function assertApiBudget(input: Parameters<typeof estimateApiCost>[0]): Promise<void> {
  const policy = input.key.budgetPolicy;
  if (!policy?.enabled || !policy.hardStop) return;
  const estimate = estimateApiCost(input);
  if (!estimate || estimate.currency !== policy.currency) return;
  const start = new Date();
  start.setDate(1); start.setHours(0, 0, 0, 0);
  const records = await readRecords();
  const used = records
    .filter(record => record.keyId === input.key.id && record.timestamp >= start.getTime() && record.currency === policy.currency && record.billableState !== 'not_billable')
    .reduce((sum, record) => sum + (record.actualCost ?? record.estimatedCost ?? 0), 0);
  if (used + estimate.amount > policy.monthlyLimit) {
    throw new Error(`已达到这把 API Key 的月度预算上限（${policy.currency} ${policy.monthlyLimit}），已阻止创建新任务。`);
  }
}

export async function reserveApiUsage(input: Parameters<typeof estimateApiCost>[0]): Promise<UsageRecord> {
  await assertApiBudget(input);
  const estimate = estimateApiCost(input);
  const now = Date.now();
  const record: UsageRecord = {
    id: nanoid(), keyId: input.key.id, provider: input.key.provider, productModelId: input.productModelId,
    model: input.routeId, timestamp: now, updatedAt: now, type: input.type, status: 'reserved',
    billableState: estimate ? 'estimated' : 'unknown', estimatedCost: estimate?.amount, currency: estimate?.currency,
  };
  const records = await readRecords(); records.push(record); await writeRecords(records);
  return record;
}

export async function updateApiUsage(id: string, patch: Partial<Omit<UsageRecord, 'id' | 'keyId' | 'timestamp'>>): Promise<void> {
  const records = await readRecords();
  await writeRecords(records.map(record => record.id === id ? { ...record, ...patch, updatedAt: Date.now() } : record));
}

/**
 * 退款型终态：双簿记账（参考 NewAPI #4211）。
 * 若 record 之前以 estimated 计入了 accumulatedCost，退款时必须同步把 actualCost 归零，
 * 否则 getUsageSummary 会把 estimatedCost + 0 重复累计（虚增已用额度）。
 *
 * 调用方应在以下场景调用本函数：
 *   - cancelTask 成功（上游已确认取消，且未产生任何费用）
 *   - 上游 task 已知终态 failed / canceled / expired 且 reconcileUsage 未回填 actualCost
 *
 * 参数：
 *   - reason: 仅用于 error 字段说明，可选
 *   - status: usageRecord 的新状态，默认 'canceled'，task feedback 也可传 'failed'
 */
export async function refundApiUsage(id: string, reason?: string, status: UsageStatus = 'canceled'): Promise<void> {
  const records = await readRecords();
  const record = records.find(record => record.id === id);
  if (!record) return;
  const next: UsageRecord = {
    ...record,
    status,
    billableState: 'refunded',
    // 若 record.actualCost 之前已由 reconcileUsage 写成 actual 金额，则保留 actual（上游已计费）；
    // 仅清除 estimatedCost 字段对 accumulatedCost 的影响（getUsageSummary 已优先取 actualCost ?? estimatedCost）。
    actualCost: record.actualCost ?? 0,
    estimatedCost: record.actualCost !== undefined ? record.estimatedCost : 0,
    finishTime: record.finishTime ?? Date.now(),
    error: reason || record.error,
    updatedAt: Date.now(),
  };
  await writeRecords(records.map(item => item.id === id ? next : item));
}

export async function recordApiUsage(input: {
  key: UserApiKey;
  model: string;
  productModelId?: string;
  type: 'text' | 'image' | 'video';
  success: boolean;
  error?: string;
}): Promise<void> {
  const estimate = estimateApiCost({ key: input.key, productModelId: input.productModelId, routeId: input.model, type: input.type });
  const now = Date.now();
  const records = await readRecords();
  records.push({
    id: nanoid(), keyId: input.key.id, provider: input.key.provider, productModelId: input.productModelId,
    model: input.model, timestamp: now, updatedAt: now, type: input.type, status: input.success ? 'succeeded' : 'failed',
    billableState: input.success ? (estimate ? 'estimated' : 'unknown') : 'unknown', estimatedCost: estimate?.amount,
    currency: estimate?.currency, error: input.error,
  });
  await writeRecords(records);
}

export async function getUsageSummary(keys: UserApiKey[]): Promise<Map<string, KeyUsageSummary>> {
  const records = await readRecords();
  const now = Date.now(); const day = 86_400_000;
  const map = new Map(keys.map(key => [key.id, {
    keyId: key.id, provider: key.provider, totalCalls: 0, successCalls: 0, errorCalls: 0, totalCostCents: 0, currentMonthCostCents: 0,
    currency: key.budgetPolicy?.currency || 'USD', pendingCostCalls: 0, byType: { text: 0, image: 0, video: 0 }, last24h: 0, last7d: 0, lastUsed: null,
  } satisfies KeyUsageSummary]));
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  for (const record of records) {
    const summary = map.get(record.keyId); if (!summary) continue;
    summary.totalCalls += 1; summary.byType[record.type] += 1;
    if (record.status === 'succeeded') summary.successCalls += 1;
    if (record.status === 'failed') summary.errorCalls += 1;
    if (record.billableState === 'unknown') summary.pendingCostCalls += 1;
    if (record.currency === summary.currency) {
      const costCents = (record.actualCost ?? record.estimatedCost ?? 0) * 100;
      summary.totalCostCents += costCents;
      if (record.timestamp >= monthStart.getTime()) summary.currentMonthCostCents += costCents;
    }
    if (now - record.timestamp < day) summary.last24h += 1;
    if (now - record.timestamp < 7 * day) summary.last7d += 1;
    if (!summary.lastUsed || record.timestamp > summary.lastUsed) summary.lastUsed = record.timestamp;
  }
  return map;
}

export async function getKeyRecords(keyId: string): Promise<UsageRecord[]> { return (await readRecords()).filter(record => record.keyId === keyId); }
export async function clearAllUsageData(): Promise<void> { await usageStore.removeItem(RECORDS_KEY); }
export function formatCost(cents: number, currency: 'USD' | 'CNY' = 'USD'): string { return `${currency === 'USD' ? '$' : '¥'}${(cents / 100).toFixed(cents < 100 ? 3 : 2)}`; }
