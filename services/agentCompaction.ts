// 内置 Agent 的上下文压缩：触发阈值、上下文溢出识别与一次压缩。
// 压缩本身用 pi-agent-core 自带的 prepareCompaction / compact（摘要提示词、切点、拆分轮次都由它负责），
// 这里只提供阈值、token 估算、溢出 / 拒答区分，以及把浏览器流式线路包成 compact() 需要的 completeSimple。
// 阈值与溢出文案的取法参考 oh-my-pi（MIT，© Mario Zechner / Can Bölük / Stencil Labs）：
//   packages/agent/src/compaction/compaction.ts（effectiveReserveTokens / resolveBudgetReserveTokens / resolveThresholdTokens）
//   packages/ai/src/error/flags.ts（CONTEXT_OVERFLOW_EVIDENCE_PATTERNS、429 否决、isContextOverflow）
// 按本仓库需要自写与删减，没有逐字复制。
import { compact, prepareCompaction } from '@earendil-works/pi-agent-core';
import type { AgentMessage, Session, StreamFn } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';

/** 浏览器内核默认按 128K 上下文估算（与 buildAgent 里 model.contextWindow 一致）。 */
export const BROWSER_AGENT_CONTEXT_WINDOW = 128_000;
/** oh-my-pi / pi 的默认预留：摘要提示词 + 输出。 */
export const DEFAULT_RESERVE_TOKENS = 16_384;
/** 压缩后保留的最近上下文（oh-my-pi 默认 20000）。 */
export const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
/** 溢出后重试：保留更少的最近上下文，确保这次能塞进窗口。 */
export const OVERFLOW_KEEP_RECENT_TOKENS = 8_000;

export interface AgentCompactionSettings {
  enabled: boolean;
  /** 显式预留；缺省按 oh-my-pi：max(15% 窗口, 16384)，小窗口退回 15%。 */
  reserveTokens?: number;
  /** 百分比阈值（1-99）；<=0 用预留策略。 */
  thresholdPercent?: number;
  keepRecentTokens: number;
}

export const DEFAULT_AGENT_COMPACTION_SETTINGS: AgentCompactionSettings = {
  enabled: true,
  thresholdPercent: -1,
  keepRecentTokens: DEFAULT_KEEP_RECENT_TOKENS,
};

/** 预留：max(15% 窗口, reserveTokens 或默认 16384)。 */
export function effectiveReserveTokens(contextWindow: number, settings: AgentCompactionSettings): number {
  return Math.max(Math.floor(contextWindow * 0.15), settings.reserveTokens ?? DEFAULT_RESERVE_TOKENS);
}

/** 默认预留在小窗口里不可能成立时，退回 15% 的比例预留（与 oh-my-pi 同一规则）。 */
export function budgetReserveTokens(contextWindow: number, settings: AgentCompactionSettings): number {
  const reserve = effectiveReserveTokens(contextWindow, settings);
  const proportional = Math.max(1, Math.floor(contextWindow * 0.15));
  const defaulted = settings.reserveTokens === undefined;
  if ((defaulted && reserve >= contextWindow - proportional) || reserve >= contextWindow) return proportional;
  return reserve;
}

/** 触发压缩的 token 数：百分比优先，否则窗口减预留。 */
export function compactionThresholdTokens(contextWindow: number, settings: AgentCompactionSettings = DEFAULT_AGENT_COMPACTION_SETTINGS): number {
  const percent = settings.thresholdPercent;
  if (typeof percent === 'number' && Number.isFinite(percent) && percent > 0) {
    return Math.floor(contextWindow * (Math.min(99, Math.max(1, percent)) / 100));
  }
  return Math.max(0, Math.min(contextWindow - 1, contextWindow - budgetReserveTokens(contextWindow, settings)));
}

export function shouldCompactContext(contextTokens: number, contextWindow: number, settings: AgentCompactionSettings = DEFAULT_AGENT_COMPACTION_SETTINGS): boolean {
  if (!settings.enabled || contextWindow <= 0) return false;
  return contextTokens > compactionThresholdTokens(contextWindow, settings);
}

// ---------------------------------------------------------------------------
// token 估算：中文按约 0.7 token / 字，其余 4 字符 / token，图片约 1200 token。
// ---------------------------------------------------------------------------

const IMAGE_TOKENS = 1_200;
const CJK = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/g;

export function estimateTextTokens(text: string): number {
  const value = String(text || '');
  if (!value) return 0;
  const cjk = value.match(CJK)?.length ?? 0;
  return Math.ceil(cjk * 0.7 + (value.length - cjk) / 4);
}

