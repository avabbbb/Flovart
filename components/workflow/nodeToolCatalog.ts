import {
  WORKFLOW_OPERATION_NODE_TOOLS,
  getWorkflowOperationCapabilityByNodeTool,
  type WorkflowOperationNodeToolName,
} from './operationRegistry';

/** 尚未迁入 Operation Registry 的旧工具；每迁完一项就从这里删除。 */
export type WorkflowNodeToolName = WorkflowOperationNodeToolName;

export const WORKFLOW_NODE_TOOLS: readonly WorkflowNodeToolName[] = [
  ...WORKFLOW_OPERATION_NODE_TOOLS,
];

const OPERATION_TOOL_LABELS = Object.fromEntries(WORKFLOW_OPERATION_NODE_TOOLS.map(tool => [
  tool,
  getWorkflowOperationCapabilityByNodeTool(tool)!.label,
])) as Record<WorkflowOperationNodeToolName, string>;

export const WORKFLOW_NODE_TOOL_LABELS: Record<WorkflowNodeToolName, string> = {
  ...OPERATION_TOOL_LABELS,
};

export function isWorkflowNodeTool(value: string): value is WorkflowNodeToolName {
  return (WORKFLOW_NODE_TOOLS as readonly string[]).includes(value);
}
