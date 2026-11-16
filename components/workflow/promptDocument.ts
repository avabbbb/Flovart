import { getOrderedImageReferences, toWorkflowMentionItems } from './references';
import type { WorkflowConnection, WorkflowNode, WorkflowRichPromptDocument } from './types';

/**
 * Prompt Bar 富文本文档的纯函数构造器（与 MediaMentionExtension 的 mediaMention 节点同形）。
 *
 * 给 Agent / CLI / MCP 用：它们只有纯文本 prompt 与“引用哪些上游节点”，这里把二者编成
 * 用户在 Prompt Bar 里会看到的 chip 文档，保证 Agent 写入的 @引用与手动插入的完全一致。
 * 不依赖 Tiptap / DOM，节点端与浏览器端都能引用。
 */

export interface PromptMentionAttrs {
  id: string;
  label: string;
  thumbnail: string;
  elementType: string;
  description: string;
  sourceType: 'connected' | 'assetLibrary' | null;
  assetId: string | null;
}

type DocNode = { type: string; text?: string; attrs?: Record<string, unknown>; content?: DocNode[] };

export interface WorkflowPromptDocumentResult {
  /** 纯文本：mention 渲染为 @标签，与 editorJSONToText 一致 */
  prompt: string;
  richTextDocument: WorkflowRichPromptDocument;
  /** 文档里 mention 的节点 id（按出现顺序、去重） */
  mentionIds: string[];
  /** 文本里出现、但不是目标节点上游的 @ref:<id> */
  unresolved: string[];
}

export interface BuildWorkflowPromptDocumentInput {
  text: string;
  targetNodeId: string;
  /** 已包含本次将要建立的连线 */
  nodes: readonly WorkflowNode[];
  connections: readonly WorkflowConnection[];
  /** 必须出现在文档里的上游节点；正文里没写到的追加在末尾（保证它们参与生成） */
  ensureMentionIds?: readonly string[];
}

