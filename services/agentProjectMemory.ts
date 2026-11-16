// 项目记忆：内置 Agent 按 Flovart 项目保存的长期事实（用户偏好、已确认的风格 / 角色设定、命名约定等）。
// 纯函数 + 工具定义；持久化在 stores/useAgentMemoryStore.ts（zustand + localforage）。
//
// 容量策略（参考 oh-my-pi，MIT：packages/coding-agent/src/memories/settings.ts 的 maxRawMemoriesForGlobal=200
// 与 memories/storage.ts 按 updated_at DESC LIMIT 取最近条目）：每个项目最多 100 条，超出时淘汰最旧的
// （按 updatedAt），新事实永远能写进去；重复内容只刷新时间，不占新条目。
// 脱敏参考 oh-my-pi 的 packages/coding-agent/src/memory-backend/redact.ts：记忆会回灌进每一轮提示词，
// 写入前先抹掉像密钥 / Token / 密码的内容。本文件为自写实现。
import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

export const MEMORY_TOOL_NAME = 'flovart_memory';
export const MEMORY_MAX_ENTRIES = 100;
export const MEMORY_MAX_TEXT = 500;
/** 注入系统提示词的记忆摘要上限（字符）。 */
export const MEMORY_SUMMARY_MAX_CHARS = 1_500;
export const REDACTED = '[已脱敏]';

