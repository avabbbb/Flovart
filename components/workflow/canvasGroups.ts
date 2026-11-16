/**
 * 分组（P1-1）：把"分组"从 batchId 里拆出来。
 *
 * - 分组 = 一个 `subgraph` 框节点（metadata.groupKind = 'group'，不带 reverseProjectId）+ 成员的 parentId；
 *   拖动框带动成员、折叠隐藏成员、删除框连带成员，这些复用子画布已有逻辑。
 * - batchId 从此只表示"批量命令 / 分镜生成建的一组节点"（batchGroupSource 'auto'）；多结果是首图节点上的备选
 *   （batchAlternates.ts），三者互不相干。
 * - 旧数据：batchGroupSource 'manual' 的手动分组迁移成分组框；'auto' 与生成批次不动。
 */
import { createWorkflowNode } from './constants';
import type { WorkflowConnection, WorkflowDocumentOperation, WorkflowNode } from './types';

export const GROUP_PADDING = 40;
export const GROUP_HEADER = 48;

export function isGroupFrame(node: WorkflowNode | undefined): boolean {
  return Boolean(node && node.type === 'subgraph' && node.metadata.groupKind === 'group');
}

export interface GroupBounds { x: number; y: number; width: number; height: number }

export function groupFrameBounds(members: readonly WorkflowNode[]): GroupBounds {
  const left = Math.min(...members.map(node => node.position.x));
  const top = Math.min(...members.map(node => node.position.y));
  const right = Math.max(...members.map(node => node.position.x + (node.width || 320)));
  const bottom = Math.max(...members.map(node => node.position.y + (node.height || 200)));
  return {
    x: left - GROUP_PADDING,
    y: top - GROUP_PADDING - GROUP_HEADER,
    width: right - left + GROUP_PADDING * 2,
    height: bottom - top + GROUP_PADDING * 2 + GROUP_HEADER,
  };
}

/**
 * 分组框跟随成员自动伸缩：成员被移动、改尺寸、加入 / 移出、删除后，把受影响的分组框贴合到成员包围盒
 * （与 createGroupFrame 同一套边距和标题栏高度）。纯函数，没有变化时原样返回同一个数组。
 *
 * - touchedIds：本次被改动的节点；它们的祖先分组框都会重算（嵌套分组由内向外）。
 *   只改了分组框自己（例如用户手动拉大框）不会被拉回，等成员下次变动时再贴合。
 * - extraFrameIds：需要额外重算的框（成员移出 / 被删前所在的旧分组）。
 * - 折叠的分组不动（成员隐藏，框显示折叠条）；没有可见成员的框也不动。
 */
export function fitGroupFrames(nodes: readonly WorkflowNode[], touchedIds: Iterable<string>, extraFrameIds: Iterable<string> = []): WorkflowNode[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const affected = new Set<string>();
  const addAncestors = (startId: string | undefined) => {
    let current = startId ? byId.get(startId) : undefined;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (isGroupFrame(current)) affected.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  };
  for (const id of touchedIds) addAncestors(byId.get(id)?.parentId);
  for (const id of extraFrameIds) addAncestors(id);
  if (!affected.size) return nodes as WorkflowNode[];
  const depth = (id: string) => {
    let level = 0;
    let current = byId.get(id);
    while (current?.parentId && level < 64) { level += 1; current = byId.get(current.parentId); }
    return level;
  };
  const order = [...affected].sort((left, right) => depth(right) - depth(left));
  const next = new Map(byId);
  let changed = false;
  for (const frameId of order) {
    const frame = next.get(frameId);
    if (!frame || frame.metadata.collapsed === true) continue;
    const members = [...next.values()].filter(node => node.parentId === frameId && node.isVisible !== false);
    if (!members.length) continue;
    const bounds = groupFrameBounds(members);
    if (frame.position.x === bounds.x && frame.position.y === bounds.y && frame.width === bounds.width && frame.height === bounds.height) continue;
    next.set(frameId, { ...frame, position: { x: bounds.x, y: bounds.y }, width: bounds.width, height: bounds.height });
    changed = true;
  }
  return changed ? nodes.map(node => next.get(node.id) || node) : nodes as WorkflowNode[];
}

