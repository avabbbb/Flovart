/**
 * Agent 工具 v2 · P0-2：提示词里的 @ 引用与连线是同一个事实（纯函数）。
 *
 * 写入时：
 * - `@ref:<id>` 与 `@"节点名"`（也接受中文引号）都解析成节点 id；按名解析必须唯一，否则 AMBIGUOUS_NODE_NAME 并列出候选；
 * - 引用了还没连线、也不在 references 里的节点：默认自动补进 references（之后由调用方连线），结果里回报 autoLinked；
 *   policy='reject' 时直接拒绝 REFERENCE_NOT_LINKED。
 * 删除连线/节点时：
 * - 目标节点 Prompt Bar 里指向已断开上游的 connected chip 一并删掉，回报给 Agent。
 *
 * 不碰 Prompt Bar 的视觉，只处理文本与文档数据。
 */
import { getWorkflowInputNodeIds } from './references';
import { promptDocumentToText } from './promptDocument';
import type { WorkflowConnection, WorkflowNode, WorkflowRichPromptDocument } from './types';

export type ReferenceLinkPolicy = 'auto' | 'reject';

export interface PromptReferenceInput {
  text: string;
  targetNodeId: string;
  nodes: readonly WorkflowNode[];
  connections: readonly WorkflowConnection[];
  /** 调用方显式给的参考 id（顺序即槽位顺序）。 */
  referenceIds: readonly string[];
  policy?: ReferenceLinkPolicy;
}

export interface PromptReferenceAlignment {
  ok: true;
  /** `@"名字"` 已替换为 `@ref:<id>` 的文本。 */
  text: string;
  /** 显式参考在前，自动补的按在 prompt 中出现的顺序追加。 */
  referenceIds: string[];
  autoLinked: string[];
  /** 文中按名解析到的引用。 */
  resolvedNames: Array<{ name: string; nodeId: string }>;
}

export interface PromptReferenceError {
  ok: false;
  code: 'AMBIGUOUS_NODE_NAME' | 'NODE_NAME_NOT_FOUND' | 'REFERENCE_NOT_LINKED';
  message: string;
  details: Record<string, unknown>;
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio']);
const MENTION_PATTERN = /@ref:([A-Za-z0-9_.:-]+)|@"([^"\n]+)"|@“([^”\n]+)”/gu;

const nodeName = (node: WorkflowNode) => (typeof node.title === 'string' ? node.title.trim() : '');

/** 解析 prompt 里的引用，并让 references 与之对齐。 */
export function alignPromptReferences(input: PromptReferenceInput): PromptReferenceAlignment | PromptReferenceError {
  const policy = input.policy || 'auto';
  const upstream = new Set(getWorkflowInputNodeIds(input.targetNodeId, input.connections as WorkflowConnection[]));
  const referenceIds = [...input.referenceIds];
  const autoLinked: string[] = [];
  const resolvedNames: Array<{ name: string; nodeId: string }> = [];
  const byId = new Map(input.nodes.map(node => [node.id, node]));
  const unlinked: string[] = [];

  const consider = (nodeId: string) => {
    const node = byId.get(nodeId);
    if (!node || node.id === input.targetNodeId) return;
    // 文本备注与非媒体节点交给调用方的参考校验（NOTE_IS_ANNOTATION 等），这里不自动连。
    if (!MEDIA_TYPES.has(node.type)) return;
    if (referenceIds.includes(nodeId) || upstream.has(nodeId)) return;
    if (policy === 'reject') { if (!unlinked.includes(nodeId)) unlinked.push(nodeId); return; }
    referenceIds.push(nodeId);
    autoLinked.push(nodeId);
  };

  let failure: PromptReferenceError | null = null;
  const text = input.text.replace(MENTION_PATTERN, (full, refId: string | undefined, ascii: string | undefined, cjk: string | undefined) => {
    if (failure) return full;
    if (refId !== undefined) { consider(refId); return full; }
    const name = (ascii ?? cjk ?? '').trim();
    const matches = input.nodes.filter(node => node.id !== input.targetNodeId && nodeName(node) === name);
    if (matches.length === 0) {
      failure = { ok: false, code: 'NODE_NAME_NOT_FOUND', message: `没有名为「${name}」的节点；用 @ref:<节点id> 或先 flovart_inspect 查节点名。`, details: { name } };
      return full;
    }
    if (matches.length > 1) {
      failure = {
        ok: false,
        code: 'AMBIGUOUS_NODE_NAME',
        message: `有 ${matches.length} 个节点叫「${name}」，请改用 @ref:<节点id>。`,
        details: { name, candidates: matches.map(node => ({ nodeId: node.id, type: node.type, title: nodeName(node) })) },
      };
      return full;
    }
    resolvedNames.push({ name, nodeId: matches[0].id });
    consider(matches[0].id);
    return '@ref:' + matches[0].id;
  });
  if (failure) return failure;
  if (unlinked.length) {
    return {
      ok: false,
      code: 'REFERENCE_NOT_LINKED',
      message: `prompt 引用了没连线的节点：${unlinked.join('、')}。把它们加进 references，或去掉 linkPolicy=reject 让它自动连线。`,
      details: { nodeIds: unlinked },
    };
  }
  return { ok: true, text, referenceIds, autoLinked, resolvedNames };
}

