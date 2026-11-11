// Agent 联网搜索。
// 主通道：Parallel 公共 MCP（免 Key，CORS 允许浏览器直连），契约取自 OMP 的
// `src/web/search/providers/parallel.ts` + `src/mcp/json-rpc.ts`：
//   POST https://search.parallel.ai/mcp  {jsonrpc,id,method:'tools/call',
//   params:{name:'web_search',arguments:{objective,search_queries}}}
//   → result.structuredContent | JSON.parse(result.content[].text)
// 回退：DeepSeek Search API（需要 DeepSeek Key），契约见 providers/deepseek.ts。
import type { UserApiKey } from '../types';

export type SearchRecency = 'day' | 'week' | 'month' | 'year';

export interface AgentSearchSource {
  title: string;
  url: string;
  snippet?: string;
  publishedDate?: string;
}

export interface AgentSearchCredential {
  key: string;
  baseUrl: string;
}

export interface AgentSearchResult {
  provider: 'parallel' | 'deepseek';
  sources: AgentSearchSource[];
}

const PARALLEL_MCP_URL = 'https://search.parallel.ai/mcp';
const DEFAULT_SEARCH_BASE = 'https://api.deepseek.com';
const DEFAULT_RESULTS = 10;
const MAX_RESULTS = 40;
const MAX_QUERY_CHARACTERS = 128;
const MAX_SNIPPET_CHARACTERS = 240;
const REQUEST_TIMEOUT_MS = 30_000;

export const WEB_SEARCH_TOOL_NAME = 'flovart_web_search';

export function resolveSearchCredential(keys: readonly UserApiKey[]): AgentSearchCredential | null {
  const usable = keys.filter(item => item.status !== 'error' && item.key.trim());
  const deepseek = usable.find(item => item.provider === 'deepseek')
    || usable.find(item => /deepseek/i.test(item.baseUrl || ''));
  if (!deepseek) return null;
  return { key: deepseek.key.trim(), baseUrl: (deepseek.baseUrl || DEFAULT_SEARCH_BASE).replace(/\/+$/, '') };
}

/** 相对时间落到 DeepSeek 的 after: 约束；查询里已有 after: 时不覆盖。 */
export function buildSearchQuery(raw: string, recency?: SearchRecency): string {
  const query = raw.trim();
  if (!recency || /(^|\s)after:\S+/i.test(query)) return query;
  const days = recency === 'day' ? 1 : recency === 'week' ? 7 : recency === 'month' ? 30 : 365;
  const after = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return `${query} after:${after}`;
}

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function text(value: unknown, limit = MAX_SNIPPET_CHARACTERS): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, limit) : undefined;
}

/** Parallel 结果：results[].excerpts 拼成摘要，publish_date 作为日期。 */
export function parseParallelPayload(payload: unknown, limit = DEFAULT_RESULTS): AgentSearchSource[] {
  const results = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const sources: AgentSearchSource[] = [];
  for (const item of results) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { title?: unknown; url?: unknown; excerpts?: unknown; publish_date?: unknown };
    const url = httpUrl(record.url);
    if (!url) continue;
    const excerpts = Array.isArray(record.excerpts) ? record.excerpts : [];
    sources.push({
      title: text(record.title, 200) || url,
      url,
      snippet: text(excerpts.filter(part => typeof part === 'string').join('\n\n')),
      publishedDate: typeof record.publish_date === 'string' && record.publish_date ? record.publish_date : undefined,
    });
    if (sources.length >= limit) break;
  }
  return sources;
}

/** DeepSeek 结果：summary 优先，其次 snippet。 */
export function parseSearchResponse(payload: unknown, limit = DEFAULT_RESULTS): AgentSearchSource[] {
  const results = (payload as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const sources: AgentSearchSource[] = [];
  for (const item of results) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { title?: unknown; url?: unknown; snippet?: unknown; summary?: unknown; date?: unknown };
    const url = httpUrl(record.url);
    if (!url) continue;
    sources.push({
      title: text(record.title, 200) || url,
      url,
      snippet: text(record.summary) ?? text(record.snippet),
      publishedDate: typeof record.date === 'string' && record.date ? record.date : undefined,
    });
    if (sources.length >= limit) break;
  }
  return sources;
}

interface JsonRpcMessage {
  id?: unknown;
  result?: unknown;
  error?: { message?: string };
}

