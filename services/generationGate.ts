import type { UserApiKey } from '../types';
import type { WorkflowNode } from '../components/workflow/types';

type GenerationCapability = {
    executor?: string;
    mediaType?: 'image' | 'video' | 'audio';
};

export interface GenerationGateDetails {
  serviceLabel: string;
  modelLabel: string;
  mediaType: 'image' | 'video';
  taskCount: number;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  openai_compatible: 'OpenAI 兼容服务',
  custom: '自定义 AI 服务',
  google: 'Google',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  qwen: '通义千问',
  xai: 'xAI',
  siliconflow: 'SiliconFlow',
  runningHub: 'RunningHub',
};

const isMediaNode = (node: Pick<WorkflowNode, 'type'>) => ['image', 'video'].includes(node.type);

/** Provider generation and paid image tools are the only operations that need an external-cost gate. */
export function requiresExternalGenerationGate(
  node: Pick<WorkflowNode, 'type'>,
  capability?: GenerationCapability,
): boolean {
  if (capability?.executor === 'local-transform') return false;
  if (capability?.executor === 'provider-generation' || capability?.executor === 'provider-image-tool') return true;
  return !capability && isMediaNode(node);
}

function displayModel(modelId?: string) {
  if (!modelId) return '自动选择';
  return modelId.replace(/^flovart:/, '');
}

function findService(keys: UserApiKey[], mediaType: 'image' | 'video') {
  const key = keys.find(item => item.capabilities?.length ? item.capabilities.includes(mediaType) : false) || keys[0];
  return key ? (key.name || PROVIDER_LABELS[key.provider] || '当前 AI 服务') : '当前 AI 服务';
}

export function getGenerationGateDetails(
  node: Pick<WorkflowNode, 'type' | 'metadata'>,
  capability: GenerationCapability | undefined,
  keys: UserApiKey[],
): GenerationGateDetails {
  const config = node.metadata.config;
  const mediaType: 'image' | 'video' = capability?.mediaType === 'video' || config?.mode === 'video' || node.type === 'video' ? 'video' : 'image';
  const operation = node.metadata.operation;
  const modelId = operation?.recipe.productModelId || config?.modelId;
  const rawCount = operation?.recipe.parameters.count ?? config?.count ?? 1;
  const taskCount = Math.max(1, Number.isFinite(Number(rawCount)) ? Number(rawCount) : 1);
  return {
    serviceLabel: findService(keys, mediaType),
    modelLabel: displayModel(modelId),
    mediaType,
    taskCount,
  };
}

export function buildGenerationGateSummary(details: GenerationGateDetails) {
  const mediaLabel = details.mediaType === 'video' ? '视频' : '图片';
  return [
    `AI 服务：${details.serviceLabel}`,
    `模型：${details.modelLabel}`,
    `任务：${details.taskCount} 个${mediaLabel}生成`,
    '此操作将调用你的 AI 服务，并可能产生费用。',
    '确定开始生成吗？',
  ].join('\n');
}
