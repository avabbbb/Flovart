import type { WorkflowNode, WorkflowProject } from '../components/workflow/types';

export interface WorkflowRunOutputNodes {
  /** 多张生成时的批次 id；单张为空 */
  batchId?: string;
  /** 批次封面（原位替换时就是被运行的节点本身） */
  headNodeId: string;
  /** 本次运行产出的全部结果节点，封面在前，其余按 batchIndex */
  nodeIds: string[];
}

const hasMedia = (node: WorkflowNode | undefined) => Boolean(node?.metadata.storageKey);

/**
 * 从运行前后的项目里找出本次运行的全部产物节点（只读，不改生成逻辑）。
 * - 原位替换：节点自身是第 0 张，同批其余结果与它共享 batchId；
 * - 用户运行期间换了媒体：结果另存为新节点并从源节点连线，此时源节点不算产物。
 */
export function collectWorkflowRunOutputNodes(before: Pick<WorkflowProject, 'nodes'>, after: Pick<WorkflowProject, 'nodes' | 'connections'>, nodeId: string): WorkflowRunOutputNodes | undefined {
  const target = after.nodes.find(node => node.id === nodeId);
  if (!target) return undefined;
  const existed = new Set(before.nodes.map(node => node.id));
  const created = after.nodes.filter(node => !existed.has(node.id));
  const batchId = target.batchId && created.some(node => node.batchId === target.batchId)
    ? target.batchId
    : created.find(node => node.batchId)?.batchId;
  const members = batchId
    ? after.nodes.filter(node => node.batchId === batchId && (node.id === nodeId || !existed.has(node.id)))
    : [];
  const detached = created.filter(node => after.connections.some(connection => connection.fromNodeId === nodeId && connection.toNodeId === node.id));
  // 目标节点的媒体没变（用户运行期间换了图、结果另存）时，它不是本次产物。
  const previousKey = before.nodes.find(node => node.id === nodeId)?.metadata.storageKey;
  const targetProduced = hasMedia(target) && target.metadata.storageKey !== previousKey;
  const ordered = (members.length ? members : [...(targetProduced ? [target] : []), ...detached])
    .filter(hasMedia)
    .sort((left, right) => (left.batchIndex ?? (left.id === nodeId ? -1 : 0)) - (right.batchIndex ?? (right.id === nodeId ? -1 : 0)));
  if (!ordered.length) return undefined;
  return { ...(batchId ? { batchId } : {}), headNodeId: ordered[0].id, nodeIds: ordered.map(node => node.id) };
}