const fetchableThumbnail = (href: unknown) => (typeof href === 'string' && /^https?:\/\//i.test(href) ? href : '');
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 上游媒体节点 → chip 标签（图片1 / 视频1 / 音频1，顺序 = 连线顺序，与 Prompt Bar 一致） */
export function workflowPromptMentionAttrs(
  targetNodeId: string,
  nodes: readonly WorkflowNode[],
  connections: readonly WorkflowConnection[],
): Array<PromptMentionAttrs & { aliases: string[] }> {
  const target = nodes.find(node => node.id === targetNodeId) || ({ id: targetNodeId } as WorkflowNode);
  const ordered = getOrderedImageReferences(target, nodes as WorkflowNode[], connections as WorkflowConnection[]);
  const items = toWorkflowMentionItems(ordered);
  return items.map((item, index) => ({
    id: item.id,
    label: item.label,
    aliases: (item.aliases || []).filter(alias => alias && alias !== item.label),
    thumbnail: fetchableThumbnail(ordered[index]?.metadata.href),
    elementType: item.elementType,
    description: '',
    sourceType: 'connected',
    assetId: null,
  }));
}

function mentionNode(attrs: PromptMentionAttrs): DocNode {
  return { type: 'mediaMention', attrs: { ...attrs } };
}

function paragraphsFromSegments(segments: Array<string | PromptMentionAttrs>): DocNode[] {
  const paragraphs: DocNode[][] = [[]];
  for (const segment of segments) {
    if (typeof segment !== 'string') {
      paragraphs[paragraphs.length - 1].push(mentionNode(segment));
      continue;
    }
    const lines = segment.split('\n');
    lines.forEach((line, index) => {
      if (index > 0) paragraphs.push([]);
      if (line) paragraphs[paragraphs.length - 1].push({ type: 'text', text: line });
    });
  }
  return paragraphs.map(content => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' }));
}

/** 与 editorJSONToText 相同的纯文本渲染（mention → @标签，段落换行） */
export function promptDocumentToText(document: unknown): string {
  const parts: string[] = [];
  const walk = (node: DocNode) => {
    if (node.type === 'text') parts.push(node.text || '');
    else if (node.type === 'mediaMention') parts.push('@' + String(node.attrs?.label || ''));
    else if (node.type === 'hardBreak') parts.push('\n');
    else if (Array.isArray(node.content)) {
      node.content.forEach(walk);
      if (node.type === 'paragraph') parts.push('\n');
    } else if (node.type === 'paragraph') parts.push('\n');
  };
  if (document && typeof document === 'object') walk(document as DocNode);
  return parts.join('').replace(/\n$/, '').trim();
}

/** 文档里的 mediaMention 属性（按出现顺序） */
export function promptDocumentMentions(document: unknown): PromptMentionAttrs[] {
  const found: PromptMentionAttrs[] = [];
  const walk = (node: DocNode) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'mediaMention' && node.attrs && typeof node.attrs.id === 'string') found.push(node.attrs as unknown as PromptMentionAttrs);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  if (document && typeof document === 'object') walk(document as DocNode);
  return found;
}

/**
 * 把纯文本 prompt 编成 Prompt Bar 文档。识别三种引用写法：
 * - `@ref:<nodeId>`：按节点 id 精确引用（Agent 推荐写法）
 * - `@图片1` / `@视频1` / `@音频1`：Prompt Bar chip 标签
 * - `@<节点标题>`：上游节点标题（唯一匹配时）
 * 只有目标节点的上游媒体能成为 chip；其余 @ref 记入 unresolved，原样保留为文字。
 */
export function buildWorkflowPromptDocument(input: BuildWorkflowPromptDocumentInput): WorkflowPromptDocumentResult {
  const items = workflowPromptMentionAttrs(input.targetNodeId, input.nodes, input.connections);
  const byId = new Map(items.map(item => [item.id, item]));
  const candidates: Array<{ token: string; item: (typeof items)[number]; strict: boolean }> = [];
  for (const item of items) {
    candidates.push({ token: item.label, item, strict: false });
    for (const alias of item.aliases) {
      // 标题只在唯一时可用，避免两个同名节点被随便挑一个
      if (items.filter(other => other.label === alias || other.aliases.includes(alias)).length === 1) candidates.push({ token: alias, item, strict: true });
    }
  }
  candidates.sort((left, right) => right.token.length - left.token.length);
  const alternatives = candidates.map(candidate => escapeRegExp(candidate.token));
  const pattern = new RegExp('@ref:([A-Za-z0-9_.:-]+)' + (alternatives.length ? '|@(' + alternatives.join('|') + ')' : ''), 'gu');
  const segments: Array<string | PromptMentionAttrs> = [];
  const unresolved: string[] = [];
  const mentionIds: string[] = [];
  const pushMention = (item: (typeof items)[number]) => {
    const { aliases: _aliases, ...attrs } = item;
    segments.push(attrs);
    if (!mentionIds.includes(item.id)) mentionIds.push(item.id);
  };
  let cursor = 0;
  for (const match of input.text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const full = match[0];
    let item: (typeof items)[number] | undefined;
    if (match[1] !== undefined) {
      item = byId.get(match[1]);
      if (!item && !unresolved.includes(match[1])) unresolved.push(match[1]);
    } else {
      const token = match[2];
      const candidate = candidates.find(entry => entry.token === token);
      const next = input.text.slice(start + full.length, start + full.length + 1);
      // 「@图片1」后面紧跟数字时是「@图片10」的一部分；标题引用要求后面不是字母数字。
      const boundaryOk = candidate
        ? (candidate.strict ? !/[\p{L}\p{N}_]/u.test(next) : !/\p{N}/u.test(next))
        : false;
      if (candidate && boundaryOk) item = candidate.item;
    }
    if (!item) continue;
    if (start > cursor) segments.push(input.text.slice(cursor, start));
    pushMention(item);
    cursor = start + full.length;
  }
  if (cursor < input.text.length) segments.push(input.text.slice(cursor));
  const missing = (input.ensureMentionIds || []).filter(id => byId.has(id) && !mentionIds.includes(id));
  if (missing.length) {
    const tail = segments.length ? segments[segments.length - 1] : '';
    if (typeof tail === 'string' && tail && !/\s$/.test(tail)) segments.push(' ');
    missing.forEach((id, index) => {
      if (index > 0) segments.push(' ');
      pushMention(byId.get(id)!);
    });
  }
  const richTextDocument = { type: 'doc', content: paragraphsFromSegments(segments) } as WorkflowRichPromptDocument;
  return { prompt: promptDocumentToText(richTextDocument), richTextDocument, mentionIds, unresolved };
}

/**
 * 只改 prompt 文本时保留原有 @引用（LibTV update_*_node 的约定）：
 * 新文本里的 @标签 / @ref 重新编成 chip；原文档里已有、但新文本没写到的引用追加在末尾，
 * 不会因为 Agent 只给纯文本就把用户插好的 chip 全部抹掉。
 * 原文档没有任何 mention 时返回 null，调用方按纯文本处理。
 */
export function preservePromptMentions(input: {
  text: string;
  previousDocument: unknown;
  targetNodeId: string;
  nodes: readonly WorkflowNode[];
  connections: readonly WorkflowConnection[];
}): WorkflowPromptDocumentResult | null {
  const previous = promptDocumentMentions(input.previousDocument);
  if (!previous.length) return null;
  const upstream = new Set(workflowPromptMentionAttrs(input.targetNodeId, input.nodes, input.connections).map(item => item.id));
  const keep = [...new Set(previous.map(item => item.id))].filter(id => upstream.has(id));
  const built = buildWorkflowPromptDocument({ ...input, ensureMentionIds: keep });
  // 素材库引用（不是上游节点）原样保留在末尾
  const assets = previous.filter(item => !upstream.has(item.id) && (item.assetId || item.sourceType === 'assetLibrary'))
    .filter((item, index, list) => list.findIndex(other => other.id === item.id) === index);
  if (!assets.length) return built;
  const doc = built.richTextDocument as unknown as DocNode;
  const paragraphs = doc.content || [];
  const last = paragraphs[paragraphs.length - 1] || { type: 'paragraph' };
  const content = [...(last.content || [])];
  for (const attrs of assets) {
    if (content.length) content.push({ type: 'text', text: ' ' });
    content.push(mentionNode(attrs));
  }
  const richTextDocument = { type: 'doc', content: [...paragraphs.slice(0, -1), { type: 'paragraph', content }] } as WorkflowRichPromptDocument;
  return {
    prompt: promptDocumentToText(richTextDocument),
    richTextDocument,
    mentionIds: [...built.mentionIds, ...assets.map(item => item.id)],
    unresolved: built.unresolved,
  };
}
