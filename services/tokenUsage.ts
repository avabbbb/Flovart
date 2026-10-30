// Token 用量统计（仅统计）：把各厂商响应里的 usage 归一化，写入本地账本并按 provider/model 汇总。
// 调用方在解析完 JSON 后显式调用 recordTokenUsage；流式调用由 services/streamUsage.ts 累积后提交。不拦截全局 fetch。

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

export type UsageOutcome = 'ok' | 'aborted' | 'error';

export interface TokenUsageRecord extends TokenUsage {
  id: string;
  at: string;
  provider: string;
  model: string;
  source: string;
  /** 仅流式调用填写：完成 / 取消 / 出错（取消与出错仍可能已计费）。 */
  outcome?: UsageOutcome;
}

/** 流式调用结束但供应商没下发 usage：只计次数，不估算 Token。 */
export interface UsageMissingRecord {
  at: string;
  provider: string;
  model: string;
  source: string;
  outcome?: UsageOutcome;
}

export interface TokenUsageSummaryRow {
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
}

const STORAGE_KEY = 'flovart.tokenUsage.v1';
export const TOKEN_USAGE_MAX_RECORDS = 2000;
const MISSING_STORAGE_KEY = 'flovart.tokenUsage.missing.v1';

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** 支持 OpenAI chat / Responses、Anthropic、Gemini usageMetadata、Volcengine Ark（仅 total）。无 usage 时返回 null。 */
export function extractTokenUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, any>;
  const gemini = source.usageMetadata;
  if (gemini && typeof gemini === 'object') {
    const input = count(gemini.promptTokenCount) ?? 0;
    const reasoning = count(gemini.thoughtsTokenCount);
    const output = (count(gemini.candidatesTokenCount) ?? 0) + (reasoning ?? 0);
    const total = count(gemini.totalTokenCount) ?? input + output;
    if (!input && !output && !total) return null;
    return { inputTokens: input, outputTokens: output, totalTokens: total, cachedInputTokens: count(gemini.cachedContentTokenCount), reasoningTokens: reasoning };
  }
  const usage = source.usage ?? source.data?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const input = count(usage.prompt_tokens) ?? count(usage.input_tokens);
  const output = count(usage.completion_tokens) ?? count(usage.output_tokens);
  const total = count(usage.total_tokens) ?? count(usage.token_usage?.total_tokens);
  if (input === undefined && output === undefined && total === undefined) return null;
  const cached = count(usage.prompt_tokens_details?.cached_tokens) ?? count(usage.input_tokens_details?.cached_tokens) ?? count(usage.cache_read_input_tokens);
  const reasoning = count(usage.completion_tokens_details?.reasoning_tokens) ?? count(usage.output_tokens_details?.reasoning_tokens);
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    totalTokens: total ?? (input ?? 0) + (output ?? 0),
    cachedInputTokens: cached,
    reasoningTokens: reasoning,
  };
}

type UsageStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
let storage: UsageStorage | undefined = globalThis.localStorage;
let records: TokenUsageRecord[] | null = null;
let missing: UsageMissingRecord[] | null = null;
const listeners = new Set<(records: readonly TokenUsageRecord[]) => void>();

/** 测试或非浏览器环境注入存储；传 undefined 则只在内存中统计。 */
export function setTokenUsageStorage(next: UsageStorage | undefined): void {
  storage = next;
  records = null;
  missing = null;
}

function load(): TokenUsageRecord[] {
  if (records) return records;
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
    records = Array.isArray(parsed) ? parsed.filter(item => item && typeof item.totalTokens === 'number') : [];
  } catch {
    records = [];
  }
  return records;
}

function persist(next: TokenUsageRecord[]): void {
  records = next;
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 配额不足时保留内存统计。
  }
  listeners.forEach(listener => listener(next));
}

export function recordTokenUsage(input: { provider: string; model: string; source: string; raw?: unknown; usage?: TokenUsage | null; at?: Date; outcome?: UsageOutcome }): TokenUsageRecord | null {
  try {
    const usage = input.usage ?? extractTokenUsage(input.raw);
    if (!usage) return null;
    const at = input.at ?? new Date();
    const record: TokenUsageRecord = {
      ...usage,
      id: at.getTime().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      at: at.toISOString(),
      provider: input.provider || 'unknown',
      model: input.model || 'unknown',
      source: input.source,
      ...(input.outcome ? { outcome: input.outcome } : {}),
    };
    persist([...load(), record].slice(-TOKEN_USAGE_MAX_RECORDS));
    return record;
  } catch {
    // 统计失败绝不影响业务调用。
    return null;
  }
}

function loadMissing(): UsageMissingRecord[] {
  if (missing) return missing;
  try {
    const parsed = JSON.parse(storage?.getItem(MISSING_STORAGE_KEY) || '[]');
    missing = Array.isArray(parsed) ? parsed.filter(item => item && typeof item.at === 'string') : [];
  } catch {
    missing = [];
  }
  return missing;
}

export function recordUsageMissing(input: { provider: string; model: string; source: string; outcome?: UsageOutcome; at?: Date }): void {
  try {
    const item: UsageMissingRecord = {
      at: (input.at ?? new Date()).toISOString(),
      provider: input.provider || 'unknown',
      model: input.model || 'unknown',
      source: input.source,
      ...(input.outcome ? { outcome: input.outcome } : {}),
    };
    missing = [...loadMissing(), item].slice(-TOKEN_USAGE_MAX_RECORDS);
    try { storage?.setItem(MISSING_STORAGE_KEY, JSON.stringify(missing)); } catch { /* 配额不足时保留内存 */ }
    const current = load();
    listeners.forEach(listener => listener(current));
  } catch {
    // 统计失败绝不影响业务调用。
  }
}

export function listUsageMissing(): readonly UsageMissingRecord[] {
  return loadMissing();
}

/** 按时间与来源统计「未返回 usage」的次数。 */
export function countUsageMissing(list: readonly UsageMissingRecord[], options: { since?: Date; source?: string } = {}): number {
  const since = options.since?.getTime();
  return list.filter(item => (since === undefined || Date.parse(item.at) >= since) && (!options.source || item.source === options.source)).length;
}

export function listTokenUsage(): readonly TokenUsageRecord[] {
  return load();
}

export function clearTokenUsage(): void {
  try { storage?.removeItem(STORAGE_KEY); storage?.removeItem(MISSING_STORAGE_KEY); } catch { /* ignore */ }
  missing = [];
  persist([]);
}

export function subscribeTokenUsage(listener: (records: readonly TokenUsageRecord[]) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function summarizeTokenUsage(list: readonly TokenUsageRecord[], options: { since?: Date } = {}): TokenUsageSummaryRow[] {
  const since = options.since?.getTime();
  const rows = new Map<string, TokenUsageSummaryRow>();
  for (const item of list) {
    if (since !== undefined && Date.parse(item.at) < since) continue;
    const key = item.provider + '\u0000' + item.model;
    const row = rows.get(key) ?? { provider: item.provider, model: item.model, calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 };
    row.calls += 1;
    row.inputTokens += item.inputTokens;
    row.outputTokens += item.outputTokens;
    row.totalTokens += item.totalTokens;
    row.cachedInputTokens += item.cachedInputTokens ?? 0;
    row.reasoningTokens += item.reasoningTokens ?? 0;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}
