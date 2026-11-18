import { z } from 'zod';
import {
  WORKFLOW_OPERATION_NODE_TOOLS,
  getWorkflowOperationCapabilityByNodeTool,
  type WorkflowOperationNodeToolName,
} from './operationRegistry';

/** 尚未迁入 Operation Registry 的旧工具；每迁完一项就从这里删除。 */
export type WorkflowNodeToolName = WorkflowOperationNodeToolName | 'reverse-prompt' | 'filter' | 'outpaint' | 'mask';

export const WORKFLOW_NODE_TOOLS: readonly WorkflowNodeToolName[] = [
  ...WORKFLOW_OPERATION_NODE_TOOLS,
  'reverse-prompt',
  'filter',
  'outpaint',
  'mask',
];

const OPERATION_TOOL_LABELS = Object.fromEntries(WORKFLOW_OPERATION_NODE_TOOLS.map(tool => [
  tool,
  getWorkflowOperationCapabilityByNodeTool(tool)!.label,
])) as Record<WorkflowOperationNodeToolName, string>;

export const WORKFLOW_NODE_TOOL_LABELS: Record<WorkflowNodeToolName, string> = {
  ...OPERATION_TOOL_LABELS,
  'reverse-prompt': '反推提示词',
  filter: '图片滤镜',
  outpaint: '扩展画面',
  mask: '蒙版编辑',
};

export function isWorkflowNodeTool(value: string): value is WorkflowNodeToolName {
  return (WORKFLOW_NODE_TOOLS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// 工具说明书（Agent 的 schema 发现）：每个画布工具一份——适用节点类型、计费、参数 JSON Schema、产出。
// 迁入 Operation Registry 的工具直接由 registry 的 zod 参数生成；旧工具在这里手写，迁完即删。
// workflow.node.tool.list、确认判定（paid 才弹卡）与内置 Agent 的工具说明都读这一份。
// ---------------------------------------------------------------------------

/** free：本地处理不计费；paid：调用 AI 服务，执行前必须用户确认；llm：调用用户配置的文本 / 视觉模型（消耗 token，不弹卡）。 */
export type WorkflowNodeToolBilling = 'free' | 'paid' | 'llm';

export interface WorkflowNodeToolSpec {
  tool: WorkflowNodeToolName;
  label: string;
  /** 源节点必须是这些类型之一（video-merge 指 sourceNodeIds 里的每一个）。 */
  inputTypes: readonly string[];
  billing: WorkflowNodeToolBilling;
  /** 工具自己的参数（不含 nodeId / tool / projectId），JSON Schema。 */
  parameters: Record<string, unknown>;
  /** 产出：写成哪种结果节点，或只改源节点。 */
  output: string;
  usage: string;
}

const LEGACY_TOOL_SPECS: readonly Omit<WorkflowNodeToolSpec, 'label'>[] = [
  {
    tool: 'reverse-prompt', inputTypes: ['image', 'video'], billing: 'llm',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: '不新建节点：反推结果写回源节点的 prompt',
    usage: 'reverse-prompt 无参数；需要用户配置支持图片理解的文本模型',
  },
  {
    tool: 'filter', inputTypes: ['image'], billing: 'free',
    parameters: {
      type: 'object', required: ['filters'], additionalProperties: false,
      properties: { filters: { type: 'object', description: '亮度 / 对比度 / 饱和度等数值，例如 { "brightness": 1.1, "contrast": 1.05 }', additionalProperties: { type: 'number' } } },
    },
    output: '不新建节点：只改源节点的显示滤镜',
    usage: 'filter 必须提供 filters 数值对象',
  },
  {
    tool: 'outpaint', inputTypes: ['image'], billing: 'paid',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        direction: { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'all'], default: 'right' },
        amount: { type: 'number', minimum: 0.05, maximum: 2, default: 0.5, description: '扩展幅度（相对原图边长）' },
        prompt: { type: 'string', description: '扩展区域的内容描述，可空' },
      },
    },
    output: '新建 1 个 image 结果节点',
    usage: 'outpaint 使用 direction（left/right/top/bottom/all）、amount（0.05-2）与可选 prompt',
  },
  {
    tool: 'mask', inputTypes: ['image'], billing: 'paid',
    parameters: {
      type: 'object', required: ['prompt'], additionalProperties: false,
      properties: {
        prompt: { type: 'string', minLength: 1 },
        maskNodeId: { type: 'string', description: '蒙版图片节点 id（与 maskHref 二选一）' },
        maskHref: { type: 'string', description: '蒙版图片地址（与 maskNodeId 二选一）' },
        maskMimeType: { type: 'string', default: 'image/png' },
      },
    },
    output: '新建 1 个 image 结果节点',
    usage: 'mask 必须提供 prompt，以及 maskNodeId 或 maskHref',
  },
];

