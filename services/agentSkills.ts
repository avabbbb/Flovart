// 内置 Agent 的「渐进式技能」：系统提示词只放技能索引（名称 + 一句描述），
// 任务命中某个技能时由模型调用 iris_skill_read 读取完整 SKILL.md 或其 references/、commands/ 下的文件。
// 思路参考 oh-my-pi（MIT，© Mario Zechner / Can Bölük / Stencil Labs）：
//   packages/coding-agent/src/prompts/system/system-prompt.md 的「Matching skill → MUST read skill://<name> first」索引，
//   packages/coding-agent/src/internal-urls/skill-protocol.ts 的 skill://<name>[/<path>] 读取与越界拦截。
// 这里是浏览器侧自写实现，没有复制源码。
import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

export const SKILL_READ_TOOL_NAME = 'iris_skill_read';
/** 会话里记录「读过哪个技能文件」的自定义 entry；不进模型上下文，压缩后依然保留。 */
export const SKILL_READ_ENTRY = 'flovart.skill-read';

/** iris / open-iris 是给外部 CLI Agent 用的，不进内置 Agent 的索引，但仍可按 id 读取。 */
export const SKILL_INDEX_EXCLUDED_IDS: ReadonlySet<string> = new Set(['iris', 'open-iris']);

/** 索引里每条描述的上限：保留 still-mad 这类「不适用于…」的消歧句，又不让单条描述撑爆提示词。 */
export const SKILL_INDEX_DESCRIPTION_MAX = 400;
/** 单次读取的分页上限（字符 / 行），超出时提示下一段 offset。 */
export const SKILL_READ_PAGE_CHARS = 16_000;
export const SKILL_READ_PAGE_LINES = 400;

export interface AgentSkillEntry {
  /** 稳定 id：包目录名（如 vox-director）。 */
  id: string;
  /** 其它可用 id：manifest id（如 community.vox-director）、frontmatter name。 */
  aliases: string[];
  name: string;
  description: string;
  source: 'bundled' | 'project' | 'local';
}

/** 技能来源：同步列出索引，按 id + 包内相对路径读取原文（读不到返回 null）。 */
export interface AgentSkillCatalog {
  list(): AgentSkillEntry[];
  read(id: string, file: string): Promise<string | null>;
  /** 包内可读文件（相对路径），用于报错时提示；可选。 */
  files?(id: string): string[];
}

/** SKILL.md 的 frontmatter（--- name/description ---），只取单行键值。 */
export function parseSkillFrontmatterBlock(markdown: string): Record<string, string> {
  const text = String(markdown || '').replace(/^\uFEFF/, '');
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return {};
  const end = text.indexOf('\n---', 4);
  if (end < 0) return {};
  const result: Record<string, string> = {};
  for (const line of text.slice(4, end).split(/\r?\n/)) {
    const match = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '').trim();
    if (value) result[match[1]] = value;
  }
  return result;
}

function compactDescription(text: string): string {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= SKILL_INDEX_DESCRIPTION_MAX) return flat;
  // 优先在句末截断，避免半句话。
  const cut = flat.slice(0, SKILL_INDEX_DESCRIPTION_MAX);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('。'));
  return (sentence > SKILL_INDEX_DESCRIPTION_MAX * 0.5 ? cut.slice(0, sentence + 1) : cut) + '…';
}

/**
 * 技能索引：按 id / 别名去重（先到先得），排除外部 CLI 专用技能，按 id 排序。
 * 描述取 frontmatter description，缺省用 name。
 */
export function buildSkillIndex(entries: readonly AgentSkillEntry[], excluded: ReadonlySet<string> = SKILL_INDEX_EXCLUDED_IDS): AgentSkillEntry[] {
  const seen = new Set<string>();
  const out: AgentSkillEntry[] = [];
  for (const entry of entries) {
    const keys = [entry.id, ...entry.aliases].map(key => key.toLowerCase());
    if (keys.some(key => seen.has(key))) continue;
    keys.forEach(key => seen.add(key));
    if ([entry.id, ...entry.aliases].some(key => excluded.has(key))) continue;
    out.push({ ...entry, description: compactDescription(entry.description || entry.name) });
  }
  return out.sort((left, right) => left.id.localeCompare(right.id));
}