/** 读 JSON-RPC 响应：普通 JSON 或 SSE；找不到匹配 id 时返回 null。 */
async function readJsonRpcResponse(response: Response, expectedId: string): Promise<JsonRpcMessage | null> {
  const matches = (payload: unknown): JsonRpcMessage | null => {
    const messages = Array.isArray(payload) ? payload : [payload];
    for (const message of messages) {
      if (message && typeof message === 'object' && (message as JsonRpcMessage).id === expectedId) return message as JsonRpcMessage;
    }
    return null;
  };
  if ((response.headers.get('Content-Type') || '').toLowerCase().includes('text/event-stream')) {
    const body = await response.text();
    for (const block of body.split(/\r?\n\r?\n/)) {
      for (const line of block.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const matched = matches(JSON.parse(data));
          if (matched) return matched;
        } catch {
          // 非 JSON 的 event data 忽略。
        }
      }
    }
    return null;
  }
  try {
    return matches(await response.json());
  } catch {
    return null;
  }
}

/** Parallel 公共 MCP：免 Key，浏览器可直连（CORS: *）。 */
export async function searchParallelWeb(params: {
  query: string;
  recency?: SearchRecency;
  limit?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<AgentSearchSource[]> {
  const count = Math.min(MAX_RESULTS, Math.max(1, Math.floor(params.limit ?? DEFAULT_RESULTS)));
  const query = params.query.trim();
  if (!query) throw new Error('搜索词不能为空');
  const requestId = Math.random().toString(36).slice(2);
  const body = {
    jsonrpc: '2.0',
    id: requestId,
    method: 'tools/call',
    params: {
      name: 'web_search',
      arguments: {
        objective: query,
        search_queries: [buildSearchQuery(query, params.recency)],
      },
    },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('搜索超时', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort(params.signal?.reason);
  params.signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await (params.fetchImpl || fetch)(PARALLEL_MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Parallel 搜索失败（${response.status}）：${detail.slice(0, 300) || response.statusText}`);
    }
    const message = await readJsonRpcResponse(response, requestId);
    if (!message) throw new Error('Parallel 搜索响应无法解析');
    if (message.error) throw new Error(`Parallel 搜索错误：${message.error.message || '未知错误'}`);
    const result = message.result as { structuredContent?: unknown; content?: Array<{ type?: string; text?: string }> } | undefined;
    if (result?.structuredContent !== undefined) return parseParallelPayload(result.structuredContent, count);
    for (const item of result?.content || []) {
      if (item?.type !== 'text' || typeof item.text !== 'string') continue;
      try {
        return parseParallelPayload(JSON.parse(item.text), count);
      } catch {
        continue;
      }
    }
    return [];
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', abort);
  }
}

/** DeepSeek Search API：有 Key 时的回退通道。 */
export async function searchDeepSeekWeb(params: {
  credential: AgentSearchCredential;
  query: string;
  recency?: SearchRecency;
  limit?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<AgentSearchSource[]> {
  const count = Math.min(50, Math.max(1, Math.floor(params.limit ?? DEFAULT_RESULTS)));
  const query = buildSearchQuery(params.query, params.recency);
  if (!query) throw new Error('搜索词不能为空');
  if ([...query].length > MAX_QUERY_CHARACTERS) {
    throw new Error(`DeepSeek 搜索词不能超过 ${MAX_QUERY_CHARACTERS} 个字符（当前 ${[...query].length}）`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('搜索超时', 'TimeoutError')), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort(params.signal?.reason);
  params.signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await (params.fetchImpl || fetch)(`${params.credential.baseUrl}/v1/tools/search`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.credential.key}`,
      },
      body: JSON.stringify({ query, count }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`DeepSeek 搜索失败（${response.status}）：${detail.slice(0, 400) || response.statusText}`);
    }
    const payload = await response.json().catch(() => null);
    return parseSearchResponse(payload, count);
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', abort);
  }
}

/** 主通道 Parallel；失败且有 DeepSeek Key 时回退，两个都失败就报合并原因。 */
export async function searchAgentWeb(params: {
  query: string;
  recency?: SearchRecency;
  limit?: number;
  signal?: AbortSignal;
  credential?: AgentSearchCredential | null;
  fetchImpl?: typeof fetch;
}): Promise<AgentSearchResult> {
  try {
    return { provider: 'parallel', sources: await searchParallelWeb(params) };
  } catch (error) {
    if (!params.credential) throw error;
    try {
      return { provider: 'deepseek', sources: await searchDeepSeekWeb({ ...params, credential: params.credential }) };
    } catch (fallback) {
      const primary = error instanceof Error ? error.message : String(error);
      const secondary = fallback instanceof Error ? fallback.message : String(fallback);
      throw new Error(`Parallel 与 DeepSeek 搜索都失败：${primary}；${secondary}`);
    }
  }
}

/** 模型可读的结果文本：编号、标题、日期、URL、摘要。 */
export function formatSearchSources(sources: readonly AgentSearchSource[]): string {
  if (!sources.length) return '没有找到可用结果。';
  return sources.map((source, index) => [
    `${index + 1}. ${source.title}${source.publishedDate ? ` (${source.publishedDate})` : ''}`,
    `   ${source.url}`,
    ...(source.snippet ? [`   ${source.snippet}`] : []),
  ].join('\n')).join('\n');
}
