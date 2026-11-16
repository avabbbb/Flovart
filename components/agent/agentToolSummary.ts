// 工具卡的人话摘要与「查看原始数据」的脱敏：卡片默认只显示 图标 + 中文工具名 + 一句摘要 + 缩略图 + 状态，
// 原始 JSON 收在折叠里，且长字符串 / base64 / 内部图片数据先截断，避免整页 base64 与嵌套横向滚动。
// 纯函数：面板与测试共用；摘要只从工具真实的参数与结果推出，不编造。

export interface AgentToolThumbnail {
  src: string;
  alt: string;
}

export interface AgentToolSummary {
  /** 一句话摘要；没有可说的就为空串（卡片只显示标题与状态）。 */
  text: string;
  thumbnails: AgentToolThumbnail[];
}

export interface AgentToolSummaryInput {
  toolName?: string;
  args?: unknown;
  result?: unknown;
  status?: 'pending' | 'success' | 'error' | 'denied';
  language?: 'en' | 'zho';
}

const MAX_THUMBNAILS = 6;
const MAX_NAMES = 4;
const MAX_LINE = 120;

type Lang = 'en' | 'zho';
const pick = (language: Lang, zho: string, en: string) => (language === 'en' ? en : zho);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** 工具结果（AgentToolResult：{ content: [{type:'text'|'image'}], details }）里的文字部分。 */
export function toolResultText(result: unknown): string {
  const content = asRecord(result)?.content;
  if (!Array.isArray(content)) return typeof result === 'string' ? result : '';
  return content
    .map(item => asRecord(item))
    .filter(item => item?.type === 'text' && typeof item.text === 'string')
    .map(item => String(item!.text))
    .join('\n');
}

/** 结果里的图片块 → 缩略图（data URL）；最多 6 张。 */
export function toolResultThumbnails(result: unknown, names: string[] = [], language: Lang = 'zho'): AgentToolThumbnail[] {
  const content = asRecord(result)?.content;
  if (!Array.isArray(content)) return [];
  const out: AgentToolThumbnail[] = [];
  for (const raw of content) {
    const item = asRecord(raw);
    if (item?.type !== 'image' || typeof item.data !== 'string' || !item.data) continue;
    const mime = typeof item.mimeType === 'string' && /^image\/[a-z0-9.+-]+$/i.test(item.mimeType) ? item.mimeType : 'image/png';
    const src = item.data.startsWith('data:') ? item.data : 'data:' + mime + ';base64,' + item.data;
    out.push({ src, alt: names[out.length] || pick(language, '画面 ', 'Frame ') + (out.length + 1) });
    if (out.length >= MAX_THUMBNAILS) break;
  }
  return out;
}

/** 名字列表：「图片1、图片2、图片5 等 6 个」。 */
export function joinNames(names: string[], language: Lang = 'zho'): string {
  const unique = [...new Set(names.filter(Boolean))];
  const shown = unique.slice(0, MAX_NAMES);
  const rest = unique.length - shown.length;
  const sep = language === 'en' ? ', ' : '、';
  if (rest <= 0) return shown.join(sep);
  return shown.join(sep) + pick(language, ` 等 ${unique.length} 个`, ` and ${rest} more`);
}

function firstLine(text: string): string {
  const line = text.split('\n').map(item => item.trim()).find(Boolean) || '';
  return line.length > MAX_LINE ? line.slice(0, MAX_LINE - 1) + '…' : line;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed || !/^[[{]/.test(trimmed)) return undefined;
  try { return JSON.parse(trimmed); } catch { return undefined; }
}

/** media_view 的 notes：「<nodeId>：图片「图片 1」」「<nodeId>：视频「视频 2」帧 first/last」。 */
function mediaViewNames(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split('\n')) {
    const match = /：(?:图片|视频)「(.+?)」/.exec(line);
    if (match) names.push(match[1]);
  }
  return names;
}

function nodeTitles(value: unknown): string[] {
  const nodes = Array.isArray(value) ? value : asRecord(value)?.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.map(node => {
    const record = asRecord(node);
    return String(record?.title || record?.label || record?.name || '');
  }).filter(Boolean);
}

function countOf(value: unknown, key: string): number | undefined {
  const list = asRecord(value)?.[key];
  return Array.isArray(list) ? list.length : undefined;
}