function contentTokens(content: unknown): number {
  if (typeof content === 'string') return estimateTextTokens(content);
  if (!Array.isArray(content)) return 0;
  let tokens = 0;
  for (const block of content as Array<Record<string, unknown>>) {
    if (block?.type === 'text') tokens += estimateTextTokens(String(block.text || ''));
    else if (block?.type === 'image') tokens += IMAGE_TOKENS;
    else if (block?.type === 'thinking') tokens += estimateTextTokens(String(block.thinking || ''));
    else if (block?.type === 'toolCall') tokens += estimateTextTokens(String(block.name || '') + JSON.stringify(block.arguments ?? {}));
  }
  return tokens;
}

export function estimateMessageTokens(message: AgentMessage): number {
  const record = message as unknown as Record<string, unknown>;
  if (record.role === 'compactionSummary' || record.role === 'branchSummary') return estimateTextTokens(String(record.summary || ''));
  return contentTokens(record.content);
}

function usageTokens(message: AgentMessage): number {
  const record = message as unknown as { role?: string; stopReason?: string; usage?: { totalTokens?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number } };
  if (record.role !== 'assistant' || record.stopReason === 'error' || record.stopReason === 'aborted' || !record.usage) return 0;
  const usage = record.usage;
  return usage.totalTokens || (usage.input || 0) + (usage.output || 0) + (usage.cacheRead || 0) + (usage.cacheWrite || 0);
}

/**
 * 下一次请求大约要多少 token：有服务端 usage 时用「最后一次 usage + 之后新增消息估算」，
 * 但只信最近一次压缩之后产生的 usage（保留尾部里的旧 usage 反映的是压缩前的大上下文，信了会反复压缩）。
 * 没有可信 usage 时全部按字符估算，并加上系统提示词与工具定义。
 */
export function estimateRequestTokens(input: {
  messages: readonly AgentMessage[];
  systemPrompt?: string;
  toolsJson?: string;
  pendingText?: string;
  pendingImages?: number;
}): number {
  const messages = input.messages;
  // 压缩摘要之后的保留尾部仍带着压缩前的 usage：只信时间晚于最近一次压缩的 usage。
  let compactedAt = -Infinity;
  for (const message of messages) {
    const record = message as { role?: string; timestamp?: number };
    if (record.role === 'compactionSummary') compactedAt = Math.max(compactedAt, Number(record.timestamp) || 0);
  }
  let usageIndex = -1;
  let usage = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (compactedAt > -Infinity && !(Number((messages[index] as { timestamp?: number }).timestamp) > compactedAt)) continue;
    const tokens = usageTokens(messages[index]);
    if (tokens > 0) { usageIndex = index; usage = tokens; break; }
  }
  const pending = estimateTextTokens(input.pendingText || '') + (input.pendingImages || 0) * IMAGE_TOKENS;
  if (usageIndex >= 0) {
    let trailing = 0;
    for (let index = usageIndex + 1; index < messages.length; index += 1) trailing += estimateMessageTokens(messages[index]);
    return usage + trailing + pending;
  }
  let total = estimateTextTokens(input.systemPrompt || '') + estimateTextTokens(input.toolsJson || '');
  for (const message of messages) total += estimateMessageTokens(message);
  return total + pending;
}

// ---------------------------------------------------------------------------
// 请求失败分类：上下文溢出才压缩重试；拒答 / 限流 / 其它错误不压缩。
// ---------------------------------------------------------------------------

const CONTEXT_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /prompt is too long/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /input token count.*exceeds the maximum/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+/i,
  /exceeds the available context size/i,
  /requested tokens?.*exceed.*context (window|length|size)/i,
  /context (window|length|size).*(exceeded|overflow|too small)/i,
  /(prompt|input).*(too long|too large).*(context|n_ctx)/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i,
  /model_context_window_exceeded/i,
  /too many tokens/i,
  /token limit exceeded/i,
  /exceeds the limit of \d+ tokens?\b/i,
  /range of input length should be/i, // 通义千问
  /(上下文|context).{0,12}(超出|超过|过长|溢出|长度限制)/,
  /(超出|超过).{0,12}(最大|上限).{0,12}(上下文|token|长度)/i,
];

const REFUSAL_PATTERNS: readonly RegExp[] = [
  /content[_ ]?filter/i,
  /content (management )?polic(y|ies)/i,
  /safety (system|filter|policy)/i,
  /data_inspection_failed/i,
  /inappropriate content/i,
  /responsible ai/i,
  /moderation/i,
  /(敏感|违规|不安全|审核未通过|内容安全|拒绝回答)/,
];

const RATE_LIMIT = /\b429\b|rate.?limit|too many requests|quota|insufficient[_ ]?(balance|quota)|余额不足|限流/i;

export type AgentRequestFailure = 'context_overflow' | 'refusal' | 'rate_limit' | 'other';

/**
 * 把一次失败的模型请求归类。溢出要有明确证据（服务商的上下文 / token 超限文案）；
 * 429 / 额度类文案即使提到 tokens 也是限流，不当溢出（与 oh-my-pi 的 429 否决一致）；
 * 拒答（内容审核）单独归类，绝不触发压缩重试。
 */
