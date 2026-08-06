import { z } from 'zod';
import type {
  WorkflowNodeType,
  WorkflowOperationCapabilityId,
  WorkflowOperationInputBinding,
  WorkflowOperationInputRole,
} from './types';

export type WorkflowOperationExecutorKind = 'provider-generation' | 'local-transform' | 'provider-image-tool';
export type WorkflowOperationConfirmationClass = 'none' | 'paid-operation-subgraph';
export type WorkflowOperationNodeToolName = 'crop' | 'upscale';

export interface WorkflowOperationInputRoleSpec {
  role: WorkflowOperationInputRole;
  nodeTypes: readonly WorkflowNodeType[];
  min: number;
  max?: number;
}

export interface WorkflowOperationCapability {
  id: WorkflowOperationCapabilityId;
  label: string;
  inputRoles: readonly WorkflowOperationInputRoleSpec[];
  output: { role: 'result_image'; nodeType: 'image' };
  executor: WorkflowOperationExecutorKind;
  confirmation: WorkflowOperationConfirmationClass;
  workflow: true;
  table: boolean;
  uiKey: string;
  nodeTool?: WorkflowOperationNodeToolName;
  agentUsage?: string;
  parameters: z.ZodType<Record<string, unknown>>;
}

const generateParameters = z.object({
  submode: z.enum(['text-to-image', 'image-to-image']).optional(),
  aspectRatio: z.string().min(1).optional(),
  preserveReferenceAspectRatio: z.boolean().optional(),
  resolution: z.string().min(1).optional(),
  quality: z.string().min(1).optional(),
  count: z.number().int().min(1).max(4).default(1),
  enhancePrompt: z.boolean().optional(),
  webSearch: z.boolean().optional(),
  realPersonCheck: z.boolean().optional(),
});

const cropParameters = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
}).refine(value => value.x + value.width <= 1 && value.y + value.height <= 1, '裁剪范围不能超出图片');

const upscaleParameters = z.object({
  targetLongEdge: z.number().int().min(512).max(8192),
  algorithm: z.enum(['high', 'bilinear', 'nearest']).default('high'),
});

export const WORKFLOW_OPERATION_CAPABILITIES: Readonly<Record<WorkflowOperationCapabilityId, WorkflowOperationCapability>> = {
  'image.generate@1': {
    id: 'image.generate@1', label: '图片生成',
    inputRoles: [
      { role: 'reference_image', nodeTypes: ['image'], min: 0 },
      { role: 'prompt_context', nodeTypes: ['text'], min: 0 },
    ],
    output: { role: 'result_image', nodeType: 'image' },
    executor: 'provider-generation', confirmation: 'paid-operation-subgraph', workflow: true, table: false,
    uiKey: 'image-generate',
    parameters: generateParameters,
  },
  'image.crop@1': {
    id: 'image.crop@1', label: '图片裁剪',
    inputRoles: [{ role: 'source_image', nodeTypes: ['image'], min: 1, max: 1 }],
    output: { role: 'result_image', nodeType: 'image' },
    executor: 'local-transform', confirmation: 'none', workflow: true, table: true,
    uiKey: 'image-crop', nodeTool: 'crop', agentUsage: 'crop 使用归一化 x/y/width/height（范围 0-1 且不得越界）',
    parameters: cropParameters,
  },
  'image.upscale@1': {
    id: 'image.upscale@1', label: '高清放大',
    inputRoles: [{ role: 'source_image', nodeTypes: ['image'], min: 1, max: 1 }],
    output: { role: 'result_image', nodeType: 'image' },
    executor: 'provider-image-tool', confirmation: 'paid-operation-subgraph', workflow: true, table: true,
    uiKey: 'image-upscale', nodeTool: 'upscale', agentUsage: 'upscale 使用 targetLongEdge（512-8192）和 algorithm（high/bilinear/nearest）',
    parameters: upscaleParameters,
  },
};

export const WORKFLOW_OPERATION_CAPABILITY_IDS = Object.keys(WORKFLOW_OPERATION_CAPABILITIES) as WorkflowOperationCapabilityId[];
export const WORKFLOW_OPERATION_NODE_TOOLS = WORKFLOW_OPERATION_CAPABILITY_IDS
  .map(id => WORKFLOW_OPERATION_CAPABILITIES[id].nodeTool)
  .filter((tool): tool is WorkflowOperationNodeToolName => Boolean(tool));

export function getWorkflowOperationCapability(id: WorkflowOperationCapabilityId): WorkflowOperationCapability {
  return WORKFLOW_OPERATION_CAPABILITIES[id];
}

export function getWorkflowOperationCapabilityByNodeTool(tool: string): WorkflowOperationCapability | undefined {
  return WORKFLOW_OPERATION_CAPABILITY_IDS
    .map(id => WORKFLOW_OPERATION_CAPABILITIES[id])
    .find(capability => capability.nodeTool === tool);
}

export function getWorkflowOperationInputRoleForNodeType(
  id: WorkflowOperationCapabilityId,
  nodeType: WorkflowNodeType,
): WorkflowOperationInputRole | null {
  return getWorkflowOperationCapability(id).inputRoles.find(input => input.nodeTypes.includes(nodeType))?.role || null;
}

export function validateWorkflowOperationInputBindings(
  id: WorkflowOperationCapabilityId,
  bindings: readonly WorkflowOperationInputBinding[],
  options: { requireMinimum?: boolean } = {},
): void {
  const capability = getWorkflowOperationCapability(id);
  const counts = new Map<WorkflowOperationInputRole, number>();
  const ids = new Set<string>();
  const sources = new Set<string>();
  const orders = new Set<number>();
  bindings.forEach(binding => {
    const spec = capability.inputRoles.find(input => input.role === binding.role);
    if (!spec) throw new Error(`${capability.label}不允许输入角色 ${binding.role}`);
    if (!Number.isInteger(binding.order) || binding.order < 0) throw new Error('Operation 输入顺序必须是非负整数');
    if (ids.has(binding.id)) throw new Error(`Operation 输入 Binding ID 重复：${binding.id}`);
    if (sources.has(binding.sourceNodeId)) throw new Error(`Operation 输入来源重复：${binding.sourceNodeId}`);
    if (orders.has(binding.order)) throw new Error(`Operation 输入顺序重复：${binding.order}`);
    ids.add(binding.id);
    sources.add(binding.sourceNodeId);
    orders.add(binding.order);
    counts.set(binding.role, (counts.get(binding.role) || 0) + 1);
  });
  capability.inputRoles.forEach(spec => {
    const count = counts.get(spec.role) || 0;
    if (spec.max !== undefined && count > spec.max) throw new Error(`${capability.label}最多允许 ${spec.max} 个 ${spec.role} 输入`);
    if (options.requireMinimum && count < spec.min) throw new Error(`${capability.label}至少需要 ${spec.min} 个 ${spec.role} 输入`);
  });
}

export function parseWorkflowOperationParameters(id: WorkflowOperationCapabilityId, value: unknown): Record<string, unknown> {
  return getWorkflowOperationCapability(id).parameters.parse(value);
}
