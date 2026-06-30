/**
 * Agent Chat 流式 LLM 调用（/chat/completions + tools + stream:true）
 *
 * 支持 OpenAI 兼容接口的 function calling + SSE 流式。
 * 覆盖 openai/deepseek/qwen/siliconflow/openrouter/custom/openai_compatible 等 provider。
 * Google/Anthropic 有各自原生格式，但也可通过 OpenRouter 或兼容端点使用。
 *
 * 参照 basketikun/infinite-canvas 的 requestToolResponse 模式，
 * 但用更通用的 /chat/completions 端点（而非 /responses）。
 */

import { inferProviderFromModel } from './aiGateway';
import { normalizeProviderBaseUrl } from './baseUrl';
import type { AIProvider, UserApiKey } from '../types';

// ── 类型定义 ────────────────────────────────────────────────────────

export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export interface ChatCompletionResult {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | null;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  tools: ChatToolDefinition[];
  toolChoice?: 'auto' | 'required' | 'none';
  temperature?: number;
  maxTokens?: number;
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}

// ── Provider 解析 ────────────────────────────────────────────────────

const DEFAULT_BASE_URLS: Record<AIProvider, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  deepseek: 'https://api.deepseek.com/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
  keling: 'https://api.klingai.com/v1',
  flux: 'https://api.bfl.ml/v1',
  midjourney: 'https://api.midjourney.com/v1',
  runningHub: 'https://www.runninghub.cn/openapi/v2',
  minimax: 'https://api.minimax.chat/v1',
  volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
  openrouter: 'https://openrouter.ai/api/v1',
  openai_compatible: '',
  custom: '',
};

export function resolveChatEndpoint(model: string, key: UserApiKey | undefined): { apiKey: string; baseUrl: string; provider: AIProvider } {
  const provider = key?.provider === 'custom' ? 'custom' : key?.provider || inferProviderFromModel(model);
  const apiKey = key?.key || '';
  const baseUrl = normalizeProviderBaseUrl(provider, key?.baseUrl || DEFAULT_BASE_URLS[provider]);
  return { apiKey, baseUrl, provider };
}

// ── 核心：流式 chat/completions + tools ──────────────────────────────

export async function chatCompletionWithTools(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const { model, messages, tools, toolChoice = 'auto', temperature = 0.7, maxTokens, apiKey, baseUrl, signal, onDelta } = opts;

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    tools,
    tool_choice: toolChoice,
    temperature,
    parallel_tool_calls: false,
  };
  if (maxTokens) body.max_tokens = maxTokens;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`LLM 请求失败 (${response.status}): ${text || response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法获取响应流');

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();
  let finishReason: ChatCompletionResult['finishReason'] = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload);
        const choice = json?.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta || {};
        if (delta.content) {
          content += delta.content;
          onDelta?.(delta.content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = toolCallMap.get(idx);
            if (existing) {
              if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            } else {
              toolCallMap.set(idx, {
                id: tc.id || `call_${Date.now()}_${idx}`,
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || '',
              });
            }
          }
        }
        if (choice.finish_reason) {
          finishReason = choice.finish_reason === 'tool_calls' ? 'tool_calls' : choice.finish_reason === 'stop' ? 'stop' : 'length';
        }
      } catch {
        /* skip malformed JSON */
      }
    }
  }

  const toolCalls = Array.from(toolCallMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v as ChatToolCall);

  return { content, toolCalls, finishReason };
}

// ── 便捷：构建 assistant message with tool_calls ─────────────────────

export function assistantToolMessage(content: string, toolCalls: ChatToolCall[]): Extract<ChatMessage, { role: 'assistant' }> {
  return { role: 'assistant', content: content || null, tool_calls: toolCalls.length ? toolCalls : undefined };
}

export function toolResultMessage(toolCallId: string, result: unknown): Extract<ChatMessage, { role: 'tool' }> {
  return { role: 'tool', content: JSON.stringify(result), tool_call_id: toolCallId };
}