function answerSummary(result: unknown, language: Lang): string {
  const details = asRecord(asRecord(result)?.details) || asRecord(parseJson(toolResultText(result)));
  const data = asRecord(details?.data);
  if (!data) return '';
  const values = Object.values(data).map(value => Array.isArray(value) ? value.join(' / ') : String(value)).filter(Boolean);
  if (!values.length) return '';
  return pick(language, '你的回答：', 'Answered: ') + values.map(value => value.length > 40 ? value.slice(0, 39) + '…' : value).join(pick(language, '；', '; '));
}

/** 工具卡的一句话摘要 + 缩略图。 */
export function summarizeToolCall(input: AgentToolSummaryInput): AgentToolSummary {
  const language: Lang = input.language === 'en' ? 'en' : 'zho';
  const name = String(input.toolName || '');
  const args = asRecord(input.args);
  const text = toolResultText(input.result);
  const status = input.status || 'pending';
  const none: AgentToolSummary = { text: '', thumbnails: [] };

  if (status === 'error' || status === 'denied') {
    const line = firstLine(text);
    return { text: line || (status === 'denied' ? pick(language, '已拒绝执行', 'Denied') : pick(language, '执行失败', 'Failed')), thumbnails: [] };
  }

  if (name === 'flovart_ask') {
    if (status === 'pending') return { text: pick(language, '请在下方表单里回答', 'Answer in the form below'), thumbnails: [] };
    return { text: answerSummary(input.result, language), thumbnails: [] };
  }

  if (name === 'flovart_workflow_media_view') {
    const ids = Array.isArray(args?.nodeIds) ? args!.nodeIds.length : 0;
    if (status === 'pending') return { text: ids ? pick(language, `查看 ${ids} 个节点的画面`, `Viewing ${ids} node${ids === 1 ? '' : 's'}`) : '', thumbnails: [] };
    const names = mediaViewNames(text);
    const thumbnails = toolResultThumbnails(input.result, names, language);
    const count = names.length || thumbnails.length;
    if (!count) return { text: firstLine(text), thumbnails };
    return {
      text: pick(language, `读取了 ${count} 个节点：`, `Viewed ${count} node${count === 1 ? '' : 's'}: `) + joinNames(names, language),
      thumbnails,
    };
  }

  if (status === 'pending') return none;

  if (name === 'flovart_workflow_inspect' || name === 'flovart_workflow_selection_get') {
    const json = parseJson(text);
    const titles = nodeTitles(json);
    const nodes = countOf(json, 'nodes') ?? (Array.isArray(json) ? json.length : undefined);
    const edges = countOf(json, 'edges') ?? countOf(json, 'connections');
    if (name === 'flovart_workflow_selection_get') {
      if (!nodes) return { text: pick(language, '当前没有选中节点', 'Nothing selected'), thumbnails: [] };
      return { text: pick(language, `读取了 ${nodes} 个选中节点：`, `Read ${nodes} selected: `) + joinNames(titles, language), thumbnails: [] };
    }
    if (nodes !== undefined) {
      const edgeText = edges === undefined ? '' : pick(language, `、${edges} 条连线`, `, ${edges} links`);
      return { text: pick(language, `读取了画布：${nodes} 个节点`, `Read canvas: ${nodes} nodes`) + edgeText, thumbnails: [] };
    }
    return { text: firstLine(text), thumbnails: [] };
  }

  if (name === 'flovart_web_search' || name === 'flovart_grep') {
    const query = String(args?.query || args?.pattern || args?.q || '').trim();
    if (query) return { text: pick(language, `搜索「${query.slice(0, 60)}」`, `Searched “${query.slice(0, 60)}”`), thumbnails: [] };
  }

  if (name === 'flovart_todo') {
    const items = Array.isArray(args?.todos) ? args!.todos.length : Array.isArray(args?.items) ? args!.items.length : 0;
    if (items) return { text: pick(language, `更新了 ${items} 项任务`, `Updated ${items} task${items === 1 ? '' : 's'}`), thumbnails: [] };
  }

  if (name === 'flovart_workflow_apply') {
    const operations = Array.isArray(args?.operations) ? args!.operations.length : Array.isArray(args?.ops) ? args!.ops.length : 0;
    if (operations) return { text: pick(language, `对画布做了 ${operations} 项修改`, `Applied ${operations} change${operations === 1 ? '' : 's'}`), thumbnails: [] };
  }

  // 其余工具：结果的第一行（JSON 结果不直接展示）。
  return { text: parseJson(text) === undefined ? firstLine(text) : '', thumbnails: toolResultThumbnails(input.result, [], language) };
}

