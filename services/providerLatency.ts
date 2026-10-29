import localforage from 'localforage';
import { nanoid } from 'nanoid';

// Provider 调用分段时延。只记录时间与结果分类，不记录 prompt、key 或响应内容。
// 样本写入独立 IndexedDB，不阻塞计费与媒体存储；用 summarizeLatency 统计 P50/P95/P99。

export type LatencyOp = 'text' | 'vision-stream' | 'video-unified';
export type LatencyOutcome = 'ok' | 'error' | 'aborted' | 'timeout';
// 相对请求开始的毫秒偏移：ttfb=响应头到达；firstChunk=首个流式片段；submitted=异步任务提交成功；generated=上游报告完成。
export type LatencyMark = 'ttfb' | 'firstChunk' | 'submitted' | 'generated';

export interface LatencyMeta {
  op: LatencyOp;
  provider: string;
  model: string;
}

export interface LatencySample extends LatencyMeta {
  id: string;
  startedAt: number;
  totalMs: number;
  marks: Partial<Record<LatencyMark, number>>;
  polls: number;
  outcome: LatencyOutcome;
}

export interface LatencySpan {
  mark(name: LatencyMark): void;
  poll(): void;
  end(): void;
  fail(error: unknown, signal?: AbortSignal): void;
}

export interface Percentiles {
  p50: number;
  p95: number;
  p99: number;
}

export interface LatencySummaryRow extends LatencyMeta {
  count: number;
  outcomes: Record<LatencyOutcome, number>;
  // 只统计成功样本；超时与取消会把尾部拉到超时阈值，单独看 outcomes。
  total?: Percentiles;
  marks: Partial<Record<LatencyMark, Percentiles>>;
  avgPolls: number;
}

const MAX_SAMPLES = 2000;
const PERSIST_DELAY_MS = 2000;
const STORE_KEY = 'samples';
const MARKS: LatencyMark[] = ['ttfb', 'firstChunk', 'submitted', 'generated'];
const store = localforage.createInstance({ name: 'flovart-latency-v1', storeName: 'samples' });

let samples: LatencySample[] = [];
let loaded: Promise<void> | undefined;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function ensureLoaded(): Promise<void> {
  loaded ??= store.getItem<LatencySample[]>(STORE_KEY)
    .then(stored => { if (stored?.length) samples = [...stored, ...samples].slice(-MAX_SAMPLES); })
    .catch(() => undefined);
  return loaded;
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    void ensureLoaded().then(() => store.setItem(STORE_KEY, samples)).catch(() => undefined);
  }, PERSIST_DELAY_MS);
}

function record(sample: LatencySample) {
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  void ensureLoaded();
  schedulePersist();
}

function failureOutcome(error: unknown, signal?: AbortSignal): Exclude<LatencyOutcome, 'ok'> {
  const cause: unknown = signal?.aborted ? signal.reason : error;
  const name = cause && typeof cause === 'object' && 'name' in cause ? String(cause.name) : '';
  if (name === 'TimeoutError') return 'timeout';
  if (name === 'AbortError' || signal?.aborted) return 'aborted';
  return 'error';
}

// 手动 span：用于多出口的异步任务（候选地址回退、轮询）。首次 end/fail 生效，之后的调用忽略。
export function startLatencySpan(meta: LatencyMeta): LatencySpan {
  const startedAt = Date.now();
  const t0 = performance.now();
  const marks: LatencySample['marks'] = {};
  let polls = 0;
  let settled = false;
  const settle = (outcome: LatencyOutcome) => {
    if (settled) return;
    settled = true;
    record({ id: nanoid(), ...meta, startedAt, totalMs: Math.round(performance.now() - t0), marks, polls, outcome });
  };
  return {
    mark(name) { if (!settled) marks[name] ??= Math.round(performance.now() - t0); },
    poll() { polls += 1; },
    end() { settle('ok'); },
    fail(error, signal) { settle(failureOutcome(error, signal)); },
  };
}

export async function trackLatency<T>(meta: LatencyMeta, signal: AbortSignal | undefined, run: (span: LatencySpan) => Promise<T>): Promise<T> {
  const span = startLatencySpan(meta);
  try {
    const result = await run(span);
    span.end();
    return result;
  } catch (error) {
    span.fail(error, signal);
    throw error;
  }
}

// nearest-rank 百分位。
function percentiles(values: number[]): Percentiles | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const at = (q: number) => sorted[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}

export function summarizeLatency(input: readonly LatencySample[]): LatencySummaryRow[] {
  const groups = new Map<string, LatencySample[]>();
  for (const sample of input) {
    const groupKey = sample.op + '|' + sample.provider + '|' + sample.model;
    const group = groups.get(groupKey);
    if (group) group.push(sample);
    else groups.set(groupKey, [sample]);
  }
  return [...groups.values()].map(group => {
    const outcomes: Record<LatencyOutcome, number> = { ok: 0, error: 0, aborted: 0, timeout: 0 };
    for (const sample of group) outcomes[sample.outcome] += 1;
    const marks: LatencySummaryRow['marks'] = {};
    for (const name of MARKS) {
      const stats = percentiles(group.flatMap(sample => sample.marks[name] === undefined ? [] : [sample.marks[name]!]));
      if (stats) marks[name] = stats;
    }
    const { op, provider, model } = group[0];
    return {
      op,
      provider,
      model,
      count: group.length,
      outcomes,
      total: percentiles(group.filter(sample => sample.outcome === 'ok').map(sample => sample.totalMs)),
      marks,
      avgPolls: Math.round(group.reduce((sum, sample) => sum + sample.polls, 0) / group.length),
    };
  }).sort((a, b) => b.count - a.count);
}

export async function getLatencySamples(): Promise<LatencySample[]> {
  await ensureLoaded();
  return [...samples];
}

export async function clearLatencySamples(): Promise<void> {
  samples = [];
  loaded = Promise.resolve();
  await store.removeItem(STORE_KEY).catch(() => undefined);
}

// DevTools 入口：await flovartLatency.summary()
if (typeof window !== 'undefined') {
  Object.assign(window, {
    flovartLatency: {
      summary: async () => summarizeLatency(await getLatencySamples()),
      samples: getLatencySamples,
      clear: clearLatencySamples,
    },
  });
}