/** 对比前后两份节点，得出 fitGroupFrames 需要的改动节点与旧父分组。 */
export function groupFitSeeds(before: readonly WorkflowNode[], after: readonly WorkflowNode[]) {
  const previous = new Map(before.map(node => [node.id, node]));
  const remaining = new Set(after.map(node => node.id));
  const touched: string[] = [];
  const oldParents: string[] = [];
  for (const node of after) {
    const old = previous.get(node.id);
    if (old === node) continue;
    touched.push(node.id);
    if (old?.parentId && old.parentId !== node.parentId) oldParents.push(old.parentId);
  }
  for (const node of before) if (!remaining.has(node.id) && node.parentId) oldParents.push(node.parentId);
  return { touched, oldParents };
}

export function createGroupFrame(id: string, members: readonly WorkflowNode[], title?: string): WorkflowNode {
  const bounds = groupFrameBounds(members);
  const frame = createWorkflowNode(id, 'subgraph', { x: bounds.x, y: bounds.y }, { groupKind: 'group', collapsed: false, childKeys: [] });
  frame.width = bounds.width;
  frame.height = bounds.height;
  frame.title = title?.trim() || '分组';
  return frame;
}

export class WorkflowGroupError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'WorkflowGroupError';
  }
}

/** 纯函数：把若干节点放进一个新分组框（一个 ChangeSet，可撤销）。成员原来的手动 batch 分组一并清掉。 */
export function buildGroupCreateOps(nodes: readonly WorkflowNode[], ids: readonly string[], options: { groupId: string; title?: string }): { ops: WorkflowDocumentOperation[]; groupId: string; memberIds: string[] } {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const unique = [...new Set(ids)];
  const missing = unique.filter(id => !byId.has(id));
  if (missing.length) throw new WorkflowGroupError('NOT_FOUND', '节点不存在：' + missing.join('、'));
  // 选中的节点里如果有它的祖先，就只把祖先放进来（子节点跟着祖先走）。
  const selected = new Set(unique);
  const hasSelectedAncestor = (node: WorkflowNode) => {
    let parent = node.parentId ? byId.get(node.parentId) : undefined;
    while (parent) {
      if (selected.has(parent.id)) return true;
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return false;
  };
  const members = unique.map(id => byId.get(id)!).filter(node => !hasSelectedAncestor(node));
  if (members.length < 2) throw new WorkflowGroupError('BAD_REQUEST', '至少选择 2 个节点才能打组');
  const frame = createGroupFrame(options.groupId, members, options.title);
  const ops: WorkflowDocumentOperation[] = [{ type: 'add_node', node: frame }];
  for (const member of members) {
    const clearManual = member.batchGroupSource === 'manual' ? { batchId: undefined, batchIndex: undefined, batchGroupSource: undefined } : {};
    ops.push({ type: 'update_node', id: member.id, patch: { parentId: frame.id, ...clearManual } });
  }
  return { ops, groupId: frame.id, memberIds: members.map(node => node.id) };
}

/** 纯函数：解散分组——成员回到框的上一级，删掉框本身（成员不删）。 */
export function buildUngroupOps(nodes: readonly WorkflowNode[], groupId: string): WorkflowDocumentOperation[] {
  const frame = nodes.find(node => node.id === groupId);
  if (!frame || !isGroupFrame(frame)) throw new WorkflowGroupError('NOT_FOUND', '分组不存在：' + groupId);
  const ops: WorkflowDocumentOperation[] = nodes
    .filter(node => node.parentId === groupId)
    .map(node => ({ type: 'update_node' as const, id: node.id, patch: { parentId: frame.parentId } }));
  ops.push({ type: 'delete_nodes', ids: [groupId] });
  return ops;
}

/** 分组的全部后代（含嵌套分组里的节点） */
export function groupMemberIds(nodes: readonly WorkflowNode[], groupId: string): string[] {
  const result: string[] = [];
  const queue = [groupId];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const node of nodes) {
      if (node.parentId === parent) {
        result.push(node.id);
        queue.push(node.id);
      }
    }
  }
  return result;
}

