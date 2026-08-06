import {
  WORKFLOW_OPERATION_NODE_TOOLS,
  getWorkflowOperationCapabilityByNodeTool,
  type WorkflowOperationNodeToolName,
} from './operationRegistry';

/** 尚未迁入 Operation Registry 的旧工具；每迁完一项就从这里删除。 */
export type LegacyWorkflowNodeToolName =
  | 'remove-background'
  | 'split-layers'
  | 'edit'
  | 'rotate'
  | 'split-grid';

export type WorkflowNodeToolName = WorkflowOperationNodeToolName | LegacyWorkflowNodeToolName;

const LEGACY_WORKFLOW_NODE_TOOLS: readonly LegacyWorkflowNodeToolName[] = [
  'remove-background', 'split-layers', 'edit', 'rotate', 'split-grid',
];

export const WORKFLOW_NODE_TOOLS: readonly WorkflowNodeToolName[] = [
  ...WORKFLOW_OPERATION_NODE_TOOLS,
  ...LEGACY_WORKFLOW_NODE_TOOLS,
];

const OPERATION_TOOL_LABELS = Object.fromEntries(WORKFLOW_OPERATION_NODE_TOOLS.map(tool => [
  tool,
  getWorkflowOperationCapabilityByNodeTool(tool)!.label,
])) as Record<WorkflowOperationNodeToolName, string>;

export const WORKFLOW_NODE_TOOL_LABELS: Record<WorkflowNodeToolName, string> = {
  ...OPERATION_TOOL_LABELS,
  'remove-background': '移除背景',
  'split-layers': '拆分图层',
  edit: '图片编辑',
  rotate: '旋转镜像',
  'split-grid': '宫格切分',
};

export function isWorkflowNodeTool(value: string): value is WorkflowNodeToolName {
  return (WORKFLOW_NODE_TOOLS as readonly string[]).includes(value);
}
