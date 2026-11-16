// 节点搜索（workflow.nodes.search）与锚点短编号：纯函数。
// Agent 不必每次 inspect 整张画布，按名称 / 类型 / 锚点编号 / 状态查节点，只拿精简结果；
// 锚点编号（A01 角色 / S01 场景 / P01 道具 / F01 风格）用于“A02 + S02 重拍第 3 镜”这类引用。
import type { WorkflowAnchorKind, WorkflowNode } from './types';

export const ANCHOR_CODE_PREFIX: Record<WorkflowAnchorKind, string> = {
  character: 'A',
  scene: 'S',
  product: 'P',
  style: 'F',
};

/**
 * 已批准锚点的短编号：按种类分别从 01 编号，顺序为批准时间 → 画布位置（上→下、左→右）→ id，
 * 新批准的锚点排在后面，已有编号不变（撤销批准会让同类后面的编号前移）。
 */
export function assignAnchorCodes(nodes: readonly WorkflowNode[]): Map<string, string> {
  const approved = nodes.filter(node => node.anchor?.approved === true && ANCHOR_CODE_PREFIX[node.anchor.kind]);
  const approvedAt = (node: WorkflowNode) => {
    const time = Date.parse(node.anchor?.approvedAt || '');
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
  };
  const sorted = [...approved].sort((a, b) => {
    const ta = approvedAt(a);
    const tb = approvedAt(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    const dy = (a.position?.y ?? 0) - (b.position?.y ?? 0);
    if (dy !== 0) return dy;
    const dx = (a.position?.x ?? 0) - (b.position?.x ?? 0);
    if (dx !== 0) return dx;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const counters = new Map<string, number>();
  const codes = new Map<string, string>();
  for (const node of sorted) {
    const prefix = ANCHOR_CODE_PREFIX[node.anchor!.kind];
    const next = (counters.get(prefix) || 0) + 1;
    counters.set(prefix, next);
    codes.set(node.id, prefix + String(next).padStart(2, '0'));
  }
  return codes;
}

/** "a2" / "A02" / "a002" → "A02"；不是锚点编号返回 undefined。 */
export function normalizeAnchorCode(value: string): string | undefined {
  const match = /^\s*([ASPF])\s*0*(\d{1,3})\s*$/i.exec(value);
  if (!match) return undefined;
  const number = Number(match[2]);
  if (!number) return undefined;
  return match[1].toUpperCase() + String(number).padStart(2, '0');
}

/** 文本里的锚点编号与镜号，例如 "A02 + S02 重拍第 3 镜" → codes [A02, S02]，shots [3]。 */
export function parseAnchorReferences(text: string): { codes: string[]; shots: number[] } {
  const codes: string[] = [];
  for (const match of text.matchAll(/(?<![A-Za-z0-9])([ASPF])0*(\d{1,3})(?![A-Za-z0-9])/gi)) {
    const code = normalizeAnchorCode(match[1] + match[2]);
    if (code && !codes.includes(code)) codes.push(code);
  }
  const shots: number[] = [];
  for (const match of text.matchAll(/(?:第\s*(\d{1,3})\s*(?:镜|个镜头)|(?:shot|镜头)\s*#?\s*(\d{1,3}))/gi)) {
    const index = Number(match[1] || match[2]);
    if (index && !shots.includes(index)) shots.push(index);
  }
  return { codes, shots };
}

export type WorkflowNodeSearchStatus = 'empty' | 'running' | 'done' | 'error';

function metadataOf(node: WorkflowNode): Record<string, unknown> {
  return (node.metadata || {}) as Record<string, unknown>;
}

export function nodeHasMedia(node: WorkflowNode): boolean {
  const metadata = metadataOf(node);
  return Boolean(metadata.href || metadata.storageKey || metadata.artifactRef || metadata.remoteUrl);
}

/** 节点状态归一：生成/上传中 → running；失败 → error；有产物或成功 → done；其余 → empty。 */
export function nodeSearchStatus(node: WorkflowNode): WorkflowNodeSearchStatus {
  const metadata = metadataOf(node);
  if (metadata.status === 'loading' || metadata.uploading === true) return 'running';
  if (metadata.status === 'error') return 'error';
  if (metadata.status === 'success' || nodeHasMedia(node)) return 'done';
  if (node.type === 'text' && typeof metadata.content === 'string' && metadata.content.trim()) return 'done';
  return 'empty';
}

export interface WorkflowNodeSearchQuery {
  /** 关键字：匹配标题、文件名、提示词、备注内容、锚点编号（不区分大小写；空格分隔的多个词需全部命中） */
  query?: string;
  types?: string[];
  /** 锚点编号，如 ["A02","S01"] */
  anchorCodes?: string[];
  /** 锚点筛选：any 所有锚点 / approved / pending / 某个种类 */
  anchor?: 'any' | 'approved' | 'pending' | WorkflowAnchorKind;
  status?: WorkflowNodeSearchStatus[];
  /** 镜号 */
  shotIndex?: number;
  /** 只看某个子画布里的节点 */
  parentId?: string;
  limit?: number;
  offset?: number;
}

export interface WorkflowNodeSearchHit {
  id: string;
  type: string;
  title: string;
  status: WorkflowNodeSearchStatus;
  hasMedia: boolean;
  anchorCode?: string;
  anchor?: { kind: WorkflowAnchorKind; approved: boolean };
  shotIndex?: number;
  promptPreview?: string;
  parentId?: string;
  error?: string;
}

export interface WorkflowNodeSearchResult {
  total: number;
  offset: number;
  limit: number;
  nextOffset?: number;
  nodes: WorkflowNodeSearchHit[];
}

export const NODE_SEARCH_DEFAULT_LIMIT = 20;
export const NODE_SEARCH_MAX_LIMIT = 100;
const PREVIEW_CHARS = 80;

function preview(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > PREVIEW_CHARS ? clean.slice(0, PREVIEW_CHARS - 1) + '…' : clean;
}

function promptTextOf(node: WorkflowNode): string {
  const metadata = metadataOf(node);
  const prompt = typeof metadata.prompt === 'string' ? metadata.prompt : '';
  const content = typeof metadata.content === 'string' ? metadata.content : '';
  return prompt || content;
}

export function searchWorkflowNodes(nodes: readonly WorkflowNode[], query: WorkflowNodeSearchQuery = {}): WorkflowNodeSearchResult {
  const codes = assignAnchorCodes(nodes);
  const terms = (query.query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const types = query.types?.length ? new Set(query.types) : undefined;
  const wantedCodes = query.anchorCodes?.length
    ? new Set(query.anchorCodes.map(code => normalizeAnchorCode(code)).filter((code): code is string => Boolean(code)))
    : undefined;
  const statuses = query.status?.length ? new Set(query.status) : undefined;
  const limit = Math.min(NODE_SEARCH_MAX_LIMIT, Math.max(1, Math.round(query.limit ?? NODE_SEARCH_DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.round(query.offset ?? 0));

  const matches = nodes.filter(node => {
    if (types && !types.has(node.type)) return false;
    if (query.parentId !== undefined && (node.parentId || '') !== query.parentId) return false;
    if (query.shotIndex !== undefined && node.shot?.index !== query.shotIndex) return false;
    const code = codes.get(node.id);
    if (wantedCodes && (!code || !wantedCodes.has(code))) return false;
    if (query.anchor) {
      if (!node.anchor) return false;
      if (query.anchor === 'approved' && !node.anchor.approved) return false;
      if (query.anchor === 'pending' && node.anchor.approved) return false;
      if (query.anchor !== 'any' && query.anchor !== 'approved' && query.anchor !== 'pending' && node.anchor.kind !== query.anchor) return false;
    }
    if (statuses && !statuses.has(nodeSearchStatus(node))) return false;
    if (terms.length) {
      const metadata = metadataOf(node);
      const haystack = [node.title, typeof metadata.name === 'string' ? metadata.name : '', promptTextOf(node), code || '', node.id]
        .join('\n')
        .toLowerCase();
      if (!terms.every(term => haystack.includes(term))) return false;
    }
    return true;
  });

  const page = matches.slice(offset, offset + limit).map(node => {
    const metadata = metadataOf(node);
    const hit: WorkflowNodeSearchHit = {
      id: node.id,
      type: node.type,
      title: node.title,
      status: nodeSearchStatus(node),
      hasMedia: nodeHasMedia(node),
    };
    const code = codes.get(node.id);
    if (code) hit.anchorCode = code;
    if (node.anchor) hit.anchor = { kind: node.anchor.kind, approved: node.anchor.approved === true };
    if (node.shot && Number.isFinite(node.shot.index)) hit.shotIndex = node.shot.index;
    const prompt = promptTextOf(node);
    if (prompt) hit.promptPreview = preview(prompt);
    if (node.parentId) hit.parentId = node.parentId;
    if (hit.status === 'error' && typeof metadata.error === 'string') hit.error = preview(metadata.error);
    return hit;
  });

  const result: WorkflowNodeSearchResult = { total: matches.length, offset, limit, nodes: page };
  if (offset + limit < matches.length) result.nextOffset = offset + limit;
  return result;
}

const SEARCH_STATUSES = new Set<WorkflowNodeSearchStatus>(['empty', 'running', 'done', 'error']);
const SEARCH_ANCHORS = new Set(['any', 'approved', 'pending', 'character', 'scene', 'product', 'style']);

function stringList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim());
  return list.length ? list : undefined;
}

function finite(value: unknown): number | undefined {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : undefined;
}

/** 命令参数 → 查询；忽略不认识的取值（不报错，返回更宽的结果）。 */
export function nodeSearchQueryFromArgs(args: Record<string, unknown>): WorkflowNodeSearchQuery {
  const query: WorkflowNodeSearchQuery = {};
  if (typeof args.query === 'string' && args.query.trim()) query.query = args.query.trim();
  const types = stringList(args.types);
  if (types) query.types = types;
  const codes = stringList(args.anchorCodes);
  if (codes) query.anchorCodes = codes;
  if (typeof args.anchor === 'string' && SEARCH_ANCHORS.has(args.anchor)) query.anchor = args.anchor as WorkflowNodeSearchQuery['anchor'];
  const status = stringList(args.status)?.filter((item): item is WorkflowNodeSearchStatus => SEARCH_STATUSES.has(item as WorkflowNodeSearchStatus));
  if (status?.length) query.status = status;
  const shotIndex = finite(args.shotIndex);
  if (shotIndex !== undefined) query.shotIndex = shotIndex;
  if (typeof args.parentId === 'string') query.parentId = args.parentId;
  const limit = finite(args.limit);
  if (limit !== undefined) query.limit = limit;
  const offset = finite(args.offset);
  if (offset !== undefined) query.offset = offset;
  return query;
}
