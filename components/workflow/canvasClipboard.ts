/**
 * 画布剪贴板（P1-6）：复制带"两端都在选区内"的连线，可跨项目粘贴，粘贴时重映射 id。
 *
 * - 选中分组框（subgraph）时连同其子节点一起复制；
 * - 粘贴：节点 / 连线 / parentId / 分组 batchId / Prompt Bar 里 @chip 的节点 id 全部换成新 id；
 *   指向剪贴板外节点的 @chip 不改（没有对应连线，按"连线是引用唯一事实来源"不参与生成）；
 * - 媒体沿用原 storageKey / href（durable artifact，内容寻址），不复制二进制；
 * - 运行中（loading）的状态不跟着粘贴，变成 idle。
 */
import type { WorkflowConnection, WorkflowNode } from './types';

export interface WorkflowClip {
  sourceProjectId: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  copiedAt: number;
}

/** 选区 + 被选分组的全部后代 */
export function expandClipSelection(nodes: readonly WorkflowNode[], ids: readonly string[]): string[] {
  const selected = new Set(ids.filter(id => nodes.some(node => node.id === id)));
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId && selected.has(node.parentId) && !selected.has(node.id)) {
        selected.add(node.id);
        grew = true;
      }
    }
  }
  return nodes.filter(node => selected.has(node.id)).map(node => node.id);
}

export function copyWorkflowSelection(input: {
  projectId: string;
  nodes: readonly WorkflowNode[];
  connections: readonly WorkflowConnection[];
  ids: readonly string[];
  now?: number;
}): WorkflowClip | null {
  const ids = new Set(expandClipSelection(input.nodes, input.ids));
  if (!ids.size) return null;
  const nodes = input.nodes.filter(node => ids.has(node.id)).map(node => structuredCloneSafe(node));
  const connections = input.connections
    .filter(connection => ids.has(connection.fromNodeId) && ids.has(connection.toNodeId))
    .map(connection => ({ ...connection }));
  return { sourceProjectId: input.projectId, nodes, connections, copiedAt: input.now ?? Date.now() };
}

export interface PasteResult {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  idMap: Record<string, string>;
}

const ACTIVE_STATUSES = new Set(['loading']);

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type DocNode = { type?: string; attrs?: Record<string, unknown>; content?: DocNode[] };

/** Prompt Bar 文档里 mediaMention 的 id 按映射替换（返回新对象） */
export function remapPromptDocument(document: unknown, idMap: Record<string, string>): unknown {
  if (!document || typeof document !== 'object') return document;
  const walk = (node: DocNode): DocNode => {
    const next: DocNode = { ...node };
    if (node.type === 'mediaMention' && node.attrs && typeof node.attrs.id === 'string' && idMap[node.attrs.id]) {
      next.attrs = { ...node.attrs, id: idMap[node.attrs.id] };
    }
    if (Array.isArray(node.content)) next.content = node.content.map(walk);
    return next;
  };
  return walk(document as DocNode);
}

/**
 * 纯函数：把剪贴板内容变成可加入目标项目的新节点与新连线。
 * offset 默认 (32, 32)；给 anchor 时把剪贴板包围盒左上角放到 anchor。
 */
export function pasteWorkflowClip(clip: WorkflowClip, options: {
  createId: () => string;
  offset?: { x: number; y: number };
  anchor?: { x: number; y: number };
}): PasteResult {
  const idMap: Record<string, string> = {};
  for (const node of clip.nodes) idMap[node.id] = options.createId();
  const groupMap = new Map<string, string>();
  const minX = Math.min(...clip.nodes.map(node => node.position.x));
  const minY = Math.min(...clip.nodes.map(node => node.position.y));
  const dx = options.anchor ? options.anchor.x - minX : (options.offset?.x ?? 32);
  const dy = options.anchor ? options.anchor.y - minY : (options.offset?.y ?? 32);
  const nodes = clip.nodes.map(source => {
    const node = structuredCloneSafe(source);
    node.id = idMap[source.id];
    node.position = { x: source.position.x + dx, y: source.position.y + dy };
    if (node.parentId) {
      if (idMap[node.parentId]) node.parentId = idMap[node.parentId];
      else delete node.parentId;
    }
    if (node.batchId) {
      if (!groupMap.has(node.batchId)) groupMap.set(node.batchId, options.createId());
      node.batchId = groupMap.get(node.batchId);
    }
    if (node.metadata.richTextDocument) node.metadata.richTextDocument = remapPromptDocument(node.metadata.richTextDocument, idMap) as typeof node.metadata.richTextDocument;
    if (node.metadata.status && ACTIVE_STATUSES.has(String(node.metadata.status))) node.metadata.status = 'idle';
    delete node.objectVersion;
    return node;
  });
  // 只有一个成员的分组粘出来没有意义：去掉 batchId
  const groupSizes = new Map<string, number>();
  nodes.forEach(node => { if (node.batchId) groupSizes.set(node.batchId, (groupSizes.get(node.batchId) || 0) + 1); });
  nodes.forEach(node => {
    if (node.batchId && (groupSizes.get(node.batchId) || 0) < 2) {
      delete node.batchId;
      delete node.batchIndex;
      delete node.batchGroupSource;
    }
  });
  const connections = clip.connections
    .filter(connection => idMap[connection.fromNodeId] && idMap[connection.toNodeId])
    .map(connection => {
      const next: WorkflowConnection = { ...connection, id: 'conn-' + options.createId(), fromNodeId: idMap[connection.fromNodeId], toNodeId: idMap[connection.toNodeId] };
      delete next.objectVersion;
      return next;
    });
  return { nodes, connections, idMap };
}
