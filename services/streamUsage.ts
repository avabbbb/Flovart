// 流式用量统计（L1 协议解析 + L3 提交）。纯被动：只读取流里已有的 usage，不估算。
// 见 docs/design/32-stream-usage.zh-CN.md。
import { extractTokenUsage, recordTokenUsage, recordUsageMissing, type TokenUsage, type UsageOutcome } from './tokenUsage';

export type StreamUsageProtocol = 'gemini' | 'anthropic' | 'openai';

export interface StreamUsageAccumulator {
    feed(event: unknown): void;
    result(): TokenUsage | null;
}

function anthropicAccumulator(): StreamUsageAccumulator {
    let start: TokenUsage | null = null;
    let output: number | undefined;
    return {
        feed(event) {
            if (!event || typeof event !== 'object') return;
            const e = event as { type?: unknown; message?: { usage?: unknown }; usage?: unknown };
            if (e.type === 'message_start' && e.message?.usage) {
                start = extractTokenUsage({ usage: e.message.usage });
            } else if (e.type === 'message_delta' && e.usage) {
                // message_delta.usage.output_tokens 是累计值，取最后一次。
                const delta = extractTokenUsage({ usage: e.usage });
                if (delta) output = delta.outputTokens;
            }
        },
        result() {
            if (!start && output === undefined) return null;
            const input = start?.inputTokens ?? 0;
            const out = output ?? start?.outputTokens ?? 0;
            return { inputTokens: input, outputTokens: out, totalTokens: input + out, cachedInputTokens: start?.cachedInputTokens };
        },
    };
}

/** Gemini usageMetadata 与 OpenAI usage 都是累计/一次性的，取最后一次出现的值。 */
function latestAccumulator(): StreamUsageAccumulator {
    let latest: TokenUsage | null = null;
    return {
        feed(event) {
            const usage = extractTokenUsage(event);
            if (usage) latest = usage;
        },
        result() { return latest; },
    };
}

export function createStreamUsageAccumulator(protocol: StreamUsageProtocol): StreamUsageAccumulator {
    return protocol === 'anthropic' ? anthropicAccumulator() : latestAccumulator();
}

export function streamOutcome(error: unknown, signal?: AbortSignal): UsageOutcome {
    if (signal?.aborted) return 'aborted';
    return (error as { name?: unknown } | null)?.name === 'AbortError' ? 'aborted' : 'error';
}

/** 流结束时调用一次：有 usage 记一条用量，没有则记一次「未返回 usage」。统计失败不影响业务。 */
export function commitStreamUsage(meta: { provider: string; model: string; source: string }, accumulator: StreamUsageAccumulator, outcome: UsageOutcome): void {
    try {
        const usage = accumulator.result();
        if (usage) recordTokenUsage({ ...meta, usage, outcome });
        else recordUsageMissing({ ...meta, outcome });
    } catch {
        // ignore
    }
}