function describeOutputs(roles: readonly { nodeType: string; min: number; max?: number }[]): string {
  return roles.map(role => {
    const count = role.max === undefined ? `${role.min} 个或更多` : role.min === role.max ? `${role.max} 个` : `${role.min}-${role.max} 个`;
    return `新建 ${count} ${role.nodeType} 结果节点`;
  }).join('；');
}

let specCache: readonly WorkflowNodeToolSpec[] | undefined;

export function workflowNodeToolSpecs(): readonly WorkflowNodeToolSpec[] {
  if (specCache) return specCache;
  const operationSpecs = WORKFLOW_OPERATION_NODE_TOOLS.map(tool => {
    const capability = getWorkflowOperationCapabilityByNodeTool(tool)!;
    const schema = capability.nodeToolArguments || capability.parameters;
    const parameters = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    delete parameters.$schema;
    return {
      tool,
      label: capability.label,
      inputTypes: [...(capability.inputRoles[0]?.nodeTypes || [capability.mediaType])],
      billing: capability.confirmation === 'none' ? 'free' : 'paid',
      parameters,
      output: describeOutputs(capability.outputRoles),
      usage: capability.agentUsage || '',
    } satisfies WorkflowNodeToolSpec;
  });
  specCache = Object.freeze([
    ...operationSpecs,
    ...LEGACY_TOOL_SPECS.map(spec => ({ ...spec, label: WORKFLOW_NODE_TOOL_LABELS[spec.tool] })),
  ]);
  return specCache;
}

export function workflowNodeToolSpec(tool: string): WorkflowNodeToolSpec | undefined {
  return workflowNodeToolSpecs().find(spec => spec.tool === tool);
}

/** 这个工具会不会调用付费 AI 服务（是的话执行前必须用户确认）。未知工具按付费处理（fail closed）。 */
export function workflowNodeToolIsPaid(tool: string): boolean {
  const spec = workflowNodeToolSpec(tool);
  return !spec || spec.billing === 'paid';
}

/** 这种节点能用哪些工具。 */
export function workflowNodeToolsFor(nodeType: string): readonly WorkflowNodeToolSpec[] {
  return workflowNodeToolSpecs().filter(spec => spec.inputTypes.includes(nodeType));
}

// ---------------------------------------------------------------------------
// 按媒体拆分的 Agent 工具：workflow.image.tool / workflow.video.tool / workflow.audio.tool。
// 三个命令都落到同一个 workflow.node.tool 实现；工具归属由说明书的 inputTypes 决定
// （reverse-prompt 同时属于图片和视频）。
// ---------------------------------------------------------------------------

export type WorkflowNodeToolFamily = 'image' | 'video' | 'audio';

export const WORKFLOW_NODE_TOOL_FAMILY_COMMANDS: Readonly<Record<string, WorkflowNodeToolFamily>> = Object.freeze({
  'workflow.image.tool': 'image',
  'workflow.video.tool': 'video',
  'workflow.audio.tool': 'audio',
});

const FAMILY_TOOL_NAMES: Readonly<Record<WorkflowNodeToolFamily, string>> = Object.freeze({
  image: 'flovart_image_tool',
  video: 'flovart_video_tool',
  audio: 'flovart_audio_tool',
});

/** workflow.node.tool 或任一媒体工具命令。 */
export function isWorkflowNodeToolCommand(command: string): boolean {
  return command === 'workflow.node.tool' || Object.hasOwn(WORKFLOW_NODE_TOOL_FAMILY_COMMANDS, command);
}

/** 某一类媒体可用的工具。 */
export function workflowNodeToolsOfFamily(family: WorkflowNodeToolFamily): readonly WorkflowNodeToolSpec[] {
  return workflowNodeToolSpecs().filter(spec => spec.inputTypes.includes(family));
}

/**
 * 媒体工具命令 → workflow.node.tool。工具不属于这一类时给出该用哪个工具，不改命令。
 * 其他命令原样返回。
 */
export function resolveWorkflowNodeToolCommand(command: string, tool: unknown):
  | { ok: true; command: string }
  | { ok: false; message: string } {
  const family = WORKFLOW_NODE_TOOL_FAMILY_COMMANDS[command];
  if (!family) return { ok: true, command };
  const name = typeof tool === 'string' ? tool.trim() : '';
  const spec = workflowNodeToolSpec(name);
  if (spec && spec.inputTypes.includes(family)) return { ok: true, command: 'workflow.node.tool' };
  const own = workflowNodeToolsOfFamily(family).map(item => item.tool).join('、');
  if (!spec) return { ok: false, message: `${FAMILY_TOOL_NAMES[family]} 不支持工具：${name || '（空）'}。可用：${own}` };
  const other = (spec.inputTypes as WorkflowNodeToolFamily[]).map(type => FAMILY_TOOL_NAMES[type]).filter(Boolean).join(' / ');
  return { ok: false, message: `${name} 不是${family === 'image' ? '图片' : family === 'video' ? '视频' : '音频'}工具，请用 ${other}。${FAMILY_TOOL_NAMES[family]} 可用：${own}` };
}
