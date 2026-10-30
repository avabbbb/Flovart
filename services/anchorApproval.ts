import type { WorkflowNode } from '../components/workflow/types';

/**
 * 锚点「批准/取消批准」：生成整体替换 anchor 的 update_node patch，走 applyOps 即进入撤销历史。
 * 非锚点节点返回 null；不修改入参。
 */
export function anchorApprovalPatch(node: Pick<WorkflowNode, 'anchor'>, now: Date = new Date()): Pick<WorkflowNode, 'anchor'> | null {
  const anchor = node.anchor;
  if (!anchor) return null;
  const next = { ...anchor, approved: !anchor.approved };
  if (next.approved) next.approvedAt = now.toISOString();
  else delete next.approvedAt;
  return { anchor: next };
}