/** 能生成的成员：图片 / 视频节点，有提示词或已转成 Operation；只放了素材、没有提示词的不算。 */
export function isRunnableGroupMember(node: WorkflowNode): boolean {
  if (node.isLocked) return false;
  if (node.type !== 'image' && node.type !== 'video') return false;
  return Boolean(String(node.metadata.prompt || '').trim() || node.metadata.operation);
}

/** 整组执行顺序：可运行成员按组内依赖拓扑排序（上游先跑） */
export function groupRunOrder(nodes: readonly WorkflowNode[], connections: readonly WorkflowConnection[], groupId: string): string[] {
  const memberIds = new Set(groupMemberIds(nodes, groupId));
  const runnable = nodes.filter(node => memberIds.has(node.id) && isRunnableGroupMember(node)).map(node => node.id);
  return topoOrder(connections, runnable);
}

/** 稳定拓扑排序（Kahn，同层保持原顺序；有环时退回原顺序）。不引 ops.ts：本文件被 migrations 引用，避免与 store 循环依赖。 */
function topoOrder(connections: readonly WorkflowConnection[], ids: string[]): string[] {
  const set = new Set(ids);
  const inDegree = new Map(ids.map(id => [id, 0]));
  const outgoing = new Map(ids.map(id => [id, [] as string[]]));
  for (const connection of connections) {
    if (!set.has(connection.fromNodeId) || !set.has(connection.toNodeId)) continue;
    outgoing.get(connection.fromNodeId)!.push(connection.toNodeId);
    inDegree.set(connection.toNodeId, (inDegree.get(connection.toNodeId) || 0) + 1);
  }
  const queue = ids.filter(id => inDegree.get(id) === 0);
  const result: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    result.push(id);
    for (const next of outgoing.get(id)!) {
      const degree = inDegree.get(next)! - 1;
      inDegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  return result.length === ids.length ? result : ids;
}

/** 节点 → 所属最近的分组框 id */
export function enclosingGroupId(nodes: readonly WorkflowNode[], nodeId: string): string | undefined {
  const byId = new Map(nodes.map(node => [node.id, node]));
  let current = byId.get(nodeId);
  if (isGroupFrame(current)) return current!.id;
  while (current?.parentId) {
    const parent = byId.get(current.parentId);
    if (isGroupFrame(parent)) return parent!.id;
    current = parent;
  }
  return undefined;
}

/**
 * 旧数据迁移：手动分组（batchGroupSource 'manual'，没有 batchIndex）→ 分组框 + parentId。
 * 'auto'（分镜 / 批量命令）与仍带 batchIndex 的生成批次不动；已在别的框里的成员不重复迁移。
 * 框 id 由 batchId 派生，迁移幂等。
 */
export function migrateManualBatchGroups(nodes: WorkflowNode[]): { nodes: WorkflowNode[]; changed: boolean } {
  const groups = new Map<string, WorkflowNode[]>();
  for (const node of nodes) {
    if (!node.batchId || node.batchGroupSource !== 'manual' || node.batchIndex !== undefined || node.parentId) continue;
    const list = groups.get(node.batchId) || [];
    list.push(node);
    groups.set(node.batchId, list);
  }
  if (!groups.size) return { nodes, changed: false };
  const existing = new Set(nodes.map(node => node.id));
  const frames: WorkflowNode[] = [];
  const parentOf = new Map<string, string>();
  for (const [batchId, members] of groups) {
    let frameId = 'group-' + batchId;
    while (existing.has(frameId)) frameId += '-1';
    existing.add(frameId);
    if (members.length < 2) {
      members.forEach(member => parentOf.set(member.id, ''));
      continue;
    }
    frames.push(createGroupFrame(frameId, members));
    members.forEach(member => parentOf.set(member.id, frameId));
  }
  const migrated = nodes.map(node => {
    if (!parentOf.has(node.id)) return node;
    const frameId = parentOf.get(node.id);
    const next: WorkflowNode = { ...node, batchId: undefined, batchIndex: undefined, batchGroupSource: undefined };
    if (frameId) next.parentId = frameId;
    return next;
  });
  return { nodes: [...frames, ...migrated], changed: true };
}