type DocNode = { type: string; text?: string; attrs?: Record<string, unknown>; content?: DocNode[] };

/** 从 Prompt Bar 文档里删掉指向 removeIds 的 connected chip；返回新文档与被删的 id。 */
export function removePromptMentions(document: unknown, removeIds: ReadonlySet<string>): { document: WorkflowRichPromptDocument; prompt: string; removedIds: string[] } | null {
  if (!document || typeof document !== 'object') return null;
  const removed: string[] = [];
  const walk = (node: DocNode): DocNode | null => {
    if (node.type === 'mediaMention') {
      const id = typeof node.attrs?.id === 'string' ? node.attrs.id : '';
      const source = node.attrs?.sourceType;
      if (id && removeIds.has(id) && (source === 'connected' || source === undefined || source === null)) {
        if (!removed.includes(id)) removed.push(id);
        return null;
      }
      return node;
    }
    if (!Array.isArray(node.content)) return node;
    const content = node.content.map(walk).filter((child): child is DocNode => child !== null);
    // 删 chip 后合并相邻文本、收掉双空格
    const merged: DocNode[] = [];
    for (const child of content) {
      const last = merged[merged.length - 1];
      if (child.type === 'text' && last?.type === 'text') merged[merged.length - 1] = { ...last, text: (last.text || '') + (child.text || '') };
      else merged.push(child);
    }
    const tidy = merged.map(child => (child.type === 'text' ? { ...child, text: (child.text || '').replace(/ {2,}/g, ' ') } : child)).filter(child => child.type !== 'text' || child.text);
    return { ...node, content: tidy };
  };
  const next = walk(document as DocNode);
  if (!removed.length || !next) return null;
  return { document: next as WorkflowRichPromptDocument, prompt: promptDocumentToText(next), removedIds: removed };
}

export interface MentionPrune {
  nodeId: string;
  removedIds: string[];
  richTextDocument: WorkflowRichPromptDocument;
  prompt: string;
}

/**
 * 对比连线变化前后，找出「上游被断开/删掉、但 Prompt Bar 里还留着 chip」的节点，给出清理后的文档。
 * after 用写入后的快照（含同批 update_node 的新文档）。重连（reorder）前后都相连的不受影响。
 */
export function planMentionPrunes(
  before: { connections: readonly WorkflowConnection[] },
  after: { nodes: readonly WorkflowNode[]; connections: readonly WorkflowConnection[] },
): MentionPrune[] {
  const prunes: MentionPrune[] = [];
  for (const node of after.nodes) {
    const document = node.metadata?.richTextDocument;
    if (!document) continue;
    const was = new Set(getWorkflowInputNodeIds(node.id, before.connections as WorkflowConnection[]));
    if (!was.size) continue;
    const now = new Set(getWorkflowInputNodeIds(node.id, after.connections as WorkflowConnection[]));
    const lost = new Set([...was].filter(id => !now.has(id)));
    if (!lost.size) continue;
    const pruned = removePromptMentions(document, lost);
    if (pruned) prunes.push({ nodeId: node.id, removedIds: pruned.removedIds, richTextDocument: pruned.document, prompt: pruned.prompt });
  }
  return prunes;
}
