import type { WorkflowConnection, WorkflowNode } from '../components/workflow/types';

type AnchorNode = Pick<WorkflowNode, 'id' | 'anchor' | 'shot'>;

export interface AnchorLockIssue {
  shotNodeId: string;
  anchorNodeId: string;
  code: 'anchor-missing' | 'anchor-not-approved';
  message: string;
}

export interface AnchorLockPlan {
  /** 需要新增的可见数据连线（锚点 → 镜头）；已有连线不重复。 */
  connections: WorkflowConnection[];
  /** 未批准/不存在的锚点；有 issue 的镜头不应生成。 */
  issues: AnchorLockIssue[];
  /** 可以安全生成的镜头（无 issue）。 */
  readyShotNodeIds: string[];
}

export function isApprovedAnchor(node: Pick<WorkflowNode, 'anchor'> | undefined): boolean {
  return Boolean(node?.anchor?.approved);
}

/**
 * 角色/风格锁定：把已批准锚点作为可见连线接入镜头节点，走现有 Graph → inputResolver 链路。
 * - 镜头声明了 anchorNodeIds：只用这些锚点，缺失或未批准则报 issue（未批准不拆镜）。
 * - 未声明：使用项目内全部已批准锚点。
 * 纯函数，不修改入参。
 */
export function planAnchorConnections(
  nodes: readonly AnchorNode[],
  connections: readonly Pick<WorkflowConnection, 'fromNodeId' | 'toNodeId'>[],
  createId: () => string,
): AnchorLockPlan {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const approved = nodes.filter(node => isApprovedAnchor(node) && !node.shot).map(node => node.id);
  const existing = new Set(connections.map(connection => `${connection.fromNodeId}->${connection.toNodeId}`));
  const plan: AnchorLockPlan = { connections: [], issues: [], readyShotNodeIds: [] };

  for (const shotNode of nodes) {
    if (!shotNode.shot) continue;
    const declared = shotNode.shot.anchorNodeIds;
    const anchorIds = declared && declared.length > 0 ? [...new Set(declared)] : approved;
    let blocked = false;
    for (const anchorId of anchorIds) {
      if (anchorId === shotNode.id) continue;
      const anchor = byId.get(anchorId);
      if (!anchor) {
        blocked = true;
        plan.issues.push({ shotNodeId: shotNode.id, anchorNodeId: anchorId, code: 'anchor-missing', message: `镜头引用的锚点 ${anchorId} 不存在` });
        continue;
      }
      if (!isApprovedAnchor(anchor)) {
        blocked = true;
        plan.issues.push({ shotNodeId: shotNode.id, anchorNodeId: anchorId, code: 'anchor-not-approved', message: `锚点 ${anchorId} 尚未批准，确认后再生成该镜头` });
        continue;
      }
      const key = `${anchorId}->${shotNode.id}`;
      if (existing.has(key)) continue;
      existing.add(key);
      plan.connections.push({ id: createId(), fromNodeId: anchorId, toNodeId: shotNode.id, kind: 'data' });
    }
    if (!blocked) plan.readyShotNodeIds.push(shotNode.id);
  }
  return plan;
}
