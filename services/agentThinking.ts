// Agent 思考强度（reasoning effort）：全局默认 + 按模型记住的选择 + 不支持该参数的模型名单，存 localStorage。
// 请求体映射只针对 /chat/completions（agent-text 线路都是 OpenAI 兼容协议，见 agentTextRoutes.isAgentTextKey）：
// - 多数服务：reasoning_effort（minimal 只发给明确接受它的 OpenAI / OpenRouter，其余降为 low）；
// - OpenRouter：reasoning: { effort }；
// - Anthropic 的 OpenAI 兼容端点：thinking: { type: 'enabled', budget_tokens }；
// - Google Gemini 的 OpenAI 兼容端点：reasoning_effort（官方兼容层支持 low/medium/high）；
// - Qwen（DashScope 兼容模式）：enable_thinking + thinking_budget。
// 原生 Anthropic Messages / Google generateContent 格式不在 Agent 线路上，所以没有 thinkingConfig 分支。

export type AgentThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';
export const AGENT_THINKING_LEVELS: readonly AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high'];
export const DEFAULT_AGENT_THINKING_LEVEL: AgentThinkingLevel = 'off';

/** Anthropic / Qwen 这类按 token 预算的服务：预算必须小于请求的 max_tokens（16384）。 */
export const THINKING_BUDGET_TOKENS: Record<Exclude<AgentThinkingLevel, 'off'>, number> = {
  minimal: 1024,
  low: 2048,
  medium: 6144,
  high: 12288,
};

const STORAGE_KEY = 'iris.agent.thinking';

interface ThinkingState {
  default: AgentThinkingLevel;
  models: Record<string, AgentThinkingLevel>;
  unsupported: Record<string, true>;
}

type RWStorage = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStorage = (): RWStorage | undefined => {
  try { return globalThis.localStorage; } catch { return undefined; }
};

export function isAgentThinkingLevel(value: unknown): value is AgentThinkingLevel {
  return AGENT_THINKING_LEVELS.includes(value as AgentThinkingLevel);
}

function emptyState(): ThinkingState {
  return { default: DEFAULT_AGENT_THINKING_LEVEL, models: {}, unsupported: {} };
}

function readState(storage: RWStorage | undefined): ThinkingState {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null') as Partial<ThinkingState> | null;
    if (!parsed || typeof parsed !== 'object') return emptyState();
    const models: Record<string, AgentThinkingLevel> = {};
    for (const [model, level] of Object.entries(parsed.models || {})) if (isAgentThinkingLevel(level)) models[model] = level;
    const unsupported: Record<string, true> = {};
    for (const [model, flag] of Object.entries(parsed.unsupported || {})) if (flag === true) unsupported[model] = true;
    return { default: isAgentThinkingLevel(parsed.default) ? parsed.default : DEFAULT_AGENT_THINKING_LEVEL, models, unsupported };
  } catch {
    return emptyState();
  }
}

const listeners = new Set<() => void>();
let version = 0;

function writeState(state: ThinkingState, storage: RWStorage | undefined): void {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 存储不可用时只影响本次 */ }
  version += 1;
  for (const listener of listeners) listener();
}

/** 供 useSyncExternalStore 订阅：任何设置变化都会通知。 */
export function subscribeAgentThinking(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const agentThinkingVersion = () => version;

/** 用户为该模型选的强度：按模型记住的优先，其次全局默认。 */
export function readAgentThinkingLevel(model: string, storage: RWStorage | undefined = defaultStorage()): AgentThinkingLevel {
  const state = readState(storage);
  return state.models[model] ?? state.default;
}

/** 实际发送的强度：已知不支持思考参数的模型一律 off。 */
export function effectiveAgentThinkingLevel(model: string, storage: RWStorage | undefined = defaultStorage()): AgentThinkingLevel {
  return isReasoningUnsupported(model, storage) ? 'off' : readAgentThinkingLevel(model, storage);
}

/** 选择即记住：写入该模型，并作为新的全局默认（其他没选过的模型跟随）。 */
export function writeAgentThinkingLevel(model: string, level: AgentThinkingLevel, storage: RWStorage | undefined = defaultStorage()): void {
  if (!isAgentThinkingLevel(level)) return;
  const state = readState(storage);
  if (model) state.models[model] = level;
  state.default = level;
  writeState(state, storage);
}

export function isReasoningUnsupported(model: string, storage: RWStorage | undefined = defaultStorage()): boolean {
  return Boolean(model && readState(storage).unsupported[model]);
}

export function markReasoningUnsupported(model: string, storage: RWStorage | undefined = defaultStorage()): void {
  if (!model) return;
  const state = readState(storage);
  if (state.unsupported[model]) return;
  state.unsupported[model] = true;
  writeState(state, storage);
}

/** 让用户重试：清掉「不支持」标记。 */
export function clearReasoningUnsupported(model: string, storage: RWStorage | undefined = defaultStorage()): void {
  const state = readState(storage);
  if (!state.unsupported[model]) return;
  delete state.unsupported[model];
  writeState(state, storage);
}

/** pi-agent-core 的 thinkingLevel 可能更细（xhigh/max）；映射到我们支持的档位。 */
export function normalizeThinkingLevel(value: unknown): AgentThinkingLevel {
  if (isAgentThinkingLevel(value)) return value;
  if (value === 'xhigh' || value === 'max') return 'high';
  return 'off';
}

export type ReasoningBodyFormat = 'openai' | 'openrouter' | 'anthropic' | 'qwen';

export function reasoningFormatFor(provider: string, baseUrl = ''): ReasoningBodyFormat {
  const url = baseUrl.toLowerCase();
  if (provider === 'openrouter' || url.includes('openrouter.ai')) return 'openrouter';
  if (provider === 'anthropic' || url.includes('api.anthropic.com')) return 'anthropic';
  if (provider === 'qwen' || url.includes('dashscope')) return 'qwen';
  return 'openai';
}

/**
 * 思考强度 → 请求体字段。off 时返回空对象（完全不发送思考参数）。
 * Anthropic 开启 thinking 时不允许自定义 temperature，调用方据 dropTemperature 去掉它。
 */
export function buildReasoningParams(
  level: AgentThinkingLevel,
  route: { provider: string; baseUrl?: string },
): { params: Record<string, unknown>; dropTemperature: boolean } {
  if (level === 'off') return { params: {}, dropTemperature: false };
  const format = reasoningFormatFor(route.provider, route.baseUrl);
  const acceptsMinimal = route.provider === 'openai' || format === 'openrouter';
  const effort = level === 'minimal' && !acceptsMinimal ? 'low' : level;
  switch (format) {
    case 'openrouter':
      return { params: { reasoning: { effort } }, dropTemperature: false };
    case 'anthropic':
      return { params: { thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET_TOKENS[level] } }, dropTemperature: true };
    case 'qwen':
      return { params: { enable_thinking: true, thinking_budget: THINKING_BUDGET_TOKENS[level] }, dropTemperature: false };
    default:
      return { params: { reasoning_effort: effort }, dropTemperature: false };
  }
}

/** HTTP 400/422 且错误正文提到 reasoning/thinking 参数：判定为该模型不支持思考参数。 */
export function isReasoningRejection(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false;
  return /reasoning|thinking/i.test(body)
    && /unsupported|not support|unknown|unrecognized|invalid|not allowed|extra (?:inputs|fields)|does not support|not permitted/i.test(body);
}
