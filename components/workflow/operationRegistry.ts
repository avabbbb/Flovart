import { z } from 'zod';
import type {
  WorkflowNodeType,
  WorkflowOperationCapabilityId,
  WorkflowOperationInputBinding,
  WorkflowOperationInputRole,
  WorkflowOperationMediaType,
  WorkflowOperationOutputRole,
} from './types';

export type WorkflowOperationExecutorKind = 'provider-generation' | 'local-transform' | 'provider-image-tool';
export type WorkflowOperationConfirmationClass = 'none' | 'paid-operation-subgraph';
export type WorkflowOperationNodeToolName =
  | 'crop'
  | 'upscale'
  | 'video-trim'
  | 'video-av-split'
  | 'video-merge'
  | 'video-extract-frame'
  | 'audio-trim'
  | 'audio-speed';

export interface WorkflowOperationInputRoleSpec {
  role: WorkflowOperationInputRole;
  nodeTypes: readonly WorkflowNodeType[];
  min: number;
  max?: number;
}

export type WorkflowOperationParameterControl =
  | { key: string; kind: 'number'; label: string; min?: number; max?: number; step?: number; scale?: number; suffix?: string }
  | { key: string; kind: 'select'; label: string; options: readonly { label: string; value: string }[] };

export interface WorkflowOperationCapability {
  id: WorkflowOperationCapabilityId;
  label: string;
  mediaType: WorkflowOperationMediaType;
  inputRoles: readonly WorkflowOperationInputRoleSpec[];
  outputRoles: readonly { role: WorkflowOperationOutputRole; nodeType: WorkflowOperationMediaType; min: number; max?: number }[];
  executor: WorkflowOperationExecutorKind;
  confirmation: WorkflowOperationConfirmationClass;
  workflow: true;
  table: boolean;
  uiKey: string;
  nodeTool?: WorkflowOperationNodeToolName;
  agentUsage?: string;
  parameters: z.ZodType<Record<string, unknown>>;
  nodeToolArguments?: z.ZodType<Record<string, unknown>>;
  parameterControls?: readonly WorkflowOperationParameterControl[];
  promptRequired?: boolean;
  summarizeParameters: (parameters: Record<string, unknown>) => string;
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

const videoTrimParameters = z.object({
  startSec: z.number().min(0),
  endSec: z.number().positive(),
}).refine(value => value.endSec > value.startSec, '视频结束时间必须晚于开始时间');

const noParameters = z.object({});

const videoMergeToolArguments = z.object({
  sourceNodeIds: z.array(z.string().min(1)).min(2),
}).refine(value => new Set(value.sourceNodeIds).size === value.sourceNodeIds.length, '视频拼接来源不能重复');

const videoExtractFrameParameters = z.object({
  position: z.enum(['first', 'last']).default('first'),
});

const audioTrimParameters = z.object({
  startSec: z.number().min(0),
  endSec: z.number().positive(),
}).refine(value => value.endSec > value.startSec, '音频结束时间必须晚于开始时间');

const audioSpeedParameters = z.object({ speed: z.number().min(.25).max(4) });

export const WORKFLOW_OPERATION_CAPABILITIES: Readonly<Record<WorkflowOperationCapabilityId, WorkflowOperationCapability>> = {
  'image.generate@1': {
    id: 'image.generate@1', label: '图片生成',
    mediaType: 'image',
    inputRoles: [
      { role: 'reference_image', nodeTypes: ['image'], min: 0 },
      { role: 'prompt_context', nodeTypes: ['text'], min: 0 },
    ],
    outputRoles: [{ role: 'result_image', nodeType: 'image', min: 1, max: 4 }],
    executor: 'provider-generation', confirmation: 'paid-operation-subgraph', workflow: true, table: false,
    uiKey: 'image-generate',
    parameters: generateParameters,
    promptRequired: true,
    summarizeParameters: parameters => `${parameters.aspectRatio || '自适应'} · ×${parameters.count || 1}`,
  },
  'image.crop@1': {
    id: 'image.crop@1', label: '图片裁剪',
    mediaType: 'image',
    inputRoles: [{ role: 'source_image', nodeTypes: ['image'], min: 1, max: 1 }],
    outputRoles: [{ role: 'result_image', nodeType: 'image', min: 1, max: 1 }],
    executor: 'local-transform', confirmation: 'none', workflow: true, table: true,
    uiKey: 'image-crop', nodeTool: 'crop', agentUsage: 'crop 使用归一化 x/y/width/height（范围 0-1 且不得越界）',
    parameters: cropParameters,
    parameterControls: [
      { key: 'x', kind: 'number', label: '左侧', min: 0, max: 100, step: 1, scale: 100, suffix: '%' },
      { key: 'y', kind: 'number', label: '顶部', min: 0, max: 100, step: 1, scale: 100, suffix: '%' },
      { key: 'width', kind: 'number', label: '宽度', min: 1, max: 100, step: 1, scale: 100, suffix: '%' },
      { key: 'height', kind: 'number', label: '高度', min: 1, max: 100, step: 1, scale: 100, suffix: '%' },
    ],
    summarizeParameters: parameters => `${Math.round(Number(parameters.width || 0) * 100)}% × ${Math.round(Number(parameters.height || 0) * 100)}%`,
  },
  'image.upscale@1': {
    id: 'image.upscale@1', label: '高清放大',
    mediaType: 'image',
    inputRoles: [{ role: 'source_image', nodeTypes: ['image'], min: 1, max: 1 }],
    outputRoles: [{ role: 'result_image', nodeType: 'image', min: 1, max: 1 }],
    executor: 'provider-image-tool', confirmation: 'paid-operation-subgraph', workflow: true, table: true,
    uiKey: 'image-upscale', nodeTool: 'upscale', agentUsage: 'upscale 使用 targetLongEdge（512-8192）和 algorithm（high/bilinear/nearest）',
    parameters: upscaleParameters,
    parameterControls: [
      { key: 'targetLongEdge', kind: 'number', label: '长边', min: 512, max: 8192, step: 256, suffix: 'px' },
      { key: 'algorithm', kind: 'select', label: '算法', options: [
        { label: '高清', value: 'high' },
        { label: '平滑', value: 'bilinear' },
        { label: '像素', value: 'nearest' },
      ] },
    ],
    summarizeParameters: parameters => `${parameters.targetLongEdge || '-'}px · ${parameters.algorithm || '-'}`,
  },
  'video.trim@1': {
    id: 'video.trim@1', label: '视频剪辑', mediaType: 'video',
    inputRoles: [{ role: 'source_video', nodeTypes: ['video'], min: 1, max: 1 }],
    outputRoles: [{ role: 'result_video', nodeType: 'video', min: 1, max: 1 }],
    executor: 'local-transform', confirmation: 'none', workflow: true, table: true,
    uiKey: 'video-trim', nodeTool: 'video-trim', agentUsage: 'video-trim 使用 startSec/endSec，且 endSec 必须晚于 startSec',
    parameters: videoTrimParameters,
    parameterControls: [
      { key: 'startSec', kind: 'number', label: '开始', min: 0, step: .1, suffix: '秒' },
      { key: 'endSec', kind: 'number', label: '结束', min: .1, step: .1, suffix: '秒' },
    ],
    summarizeParameters: parameters => `${Number(parameters.startSec || 0).toFixed(1)}s → ${Number(parameters.endSec || 0).toFixed(1)}s`,
  },
  'video.av-split@1': {
    id: 'video.av-split@1', label: '音视频分离', mediaType: 'video',
    inputRoles: [{ role: 'source_video', nodeTypes: ['video'], min: 1, max: 1 }],
    outputRoles: [
      { role: 'result_video', nodeType: 'video', min: 1, max: 1 },
      { role: 'result_audio', nodeType: 'audio', min: 1, max: 1 },
    ],
    executor: 'local-transform', confirmation: 'none', workflow: true, table: true,
    uiKey: 'video-av-split', nodeTool: 'video-av-split', agentUsage: 'video-av-split 无额外参数，输出纯视频与纯音频',
    parameters: noParameters,
    summarizeParameters: () => '视频轨 + 音频轨',
  },
  'video.merge@1': {
    id: 'video.merge@1', label: '视频拼接', mediaType: 'video',
    inputRoles: [{ role: 'source_video', nodeTypes: ['video'], min: 2 }],
    outputRoles: [{ role: 'result_video', nodeType: 'video', min: 1, max: 1 }],
    executor: 'local-transform', confirmation: 'none', workflow: true, table: true,
    uiKey: 'video-merge', nodeTool: 'video-merge', agentUsage: 'video-merge 使用有序 sourceNodeIds（至少 2 个且不得重复）',
    parameters: noParameters,
    nodeToolArguments: videoMergeToolArguments,
    summarizeParameters: () => '按输入顺序拼接',
  },
  'video.extract-frame@1': {
    id: 'video.extract-frame@1', label: '导出视频帧', mediaType: 'video',
    inputRoles: [{ role: 'source_video', nodeTypes: ['video'], min: 1, max: 1 }],
    outputRoles: [{ role: 'result_image', nodeType: 'image', min: 1, max: 1 }],
    executor: 'local-transform', confirmation: 'none', workflow: true, table: true,
    uiKey: 'video-extract-frame', nodeTool: 'video-extract-frame', agentUsage: 'video-extract-frame 使用 position（first/last）',
    parameters: videoExtractFrameParameters,
    parameterControls: [{ key: 'position', kind: 'select', label: '位置', options: [
      { label: '首帧', value: 'first' },
      { label: '尾帧', value: 'last' },
    ] }],
    summarizeParameters: parameters => parameters.position === 'last' ? '尾帧' : '首帧',
  },
  'audio.trim@1': {
    id: 'audio.trim@1', label: '音频截取', mediaType: 'audio',
    inputRoles: [{ role: 'source_audio', nodeTypes: ['audio'], min: 1, max: 1 }],
    outputRoles: [{ role: 'result_audio', nodeType: 'audio', min: 1, max: 1 }],
    executor: 'local-transform', confirmation: 'none', workflow: true, table: true,
    uiKey: 'audio-trim', nodeTool: 'audio-trim', agentUsage: 'audio-trim 使用 startSec/endSec，且 endSec 必须晚于 startSec',
    parameters: audioTrimParameters,
    parameterControls: [
      { key: 'startSec', kind: 'number', label: '开始', min: 0, step: .1, suffix: '秒' },
      { key: 'endSec', kind: 'number', label: '结束', min: .1, step: .1, suffix: '秒' },
    ],
    summarizeParameters: parameters => `${Number(parameters.startSec || 0).toFixed(1)}s → ${Number(parameters.endSec || 0).toFixed(1)}s`,
  },
  'audio.speed@1': {
    id: 'audio.speed@1', label: '音频变速', mediaType: 'audio',
    inputRoles: [{ role: 'source_audio', nodeTypes: ['audio'], min: 1, max: 1 }],
    outputRoles: [{ role: 'result_audio', nodeType: 'audio', min: 1, max: 1 }],
    executor: 'local-transform', confirmation: 'none', workflow: true, table: true,
    uiKey: 'audio-speed', nodeTool: 'audio-speed', agentUsage: 'audio-speed 使用 speed（0.25-4）',
    parameters: audioSpeedParameters,
    parameterControls: [{ key: 'speed', kind: 'number', label: '速度', min: .25, max: 4, step: .05, suffix: '×' }],
    summarizeParameters: parameters => `${Number(parameters.speed || 1).toFixed(2)}×`,
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

export function validateWorkflowOperationOutputs(
  id: WorkflowOperationCapabilityId,
  outputs: readonly { role: WorkflowOperationOutputRole; nodeType: WorkflowOperationMediaType }[],
): void {
  const capability = getWorkflowOperationCapability(id);
  const counts = new Map<WorkflowOperationOutputRole, number>();
  outputs.forEach(output => {
    const spec = capability.outputRoles.find(item => item.role === output.role);
    if (!spec || spec.nodeType !== output.nodeType) throw new Error(`${capability.label}不允许输出 ${output.role}/${output.nodeType}`);
    counts.set(output.role, (counts.get(output.role) || 0) + 1);
  });
  capability.outputRoles.forEach(spec => {
    const count = counts.get(spec.role) || 0;
    if (count < spec.min) throw new Error(`${capability.label}至少需要 ${spec.min} 个 ${spec.role} 输出`);
    if (spec.max !== undefined && count > spec.max) throw new Error(`${capability.label}最多允许 ${spec.max} 个 ${spec.role} 输出`);
  });
}

export function parseWorkflowOperationParameters(id: WorkflowOperationCapabilityId, value: unknown): Record<string, unknown> {
  return getWorkflowOperationCapability(id).parameters.parse(value);
}

export function parseWorkflowOperationNodeToolArguments(id: WorkflowOperationCapabilityId, value: unknown): Record<string, unknown> {
  const capability = getWorkflowOperationCapability(id);
  return (capability.nodeToolArguments || capability.parameters).parse(value);
}