export function classifyAgentRequestFailure(errorMessage: string | undefined | null): AgentRequestFailure {
  const text = String(errorMessage || '');
  if (!text) return 'other';
  const status = /HTTP\s*(\d{3})/i.exec(text)?.[1];
  if (status === '429' || RATE_LIMIT.test(text)) return 'rate_limit';
  if (CONTEXT_OVERFLOW_PATTERNS.some(pattern => pattern.test(text))) return 'context_overflow';
  if (REFUSAL_PATTERNS.some(pattern => pattern.test(text))) return 'refusal';
  return 'other';
}

/** 一条助手消息是不是「上下文溢出」导致的失败。 */
export function isContextOverflowMessage(message: AgentMessage | undefined | null): boolean {
  const record = message as { role?: string; stopReason?: string; errorMessage?: string } | undefined | null;
  return record?.role === 'assistant' && record.stopReason === 'error' && classifyAgentRequestFailure(record.errorMessage) === 'context_overflow';
}

// ---------------------------------------------------------------------------
// 执行一次压缩（pi-agent-core 内置）
// ---------------------------------------------------------------------------

/** 摘要要求：中文、保留 Flovart 关键事实。 */
export const COMPACTION_INSTRUCTIONS = '用中文撰写摘要。必须保留：用户的创作目标与已确认的约束（时长、画幅、风格、语言）；'
  + '画布上已创建 / 已确认的节点 id、锚点编号（A01/S01…）与生成结果状态；已读取的技能名称及其关键规则；未完成的待办与下一步。';

export interface CompactionOutcome {
  tokensBefore: number;
  summaryChars: number;
  firstKeptEntryId: string;
}

/** 把 StreamFn 包成 compact() 需要的 models.completeSimple（只用到这一个方法）。 */
export function completeSimpleViaStream(streamFn: StreamFn) {
  return {
    completeSimple: async (model: unknown, context: unknown, options: unknown): Promise<AssistantMessage> => {
      const stream = await (streamFn as unknown as (m: unknown, c: unknown, o: unknown) => unknown)(model, context, options);
      const message = await (stream as { result(): Promise<AssistantMessage> }).result();
      // compact() 拆分轮次时会合并两次摘要的 usage（含 cost）；浏览器线路的 usage 没有 cost，这里补齐。
      const usage = (message.usage || {}) as Partial<AssistantMessage['usage']>;
      return {
        ...message,
        usage: {
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          cacheRead: usage.cacheRead ?? 0,
          cacheWrite: usage.cacheWrite ?? 0,
          totalTokens: usage.totalTokens ?? 0,
          cost: usage.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        } as AssistantMessage['usage'],
      };
    },
  };
}

/**
 * 对会话当前分支做一次压缩并写入 compaction entry。没有可压缩的历史（太短）时返回 null。
 * 失败抛错，调用方决定是否继续原请求。
 */
export async function compactSession(input: {
  session: Session;
  streamFn: StreamFn;
  model: unknown;
  keepRecentTokens?: number;
  signal?: AbortSignal;
  instructions?: string;
  /** 确认有可压缩的历史、即将调用模型生成摘要时回调（用于面板显示「正在压缩」）。 */
  onStart?: () => void;
}): Promise<CompactionOutcome | null> {
  const entries = await input.session.getBranch();
  const prepared = prepareCompaction(entries, {
    enabled: true,
    reserveTokens: DEFAULT_RESERVE_TOKENS,
    keepRecentTokens: input.keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS,
  });
  if (prepared.ok === false) throw new Error((prepared as { error: Error }).error.message);
  const preparation = prepared.value;
  if (!preparation || (preparation.messagesToSummarize.length === 0 && preparation.turnPrefixMessages.length === 0)) return null;
  input.onStart?.();
  const result = await compact(
    preparation,
    completeSimpleViaStream(input.streamFn) as never,
    input.model as never,
    input.instructions ?? COMPACTION_INSTRUCTIONS,
    input.signal,
  );
  if (result.ok === false) throw new Error(`上下文压缩失败：${(result as { error: Error }).error.message}`);
  const value = result.value;
  if (!value.summary.trim()) throw new Error('上下文压缩失败：模型没有返回摘要。');
  // 不写 retainedTail：带 retainedTail 的压缩会让 getBranch 停在压缩点，下一次压缩时保留尾部既不在旧摘要里也不在新输入里。
  // 只记 firstKeptEntryId，保留的消息仍是普通 entry，再次压缩时会被正确纳入摘要。
  await input.session.appendCompaction(value.summary, value.firstKeptEntryId, value.tokensBefore, value.details, false, value.usage);
  return { tokensBefore: value.tokensBefore, summaryChars: value.summary.length, firstKeptEntryId: value.firstKeptEntryId || '' };
}
