import type { MentionItem } from '../MentionList';
import type { SeedanceReferences, WorkflowConnection, WorkflowNode } from './types';

/** 上游媒体节点类型 */
const MEDIA_TYPES = new Set(['image', 'video', 'audio']);

export interface ImageReferenceChip {
  id: string;
  label: string;
  thumbnail: string;
  elementType: 'image' | 'video' | 'audio';
  mentioned: boolean;
}

/**
 * 计算参考图 chip 面板的稳定顺序：
 * 1. 上游 image/video/audio 连线节点 = 全部 chip 来源
 * 2. 已在 imageReferenceOrder 中的按其顺序排前
 * 3. 新出现的连线按 connection 顺序追加在尾部
 * 4. 不再连线的 id 自动从结果里剔除
 */
export function getOrderedImageReferences(
  targetNode: WorkflowNode,
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
): WorkflowNode[] {
  const upstream = getWorkflowInputNodes(targetNode, nodes, connections).filter(node => MEDIA_TYPES.has(node.type));
  const order = targetNode.metadata.imageReferenceOrder || [];
  const byId = new Map(upstream.map(node => [node.id, node]));
  const seen = new Set<string>();
  const ordered: WorkflowNode[] = [];
  for (const id of order) {
    const node = byId.get(id);
    if (node && !seen.has(id)) { ordered.push(node); seen.add(id); }
  }
  for (const node of upstream) {
    if (!seen.has(node.id)) { ordered.push(node); seen.add(node.id); }
  }
  return ordered;
}

export function toImageReferenceChips(
  orderedNodes: WorkflowNode[],
  mentionedNodeIds: string[] = [],
): ImageReferenceChip[] {
  const mentioned = new Set(mentionedNodeIds);
  return orderedNodes.map(node => ({
    id: node.id,
    label: node.title,
    thumbnail: node.metadata.href || '',
    elementType: (MEDIA_TYPES.has(node.type) ? node.type : 'image') as 'image' | 'video' | 'audio',
    mentioned: mentioned.has(node.id),
  }));
}

/** 拼接当前 chip 列与新增/移除节点，得到新的 imageReferenceOrder 值 */
export function reconcileImageReferenceOrder(
  current: string[] | undefined,
  orderedNodes: WorkflowNode[],
): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  const validIds = new Set(orderedNodes.map(node => node.id));
  for (const id of current || []) {
    if (validIds.has(id) && !seen.has(id)) { next.push(id); seen.add(id); }
  }
  for (const node of orderedNodes) {
    if (!seen.has(node.id)) { next.push(node.id); seen.add(node.id); }
  }
  return next;
}

/** 应用一个新顺序，自动剔除已不连线的 id；返回 undefined 表示无变化 */
export function applyImageReferenceOrder(
  current: string[] | undefined,
  nextOrder: string[],
  orderedNodes: WorkflowNode[],
): string[] | undefined {
  const validIds = new Set(orderedNodes.map(node => node.id));
  const filtered = nextOrder.filter(id => validIds.has(id));
  const candidate = reconcileImageReferenceOrder(filtered, orderedNodes);
  const prev = reconcileImageReferenceOrder(current, orderedNodes);
  return candidate.length !== prev.length || candidate.some((id, i) => id !== prev[i]) ? candidate : undefined;
}

/** 提交时根据 imageReferenceOrder 对节点列表排序，丢失的 id 自动剔除 */
export function sortReferencesByOrder<T>(items: T[], idOf: (item: T) => string, order: string[] | undefined): T[] {
  if (!order || order.length === 0) return items;
  const index = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (index.get(idOf(a)) ?? Number.MAX_SAFE_INTEGER) - (index.get(idOf(b)) ?? Number.MAX_SAFE_INTEGER));
}

export const EMPTY_SEEDANCE_REFERENCES: SeedanceReferences = {
  imageRefs: [],
  videoRefs: [],
  audioRefs: [],
};

export function getWorkflowInputNodeIds(targetNodeId: string, connections: WorkflowConnection[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const connection of connections) {
    if (connection.toNodeId !== targetNodeId || seen.has(connection.fromNodeId)) continue;
    seen.add(connection.fromNodeId);
    ids.push(connection.fromNodeId);
  }
  return ids;
}

export function getWorkflowInputNodes(
  targetNode: WorkflowNode,
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
): WorkflowNode[] {
  const allowedIds = new Set(getWorkflowInputNodeIds(targetNode.id, connections));
  return nodes.filter(node => allowedIds.has(node.id) && node.id !== targetNode.id && node.isVisible !== false);
}

export function filterWorkflowInputIds(ids: string[], targetNodeId: string, connections: WorkflowConnection[]): string[] {
  const allowedIds = new Set(getWorkflowInputNodeIds(targetNodeId, connections));
  const seen = new Set<string>();
  return ids.filter(id => {
    if (!allowedIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function toWorkflowMentionItems(nodes: WorkflowNode[]): MentionItem[] {
  return nodes.map(item => ({
    id: item.id,
    label: item.title,
    thumbnail: item.metadata.href || '',
    elementType: item.type,
    description: item.metadata.content?.trim().slice(0, 36) || item.type,
  }));
}

export function filterSeedanceReferences(
  refs: SeedanceReferences | undefined,
  targetNodeId: string,
  connections: WorkflowConnection[],
): SeedanceReferences {
  const value = refs || EMPTY_SEEDANCE_REFERENCES;
  return {
    imageRefs: filterWorkflowInputIds(value.imageRefs, targetNodeId, connections),
    videoRefs: filterWorkflowInputIds(value.videoRefs, targetNodeId, connections),
    audioRefs: filterWorkflowInputIds(value.audioRefs, targetNodeId, connections),
  };
}
