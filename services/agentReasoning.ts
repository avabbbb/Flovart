// 思考过程的回传规则（解析与思考强度见 agentThinking.ts / browserAgentKernel 的流解析）。
// 这里只决定：下一轮请求时，历史 assistant 消息里的 thinking 块要不要以 reasoning_content 原样回传。

/**
 * 下一轮请求时，助手消息里的思考怎么回传：
 * - DeepSeek：带 tools 的请求必须把每条 assistant 的 reasoning_content 原样回传，否则 400
 *   （api-docs.deepseek.com/guides/thinking_mode「Tool Calls」）；没有思考的旧消息补空串，与 pi-ai 的
 *   requiresReasoningContentOnAssistantMessages 一致。
 * - Kimi（Moonshot）thinking 模型同样要求在工具循环里保留 reasoning_content。
 * - 其它服务不回传：不往不认识这个字段的接口塞未知参数。
 */
export type ReasoningEcho = 'reasoning_content' | 'none';

export function reasoningEchoFor(route: { provider?: string; baseUrl?: string }): ReasoningEcho {
  const provider = String(route.provider || '').toLowerCase();
  const baseUrl = String(route.baseUrl || '').toLowerCase();
  if (provider === 'deepseek' || baseUrl.includes('deepseek.com')) return 'reasoning_content';
  if (provider === 'moonshot' || provider === 'kimi' || baseUrl.includes('moonshot.')) return 'reasoning_content';
  return 'none';
}

/** 回传时是否给没有思考的旧 assistant 消息补空 reasoning_content（只对 DeepSeek）。 */
export function requiresEmptyReasoningContent(route: { provider?: string; baseUrl?: string }): boolean {
  const provider = String(route.provider || '').toLowerCase();
  return provider === 'deepseek' || String(route.baseUrl || '').toLowerCase().includes('deepseek.com');
}