// ---------------------------------------------------------------------------
// 原始数据脱敏
// ---------------------------------------------------------------------------

const MAX_STRING = 240;
const MAX_ARRAY = 40;
const MAX_DEPTH = 6;
const BASE64ISH = /^[A-Za-z0-9+/=\r\n_-]{200,}$/;

function sizeLabel(chars: number): string {
  const bytes = Math.round(chars * 0.75);
  return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function trimString(value: string, language: Lang): string {
  if (value.startsWith('data:') && value.length > 64) {
    const mime = /^data:([^;,]+)/.exec(value)?.[1] || 'binary';
    return pick(language, `[${mime} 数据 · ${sizeLabel(value.length)}]`, `[${mime} data · ${sizeLabel(value.length)}]`);
  }
  if (BASE64ISH.test(value)) return pick(language, `[二进制数据 · ${sizeLabel(value.length)}]`, `[binary data · ${sizeLabel(value.length)}]`);
  if (value.length <= MAX_STRING) return value;
  return value.slice(0, MAX_STRING) + pick(language, `…（另有 ${value.length - MAX_STRING} 字）`, `… (+${value.length - MAX_STRING} chars)`);
}

/** 「查看原始数据」用：截断长字符串与 base64、图片块只留类型与大小、数组与层级封顶。 */
export function sanitizeToolDetail(value: unknown, language: Lang = 'zho', depth = 0): unknown {
  if (typeof value === 'string') return trimString(value, language);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[… ${value.length}]` : '{…}';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map(item => sanitizeToolDetail(item, language, depth + 1));
    if (value.length > MAX_ARRAY) items.push(pick(language, `…（另有 ${value.length - MAX_ARRAY} 项）`, `… (+${value.length - MAX_ARRAY} items)`));
    return items;
  }
  const record = value as Record<string, unknown>;
  if (record.type === 'image' && typeof record.data === 'string') {
    return { type: 'image', mimeType: record.mimeType, data: pick(language, `[图片数据 · ${sizeLabel(record.data.length)}]`, `[image data · ${sizeLabel(record.data.length)}]`) };
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) out[key] = sanitizeToolDetail(item, language, depth + 1);
  return out;
}

/** 原始数据面板的文本：参数与结果各一段，已脱敏。 */
export function toolRawText(args: unknown, result: unknown, language: Lang = 'zho'): string {
  const parts: Record<string, unknown> = {};
  if (args !== undefined) parts[pick(language, '参数', 'args')] = sanitizeToolDetail(args, language);
  if (result !== undefined) parts[pick(language, '结果', 'result')] = sanitizeToolDetail(result, language);
  return JSON.stringify(parts, null, 2);
}

/** 步骤行右侧的等宽用时：<1s 用 ms，<60s 一位小数秒，再长用 1m 05s。 */
export function formatToolDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '';
  const value = Math.max(0, ms);
  if (value < 1000) return Math.round(value) + 'ms';
  if (value < 60_000) return (Math.floor(value / 100) / 10).toFixed(1) + 's';
  const seconds = Math.floor(value / 1000);
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/** 步骤卡头部：「3 个步骤 · 执行中」/「3 个步骤 · 已完成」/「… · 1 个失败」。只数真实状态。 */
export function toolStepsHeadline(statuses: ReadonlyArray<'pending' | 'success' | 'error' | 'denied' | undefined>, running: boolean, language: Lang = 'zho'): { count: string; state: string; tone: 'active' | 'done' | 'error' | 'idle' } {
  const total = statuses.length;
  const failed = statuses.filter(status => status === 'error' || status === 'denied').length;
  const pending = statuses.filter(status => !status || status === 'pending').length;
  const count = language === 'en' ? `${total} step${total === 1 ? '' : 's'}` : `${total} 个步骤`;
  if (pending && running) return { count, state: pick(language, '执行中', 'Running'), tone: 'active' };
  if (pending) return { count, state: pick(language, '未完成', 'Interrupted'), tone: 'idle' };
  if (failed) return { count, state: pick(language, `${failed} 个失败`, `${failed} failed`), tone: 'error' };
  return { count, state: pick(language, '已完成', 'Done'), tone: 'done' };
}