/** 按 id 或别名找技能（含被排除出索引的技能：它们仍可读取）。 */
export function resolveSkillEntry(entries: readonly AgentSkillEntry[], id: string): AgentSkillEntry | null {
  const wanted = String(id || '').trim().toLowerCase();
  if (!wanted) return null;
  return entries.find(entry => entry.id.toLowerCase() === wanted)
    || entries.find(entry => entry.aliases.some(alias => alias.toLowerCase() === wanted))
    || null;
}

/** 系统提示词里的技能段：索引 + 读取规则 + 本会话已读列表。 */
export function formatSkillIndexPrompt(index: readonly AgentSkillEntry[], options: { read?: readonly string[]; forced?: string | null } = {}): string {
  if (!index.length && !options.forced) return '';
  const lines = ['## 技能（Skills）'];
  if (index.length) {
    lines.push(`任务与某个技能匹配时，必须先用 ${SKILL_READ_TOOL_NAME} 读取该技能（id）再动手；不匹配时不要读。技能里提到 references/ 或 commands/ 下的文件，按需用 file 参数读取。`);
    lines.push('<skills>');
    for (const entry of index) lines.push(`- ${entry.id}：${entry.description}`);
    lines.push('</skills>');
  }
  if (options.forced) lines.push(`用户已绑定技能 ${options.forced}（强制使用）：镜头语言、风格和节奏以它为准；与用户当前要求冲突时以用户为准并说明。`);
  if (options.read?.length) lines.push(`本会话已读技能：${options.read.join('、')}。上下文压缩后若需要原文细节，用 force=true 重读。`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 路径与分页
// ---------------------------------------------------------------------------

/** 只允许 SKILL.md 与 references/、commands/ 下的文本文件；拒绝 .. / 绝对路径 / 反斜杠 / 盘符。 */
export function normalizeSkillFilePath(file?: string | null): { ok: true; path: string } | { ok: false; error: string } {
  const raw = String(file ?? '').trim();
  if (!raw || raw === 'SKILL.md' || raw === './SKILL.md') return { ok: true, path: 'SKILL.md' };
  if (raw.includes('\0') || raw.includes('\\') || /^[A-Za-z]:/.test(raw) || raw.startsWith('/') || /^[a-z]+:\/\//i.test(raw)) {
    return { ok: false, error: `不允许的路径：${raw}（只能读 SKILL.md 与 references/、commands/ 下的文件）` };
  }
  const parts = raw.replace(/^\.\//, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    return { ok: false, error: `不允许的路径：${raw}（禁止 .. 越界）` };
  }
  if (parts.length < 2 || (parts[0] !== 'references' && parts[0] !== 'commands')) {
    return { ok: false, error: `不允许的路径：${raw}（只能读 SKILL.md 与 references/、commands/ 下的文件）` };
  }
  if (!/\.(md|markdown|txt|json|ya?ml)$/i.test(parts[parts.length - 1])) {
    return { ok: false, error: `不支持的文件类型：${raw}（只读 md / txt / json / yaml）` };
  }
  return { ok: true, path: parts.join('/') };
}

export interface SkillTextPage {
  text: string;
  /** 本段起始行（1 起）。 */
  startLine: number;
  endLine: number;
  totalLines: number;
  /** 下一段起始行；读完为 null。 */
  nextOffset: number | null;
}

/** 按行分页：从 offset 行开始，累计到字符或行数上限为止；单行超长时整行切开。 */
export function paginateSkillText(text: string, offset = 1, limits: { chars?: number; lines?: number } = {}): SkillTextPage {
  const maxChars = Math.max(200, limits.chars ?? SKILL_READ_PAGE_CHARS);
  const maxLines = Math.max(1, limits.lines ?? SKILL_READ_PAGE_LINES);
  const lines = String(text ?? '').split('\n');
  const totalLines = lines.length;
  const start = Math.min(Math.max(1, Math.floor(Number(offset) || 1)), totalLines);
  const out: string[] = [];
  let chars = 0;
  let line = start;
  while (line <= totalLines && out.length < maxLines) {
    const content = lines[line - 1];
    if (out.length > 0 && chars + content.length + 1 > maxChars) break;
    out.push(out.length === 0 && content.length > maxChars ? content.slice(0, maxChars) : content);
    chars += content.length + 1;
    line += 1;
  }
  const endLine = line - 1;
  return { text: out.join('\n'), startLine: start, endLine, totalLines, nextOffset: endLine < totalLines ? endLine + 1 : null };
}

// ---------------------------------------------------------------------------
// 已读列表（会话内去重）
// ---------------------------------------------------------------------------

export interface SkillReadRecord {
  id: string;
  file: string;
  offset: number;
  /** 读取时的压缩轮次：压缩次数变化后，强制技能需要重新注入原文。 */
  epoch: number;
  forced?: boolean;
}

const readKey = (record: Pick<SkillReadRecord, 'id' | 'file' | 'offset'>) => `${record.id}\u0000${record.file}\u0000${record.offset}`;

/** 本会话读过的技能文件；由会话里的 flovart.skill-read entry 重建，所以压缩、刷新后都在。 */
export class SkillReadLedger {
  private readonly records = new Map<string, SkillReadRecord>();

  restore(records: readonly SkillReadRecord[]): void {
    this.records.clear();
    for (const record of records) if (record?.id && record.file) this.records.set(readKey(record), { ...record });
  }

  get(record: Pick<SkillReadRecord, 'id' | 'file' | 'offset'>): SkillReadRecord | undefined {
    return this.records.get(readKey(record));
  }

  add(record: SkillReadRecord): void {
    this.records.set(readKey(record), { ...record });
  }

  /** 读过的技能 id（去重，按首次读取顺序）。 */
  skillIds(): string[] {
    return [...new Set([...this.records.values()].map(record => record.id))];
  }

  /** 该技能的 SKILL.md 是否在当前压缩轮次里完整读过（强制技能据此决定是否重新注入）。 */
  hasFullRead(id: string, epoch: number): boolean {
    return [...this.records.values()].some(record => record.id === id && record.file === 'SKILL.md' && record.epoch === epoch);
  }
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

export interface SkillReadResult {
  text: string;
  details: {
    id: string;
    file: string;
    offset: number;
    nextOffset: number | null;
    totalLines: number;
    alreadyRead?: boolean;
    forced?: boolean;
    isError?: boolean;
  };
  /** 实际读取（不是「已读过」提示也不是错误）时返回，调用方据此写入会话。 */
  record?: SkillReadRecord;
}

/** 工具结果首行：面板据此显示「已读取 xxx 技能」。 */
export function skillReadHeader(id: string, file: string, page?: Pick<SkillTextPage, 'startLine' | 'endLine' | 'totalLines'>): string {
  const range = page && (page.startLine > 1 || page.endLine < page.totalLines) ? `，第 ${page.startLine}-${page.endLine} 行 / 共 ${page.totalLines} 行` : '';
  return `【技能 ${id} · ${file}${range}】`;
}

/** 解析 skillReadHeader 的首行（面板摘要用）。 */
export function parseSkillReadHeader(text: string): { id: string; file: string } | null {
  const match = /^【技能 (\S+) · ([^，】]+)/.exec(String(text || '').trim());
  return match ? { id: match[1], file: match[2] } : null;
}

export async function readSkillForAgent(input: {
  catalog: AgentSkillCatalog;
  ledger: SkillReadLedger;
  epoch: number;
  id: string;
  file?: string;
  offset?: number;
  force?: boolean;
  /** 强制技能首轮注入：整份读取、不分页。 */
  full?: boolean;
}): Promise<SkillReadResult> {
  const fail = (text: string, id = input.id, file = input.file || 'SKILL.md'): SkillReadResult => ({
    text,
    details: { id, file, offset: 1, nextOffset: null, totalLines: 0, isError: true },
  });
  const entries = input.catalog.list();
  const entry = resolveSkillEntry(entries, input.id);
  if (!entry) {
    const available = buildSkillIndex(entries).map(item => item.id).join('、') || '无';
    return fail(`未知技能：${input.id}。可用技能：${available}`);
  }
  const path = normalizeSkillFilePath(input.file);
  if (path.ok === false) return fail((path as { error: string }).error, entry.id);
  const offset = input.full ? 1 : Math.max(1, Math.floor(Number(input.offset) || 1));
  const previous = input.ledger.get({ id: entry.id, file: path.path, offset });
  if (previous && !input.force) {
    const compacted = previous.epoch !== input.epoch;
    return {
      text: `${skillReadHeader(entry.id, path.path)}\n已读过（本会话已读取${compacted ? '，但之后上下文压缩过，原文可能只剩摘要' : '，原文仍在上文'}）。需要重新查看原文时传 force=true。`,
      details: { id: entry.id, file: path.path, offset, nextOffset: null, totalLines: 0, alreadyRead: true },
    };
  }
  const content = await input.catalog.read(entry.id, path.path);
  if (content == null) {
    const files = input.catalog.files?.(entry.id) || [];
    return fail(`技能 ${entry.id} 里没有文件 ${path.path}${files.length ? `。可读文件：${files.join('、')}` : ''}`, entry.id, path.path);
  }
  const page = input.full
    ? { text: content, startLine: 1, endLine: content.split('\n').length, totalLines: content.split('\n').length, nextOffset: null }
    : paginateSkillText(content, offset);
  const more = page.nextOffset ? `\n\n（未完：继续读取请传 offset=${page.nextOffset}）` : '';
  const record: SkillReadRecord = { id: entry.id, file: path.path, offset, epoch: input.epoch, ...(input.full ? { forced: true } : {}) };
  input.ledger.add(record);
  return {
    text: `${skillReadHeader(entry.id, path.path, page)}\n${page.text}${more}`,
    details: { id: entry.id, file: path.path, offset, nextOffset: page.nextOffset, totalLines: page.totalLines, ...(input.full ? { forced: true } : {}) },
    record,
  };
}

/** iris_skill_read：只读、不触达画布、不计费；与 iris_memory 一样是内核自带工具，不进外部工具面。 */
export function createSkillReadTool(options: {
  catalog: AgentSkillCatalog;
  ledger: SkillReadLedger;
  getEpoch: () => number;
  onRead?: (record: SkillReadRecord) => void | Promise<void>;
}): AgentTool {
  return {
    name: SKILL_READ_TOOL_NAME,
    label: 'skill.read',
    description: '读取一个技能（Skill）的完整说明：id 用系统提示词技能索引里的 id；默认读 SKILL.md，file 可读该技能 references/ 或 commands/ 下的文件。'
      + `长文件分页返回（每段约 ${SKILL_READ_PAGE_LINES} 行），按提示的 offset 继续读。本会话读过的同一段会返回「已读过」，需要重读传 force=true。只读，不改画布。`,
    parameters: Type.Object({
      id: Type.String({ description: '技能 id，如 vox-director' }),
      file: Type.Optional(Type.String({ description: '技能包内相对路径：SKILL.md（默认）或 references/xxx.md、commands/xxx.md' })),
      offset: Type.Optional(Type.Number({ description: '从第几行开始读（1 起），用于长文件翻页' })),
      force: Type.Optional(Type.Boolean({ description: '已读过也重新返回原文（例如上下文压缩后）' })),
    }),
    execute: async (_toolCallId, params) => {
      const input = params as { id: string; file?: string; offset?: number; force?: boolean };
      const result = await readSkillForAgent({
        catalog: options.catalog,
        ledger: options.ledger,
        epoch: options.getEpoch(),
        id: input.id,
        file: input.file,
        offset: input.offset,
        force: input.force,
      });
      if (result.record) await options.onRead?.(result.record);
      return { content: [{ type: 'text' as const, text: result.text }], details: result.details };
    },
  };
}
