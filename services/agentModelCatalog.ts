import type { UserApiKey } from '../types';
import type { WorkflowDocumentOperation, WorkflowNode } from '../components/workflow/types';
import { getProductModel, getProductModels, isProductModelConfigured } from './productModelCatalog';
import { modelCostTier, type ModelCostTier } from './modelCostTier';

/**
 * Agent 可用的产品模型目录：Agent 只能写真实存在的 modelId（如 flovart:seedream-5-flash），
 * 不再自己编 id。inspect 结果附带同一份目录，workflow.apply 写入前按它校验。
 */

export type AgentModelChoice = {
  id: string;
  name: string;
  modes: string[];
  /** 当前 API Key / 线路映射能直接跑；未知（没注入 Key）时省略。 */
  configured?: boolean;
  /** 费用档位：cheap 省钱 / standard / premium 高质量（同家族定位，不是价格）。 */
  costTier: ModelCostTier;
};

let keysProvider: (() => UserApiKey[]) | null = null;
/** 面板注入当前 API Key：目录标出哪些模型已配好线路。 */
export function setAgentModelKeysProvider(provider: (() => UserApiKey[]) | null) {
  keysProvider = provider;
}

function currentKeys(): UserApiKey[] | null {
  if (!keysProvider) return null;
  try { return keysProvider(); } catch { return null; }
}

export function listAgentModelChoices(capability: 'image' | 'video'): AgentModelChoice[] {
  const keys = currentKeys();
  const choices = getProductModels(capability).map(model => ({
    id: model.id,
    name: model.shortName || model.name,
    modes: [...model.capabilities.modes],
    costTier: modelCostTier(model.id),
    ...(keys ? { configured: isProductModelConfigured(model.id, keys) } : {}),
  }));
  // 已配好线路的排在前面，模型选择时优先用它们。
  return keys ? [...choices.filter(item => item.configured), ...choices.filter(item => !item.configured)] : choices;
}

export function agentModelCatalogSummary() {
  return {
    note: 'metadata.config.modelId 只能填这里的 id（configured=true 的已配好线路，可直接运行）；不要自己编 id。costTier=cheap/standard/premium 是费用档位（不是价格），用户没指定模型时给一个省钱档和一个质量档让用户选。',
    image: listAgentModelChoices('image'),
    video: listAgentModelChoices('video'),
  };
}

function formatChoices(capability: 'image' | 'video'): string {
  const choices = listAgentModelChoices(capability);
  const configured = choices.filter(item => item.configured);
  const shown = (configured.length ? configured : choices).slice(0, 30);
  return shown.map(item => `${item.id}（${item.name}）`).join('、')
    + (configured.length ? '（已配好线路）' : '')
    + (choices.length > shown.length ? ` 等，共 ${choices.length} 个，完整列表见 inspect 的 availableModels` : '');
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function generationModeOf(type: unknown, config: Record<string, unknown> | undefined): 'image' | 'video' | null {
  const mode = config?.mode;
  if (mode === 'image' || mode === 'video') return mode;
  if (typeof mode === 'string' && mode) return null; // text / audio 等不走产品模型目录
  return type === 'image' || type === 'video' ? type : null;
}

export class AgentModelIdError extends Error {}

/**
 * 校验并归一 operations 里写入的 metadata.config.modelId：
 * 已知别名改写成规范 id；未知或类型不符的 id 抛出带可用 id 列表的错误，整批不落写。
 */
export function normalizeOperationModelIds(
  operations: WorkflowDocumentOperation[],
  nodes: WorkflowNode[],
): WorkflowDocumentOperation[] {
  return operations.map((op, index) => {
    if (op.type === 'add_node' || op.type === 'create_connected_node') {
      const metadata = isRecord(op.node?.metadata) ? op.node.metadata as unknown as Record<string, unknown> : undefined;
      const config = isRecord(metadata?.config) ? metadata!.config as Record<string, unknown> : undefined;
      const modelId = fixModelId(config?.modelId, generationModeOf(op.node?.type, config), index, op.type);
      if (modelId === undefined || modelId === config?.modelId) return op;
      return { ...op, node: { ...op.node, metadata: { ...metadata, config: { ...config, modelId } } } } as WorkflowDocumentOperation;
    }
    if (op.type === 'update_node') {
      const current = nodes.find(node => node.id === op.id);
      const patchMetadata = isRecord(op.patch?.metadata) ? op.patch!.metadata as unknown as Record<string, unknown> : undefined;
      const directMetadata = isRecord(op.metadata) ? op.metadata as unknown as Record<string, unknown> : undefined;
      const currentConfig = isRecord(current?.metadata?.config) ? current!.metadata.config as unknown as Record<string, unknown> : undefined;
      const fix = (metadata: Record<string, unknown> | undefined) => {
        const config = isRecord(metadata?.config) ? metadata!.config as Record<string, unknown> : undefined;
        if (!config || !('modelId' in config)) return metadata;
        const mode = generationModeOf(op.patch?.type ?? current?.type, { ...currentConfig, ...config });
        const modelId = fixModelId(config.modelId, mode, index, op.type);
        return modelId === undefined || modelId === config.modelId ? metadata : { ...metadata, config: { ...config, modelId } };
      };
      const nextPatchMetadata = fix(patchMetadata);
      const nextDirectMetadata = fix(directMetadata);
      if (nextPatchMetadata === patchMetadata && nextDirectMetadata === directMetadata) return op;
      return {
        ...op,
        ...(nextPatchMetadata !== patchMetadata ? { patch: { ...op.patch, metadata: nextPatchMetadata } } : {}),
        ...(nextDirectMetadata !== directMetadata ? { metadata: nextDirectMetadata } : {}),
      } as WorkflowDocumentOperation;
    }
    return op;
  });
}

function fixModelId(value: unknown, mode: 'image' | 'video' | null, index: number, opType: string): string | undefined {
  if (value === undefined || value === null || value === '' || !mode) return undefined;
  const label = mode === 'video' ? '视频' : '图片';
  if (typeof value !== 'string') {
    throw new AgentModelIdError(`operations[${index}] ${opType} 的 config.modelId 必须是字符串。可用${label}模型 id：${formatChoices(mode)}`);
  }
  const product = getProductModel(value);
  if (!product || product.capability !== mode) {
    throw new AgentModelIdError(`operations[${index}] ${opType} 的 config.modelId「${value}」不是可用的${label}产品模型。可用 id：${formatChoices(mode)}`);
  }
  return product.id;
}
