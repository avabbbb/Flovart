import type { WorkflowNode } from './types';

export interface WorkflowLayerPreview {
  source?: WorkflowNode;
  candidates: WorkflowNode[];
  takeId?: string;
}

/** 叠加层 Operation 当前选中的 Take：源图 + 候选输出节点（按网格顺序）。只用于显示，不改数据。 */
export function deriveWorkflowLayerPreview(operationNode: WorkflowNode, nodes: readonly WorkflowNode[]): WorkflowLayerPreview | undefined {
  const operation = operationNode.metadata.operation;
  if (!operation || operation.capabilityId !== 'image.layer@1') return undefined;
  const byId = new Map(nodes.map(node => [node.id, node] as const));
  const sourceBinding = operation.recipe.inputBindings.find(binding => binding.role === 'source_image');
  const take = operation.takes.find(item => item.id === operation.selectedTakeId)
    || [...operation.takes].reverse().find(item => item.status === 'success');
  const candidates = (take?.outputNodeIds || [])
    .map(id => byId.get(id))
    .filter((node): node is WorkflowNode => Boolean(node));
  return { source: sourceBinding ? byId.get(sourceBinding.sourceNodeId) : undefined, candidates, takeId: take?.id };
}
