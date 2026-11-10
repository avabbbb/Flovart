// Agent 联网搜索：直接调用 DeepSeek Search API（国内直连、按次计费、允许浏览器 CORS）。
// 契约取自 OMP 的 deepseek provider：POST /v1/tools/search { query, count } → { results: [{ title, url, snippet, summary, date }] }。
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

const DEFAULT_SEARCH_BASE = 'https://api.deepseek.com';
const DEFAULT_RESULTS = 10;
const MAX_RESULTS = 50;
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

/** 解析 DeepSeek 返回；只保留可点击的 http(s) 来源。 */
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

export async function searchAgentWeb(params: {
  credential: AgentSearchCredential;
  query: string;
  recency?: SearchRecency;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{ provider: 'deepseek'; sources: AgentSearchSource[] }> {
  const count = Math.min(MAX_RESULTS, Math.max(1, Math.floor(params.limit ?? DEFAULT_RESULTS)));
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
    const response = await fetch(`${params.credential.baseUrl}/v1/tools/search`, {
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
    return { provider: 'deepseek', sources: parseSearchResponse(payload, count) };
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', abort);
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