export interface AgentMemoryEntry {
  id: string;
  text: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// 脱敏
// ---------------------------------------------------------------------------

/** 固定前缀的服务商密钥 / Token。 */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic / DeepSeek 等
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, // AWS
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bnpm_[A-Za-z0-9]{30,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAIza[A-Za-z0-9_-]{30,}/g, // Google
  /\bhf_[A-Za-z0-9]{30,}/g, // Hugging Face
  /\br8_[A-Za-z0-9]{30,}/g, // Replicate
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** 「Bearer xxx」「Authorization: xxx」 */
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi;
/** 键名 + 分隔符 + 值：api_key=xxx、password: xxx、token：xxx、密码是 xxx、密钥 xxx。 */
const KEYED_SECRET = /((?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|client[_-]?secret|secret|token|access[_-]?token|refresh[_-]?token|password|passwd|pwd|authorization|密码|口令|密钥|令牌|秘钥|token)\s*(?:[:=：]|是|为)\s*)(["']?)([^\s"'，。,;；]{4,})\2/gi;
/** URL 查询参数里的 key / token / signature。 */
const URL_SECRET = /([?&](?:key|api_key|apikey|token|access_token|sig|signature|secret)=)[^&#\s]+/gi;
/** 无键名的长串：同时含字母和数字、≥32 位的连续 token（典型裸密钥）。 */
const BARE_LONG_TOKEN = /\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/g;

/** 抹掉像密钥 / Token / 密码的片段；返回脱敏后的文本与是否改动。 */
export function redactMemorySecrets(input: string): { text: string; redacted: boolean } {
  let text = String(input ?? '');
  const before = text;
  for (const pattern of TOKEN_PATTERNS) text = text.replace(pattern, REDACTED);
  text = text.replace(BEARER, (_match, kind: string) => `${kind} ${REDACTED}`);
  text = text.replace(URL_SECRET, (_match, prefix: string) => `${prefix}${REDACTED}`);
  text = text.replace(KEYED_SECRET, (match, prefix: string, quote: string, value: string) => (value === REDACTED || value.startsWith('[已脱敏') ? match : `${prefix}${quote}${REDACTED}${quote}`));
  text = text.replace(BARE_LONG_TOKEN, match => (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(match) ? match : REDACTED)); // UUID 不是秘密
  return { text, redacted: text !== before };
}

// ---------------------------------------------------------------------------
// 列表操作（纯函数）
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

export type AddMemoryResult =
  | { ok: true; entries: AgentMemoryEntry[]; entry: AgentMemoryEntry; evicted: AgentMemoryEntry[]; redacted: boolean; duplicate: boolean }
  | { ok: false; error: string };

/** 新增一条记忆：脱敏 → 去重（相同文本只刷新时间）→ 超过上限淘汰最旧。 */
export function addMemoryEntry(
  entries: readonly AgentMemoryEntry[],
  input: { text: string; tags?: string[] },
  options: { now?: number; id?: string; max?: number } = {},
): AddMemoryResult {
  const raw = normalizeText(input.text);
  if (!raw) return { ok: false, error: '记忆内容不能为空。' };
  if (raw.length > MEMORY_MAX_TEXT) return { ok: false, error: `单条记忆最多 ${MEMORY_MAX_TEXT} 字，请先提炼成一句事实。` };
  const { text, redacted } = redactMemorySecrets(raw);
  if (!normalizeText(text.split(REDACTED).join(''))) return { ok: false, error: '内容只有密钥 / Token 一类的秘密，不能写入记忆。' };
  const now = options.now ?? Date.now();
  const tags = (input.tags || []).map(tag => normalizeText(tag)).filter(Boolean).slice(0, 8);
  const existing = entries.find(entry => entry.text === text);
  if (existing) {
    const entry = { ...existing, ...(tags.length ? { tags } : {}), updatedAt: now };
    return { ok: true, entries: [entry, ...entries.filter(item => item.id !== existing.id)], entry, evicted: [], redacted, duplicate: true };
  }
  const entry: AgentMemoryEntry = { id: options.id ?? crypto.randomUUID(), text, ...(tags.length ? { tags } : {}), createdAt: now, updatedAt: now };
  const max = Math.max(1, options.max ?? MEMORY_MAX_ENTRIES);
  // 新的在前；超出上限按 updatedAt 淘汰最旧的。
  const sorted = [entry, ...entries].sort((left, right) => right.updatedAt - left.updatedAt);
  return { ok: true, entries: sorted.slice(0, max), entry, evicted: sorted.slice(max), redacted, duplicate: false };
}

export function removeMemoryEntry(entries: readonly AgentMemoryEntry[], id: string): { entries: AgentMemoryEntry[]; removed: AgentMemoryEntry | null } {
  const removed = entries.find(entry => entry.id === id) || null;
  return { entries: entries.filter(entry => entry.id !== id), removed };
}

/** 关键词搜索：按空白拆词，命中词数多的在前，同分按新旧。 */
export function searchMemoryEntries(entries: readonly AgentMemoryEntry[], query: string, limit = 20): AgentMemoryEntry[] {
  const terms = normalizeText(query).toLowerCase().split(' ').filter(Boolean);
  if (!terms.length) return [...entries].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, limit);
  return entries
    .map(entry => {
      const haystack = (entry.text + ' ' + (entry.tags || []).join(' ')).toLowerCase();
      return { entry, score: terms.filter(term => haystack.includes(term)).length };
    })
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || right.entry.updatedAt - left.entry.updatedAt)
    .slice(0, limit)
    .map(item => item.entry);
}

/** 系统提示词里的记忆段：最新的在前，超出字符上限截断并注明还有多少条。 */
export function formatMemorySummary(entries: readonly AgentMemoryEntry[], maxChars = MEMORY_SUMMARY_MAX_CHARS): string {
  if (!entries.length) return '';
  const sorted = [...entries].sort((left, right) => right.updatedAt - left.updatedAt);
  const lines: string[] = [];
  let used = 0;
  for (const entry of sorted) {
    const line = `- [${entry.id.slice(0, 8)}] ${entry.text}`;
    if (used + line.length > maxChars && lines.length) break;
    lines.push(line);
    used += line.length + 1;
  }
  const rest = sorted.length - lines.length;
  return [
    '## 项目记忆',
    `以下是本项目此前保存的事实（共 ${sorted.length} 条${rest ? `，另有 ${rest} 条未列出，可用 ${MEMORY_TOOL_NAME} search 查找` : ''}）。与用户当前要求冲突时以用户为准；发现过时的条目用 ${MEMORY_TOOL_NAME} delete 删掉。`,
    ...lines,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 记忆的读写接口；内核默认用 useAgentMemoryStore，测试可注入内存实现。 */
export interface AgentMemoryBackend {
  list(projectId: string): Promise<AgentMemoryEntry[]>;
  add(projectId: string, input: { text: string; tags?: string[] }): Promise<AddMemoryResult>;
  remove(projectId: string, id: string): Promise<AgentMemoryEntry | null>;
}

/** 内存实现：测试与没有持久化时用。 */
export function createInMemoryMemoryBackend(seed: Record<string, AgentMemoryEntry[]> = {}): AgentMemoryBackend {
  const byProject = new Map(Object.entries(seed).map(([key, value]) => [key, [...value]]));
  return {
    list: async projectId => [...(byProject.get(projectId) || [])],
    add: async (projectId, input) => {
      const result = addMemoryEntry(byProject.get(projectId) || [], input);
      if (result.ok) byProject.set(projectId, result.entries);
      return result;
    },
    remove: async (projectId, id) => {
      const { entries, removed } = removeMemoryEntry(byProject.get(projectId) || [], id);
      byProject.set(projectId, entries);
      return removed;
    },
  };
}

/** 支持按完整 id 或 8 位前缀（系统提示词里显示的那段）删除。 */
function findById(entries: readonly AgentMemoryEntry[], id: string): AgentMemoryEntry | undefined {
  const wanted = String(id || '').trim().replace(/^\[|\]$/g, '');
  if (!wanted) return undefined;
  return entries.find(entry => entry.id === wanted) || (wanted.length >= 6 ? entries.find(entry => entry.id.startsWith(wanted)) : undefined);
}

export function createMemoryTool(options: { projectId: string; backend: AgentMemoryBackend; onChange?: () => void }): AgentTool {
  const { projectId, backend } = options;
  const format = (entries: AgentMemoryEntry[]) => entries.map(entry => `- [${entry.id.slice(0, 8)}] ${entry.text}${entry.tags?.length ? `（${entry.tags.join('、')}）` : ''}`).join('\n');
  return {
    name: MEMORY_TOOL_NAME,
    label: 'memory',
    description: '项目记忆（只属于当前 Flovart 项目，保存在本机）。action=add 写入一句以后还用得上的事实（用户偏好、确认过的风格 / 角色设定、命名约定），'
      + 'list 列出，search 按关键词查，delete 按 id 删除过时条目。'
      + `每个项目最多 ${MEMORY_MAX_ENTRIES} 条，满了自动淘汰最旧的；密钥、Token、密码会被自动脱敏，不要写入秘密，也不要记一次性的过程信息。`,
    parameters: Type.Object({
      action: Type.Union([Type.Literal('add'), Type.Literal('list'), Type.Literal('search'), Type.Literal('delete')]),
      text: Type.Optional(Type.String({ description: 'add：要记住的一句事实（≤500 字）' })),
      tags: Type.Optional(Type.Array(Type.String(), { description: 'add：可选标签，如 风格、角色' })),
      query: Type.Optional(Type.String({ description: 'search：关键词，空格分隔' })),
      id: Type.Optional(Type.String({ description: 'delete：条目 id（可用列表里的 8 位前缀）' })),
    }),
    execute: async (_toolCallId, params) => {
      const input = params as { action: string; text?: string; tags?: string[]; query?: string; id?: string };
      const reply = (text: string, details: Record<string, unknown>) => ({ content: [{ type: 'text' as const, text }], details });
      if (input.action === 'add') {
        const result = await backend.add(projectId, { text: input.text || '', tags: input.tags });
        if (result.ok === false) return reply((result as { error: string }).error, { action: 'add', isError: true });
        options.onChange?.();
        const notes = [
          result.duplicate ? '已存在相同记忆，已刷新时间。' : `已记住：${result.entry.text}`,
          result.redacted ? '（内容里像密钥 / Token / 密码的部分已脱敏）' : '',
          result.evicted.length ? `（已达 ${MEMORY_MAX_ENTRIES} 条上限，淘汰了最旧的 ${result.evicted.length} 条）` : '',
        ].filter(Boolean);
        return reply(notes.join(''), { action: 'add', id: result.entry.id, redacted: result.redacted, evicted: result.evicted.length, count: result.entries.length });
      }
      if (input.action === 'list' || input.action === 'search') {
        const entries = await backend.list(projectId);
        const found = input.action === 'search' ? searchMemoryEntries(entries, input.query || '') : searchMemoryEntries(entries, '', MEMORY_MAX_ENTRIES);
        if (!found.length) return reply(input.action === 'search' ? `没有找到与「${input.query || ''}」相关的记忆。` : '本项目还没有记忆。', { action: input.action, count: 0 });
        return reply(format(found), { action: input.action, count: found.length, total: entries.length });
      }
      if (input.action === 'delete') {
        const entries = await backend.list(projectId);
        const target = findById(entries, input.id || '');
        if (!target) return reply(`没有找到 id 为 ${input.id || '（空）'} 的记忆。`, { action: 'delete', isError: true });
        await backend.remove(projectId, target.id);
        options.onChange?.();
        return reply(`已删除记忆：${target.text}`, { action: 'delete', id: target.id });
      }
      return reply(`未知 action：${input.action}（可用 add / list / search / delete）`, { action: input.action, isError: true });
    },
  };
}
