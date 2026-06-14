import type { WorkflowEdge, WorkflowNode } from '../components/nodeflow/types';
import type { UnifiedProjectRuntime } from '../types/runtime';
import { selectWorkflowGraph } from '../utils/runtimeSelectors';

export interface RuntimeWorkflowExecutionInput {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export function createWorkflowExecutionInputFromRuntime(
  runtime: UnifiedProjectRuntime,
): RuntimeWorkflowExecutionInput {
  const graph = selectWorkflowGraph(runtime);
  return {
    nodes: graph.nodes,
    edges: graph.edges,
  };
}
