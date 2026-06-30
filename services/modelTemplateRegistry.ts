import type { AIProvider } from '../types';
import {
  DEFAULT_PROVIDER_MODELS,
  PROVIDER_LABELS,
  getCapabilityDictionary,
  supportsMaskImageEditing,
  supportsReferenceImageEditing,
  type MultimodalSlotKind,
} from './aiGateway';

export type ModelTemplateCapability = 'text' | 'image' | 'video' | 'videoEdit';
export type ModelParamFieldType = 'text' | 'number' | 'boolean' | 'select';
export type ModelReferenceKind = MultimodalSlotKind;

export interface ModelParamOption {
  label: string;
  value: string | number;
}

export interface ModelParamSchemaField {
  key: string;
  label: string;
  type: ModelParamFieldType;
  description?: string;
  defaultValue?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: ModelParamOption[];
  group?: 'basic' | 'advanced' | 'provider';
}

export interface ModelReferenceSlotInfo {
  kind: ModelReferenceKind;
  max: number;
  roles: string[];
}

export interface ModelTemplate {
  id: string;
  provider: AIProvider;
  model: string;
  displayName: string;
  capability: ModelTemplateCapability;
  description: string;
  tags: string[];
  supportsReferenceImage?: boolean;
  supportsMaskEdit?: boolean;
  supportsVideoExtend?: boolean;
  supportsVideoRestyle?: boolean;
  paramsSchema: ModelParamSchemaField[];
  defaultParams: Record<string, unknown>;
  referenceSlots?: ModelReferenceSlotInfo[];
  maxReferences?: number;
  referenceTypes?: ModelReferenceKind[];
  complianceCheck?: boolean;
  promptOptimization?: boolean;
  notes?: string;
}

const ASPECT_RATIO_OPTIONS: ModelParamOption[] = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '1:1', value: '1:1' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '21:9', value: '21:9' },
];

const PARAM_SCHEMAS: Record<ModelTemplateCapability, ModelParamSchemaField[]> = {
  text: [
    {
      key: 'temperature',
      label: 'Temperature',
      type: 'number',
      description: 'Sampling temperature for text generation.',
      defaultValue: 0.7,
      min: 0,
      max: 1,
      step: 0.1,
      group: 'basic',
    },
  ],
  image: [
    {
      key: 'aspectRatio',
      label: 'Aspect Ratio',
      type: 'select',
      description: 'Output aspect ratio.',
      defaultValue: '16:9',
      options: ASPECT_RATIO_OPTIONS,
      group: 'basic',
    },
  ],
  video: [
    {
      key: 'aspectRatio',
      label: 'Aspect Ratio',
      type: 'select',
      description: 'Output aspect ratio.',
      defaultValue: '16:9',
      options: ASPECT_RATIO_OPTIONS,
      group: 'basic',
    },
    {
      key: 'durationSec',
      label: 'Duration (sec)',
      type: 'number',
      description: 'Requested shot duration.',
      defaultValue: 4,
      min: 1,
      max: 12,
      step: 1,
      group: 'basic',
    },
  ],
  videoEdit: [
    {
      key: 'trimInSec',
      label: 'Trim In',
      type: 'number',
      description: 'Video trim start time.',
      min: 0,
      step: 0.1,
      group: 'basic',
    },
    {
      key: 'trimOutSec',
      label: 'Trim Out',
      type: 'number',
      description: 'Video trim end time.',
      min: 0,
      step: 0.1,
      group: 'basic',
    },
  ],
};

const DEFAULT_PARAMS: Record<ModelTemplateCapability, Record<string, unknown>> = {
  text: { temperature: 0.7 },
  image: { aspectRatio: '16:9' },
  video: { aspectRatio: '16:9', durationSec: 4 },
  videoEdit: {},
};

function humanizeCapability(capability: ModelTemplateCapability): string {
  if (capability === 'videoEdit') return 'video edit';
  return capability;
}

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

function buildTemplateDescription(provider: AIProvider, capability: ModelTemplateCapability): string {
  return `${PROVIDER_LABELS[provider]} ${humanizeCapability(capability)} template`;
}

function buildTemplateTags(provider: AIProvider, capability: ModelTemplateCapability, model: string): string[] {
  const tags: string[] = [provider, capability];
  if (capability === 'image' && supportsReferenceImageEditing(model)) tags.push('reference-image');
  if (capability === 'image' && supportsMaskImageEditing(model)) tags.push('mask-edit');
  if (capability === 'video') tags.push('storyboard');
  return tags;
}

function deriveReferenceSlots(model: string, provider: AIProvider, capability: ModelTemplateCapability): {
  referenceSlots?: ModelReferenceSlotInfo[];
  maxReferences?: number;
  referenceTypes?: ModelReferenceKind[];
} {
  if (capability !== 'video' && capability !== 'image') return {};
  const dict = getCapabilityDictionary(model, provider);
  const slots = dict.multimodalSlots;
  const kinds = Object.keys(slots) as ModelReferenceKind[];
  if (kinds.length === 0) return {};
  const referenceSlots: ModelReferenceSlotInfo[] = kinds
    .map(kind => {
      const info = slots[kind];
      if (!info || info.max <= 0) return null;
      return { kind, max: info.max, roles: info.roles };
    })
    .filter((entry): entry is ModelReferenceSlotInfo => entry !== null);
  if (referenceSlots.length === 0) return {};
  const total = referenceSlots.reduce((sum, slot) => sum + slot.max, 0);
  return {
    referenceSlots,
    maxReferences: total,
    referenceTypes: referenceSlots.map(slot => slot.kind),
  };
}

function deriveComplianceAndPromptOptimization(model: string, provider: AIProvider, capability: ModelTemplateCapability): {
  complianceCheck?: boolean;
  promptOptimization?: boolean;
  notes?: string;
} {
  const normalized = model.trim().toLowerCase();
  if (provider === 'volcengine' && normalized.includes('seedance')) {
    return {
      complianceCheck: true,
      promptOptimization: true,
      notes: 'Seedance 2.0 支持 9 图 + 3 视频 + 3 音频参考输入；生成前自动做合规校验和 prompt 优化。',
    };
  }
  return {};
}

function buildBuiltinTemplates(): ModelTemplate[] {
  const templates: ModelTemplate[] = [];

  for (const [provider, modelMap] of Object.entries(DEFAULT_PROVIDER_MODELS) as Array<[
    AIProvider,
    { text: string[]; image: string[]; video: string[] }
  ]>) {
    for (const capability of ['text', 'image', 'video'] as const) {
      const models = modelMap[capability] ?? [];
      for (const model of models) {
        const refInfo = deriveReferenceSlots(model, provider, capability);
        const complianceInfo = deriveComplianceAndPromptOptimization(model, provider, capability);
        templates.push({
          id: `${provider}:${capability}:${model}`,
          provider,
          model,
          displayName: model,
          capability,
          description: buildTemplateDescription(provider, capability),
          tags: buildTemplateTags(provider, capability, model),
          supportsReferenceImage: capability === 'image' ? supportsReferenceImageEditing(model) : undefined,
          supportsMaskEdit: capability === 'image' ? supportsMaskImageEditing(model) : undefined,
          supportsVideoExtend: capability === 'video' ? true : undefined,
          supportsVideoRestyle: capability === 'video' ? true : undefined,
          paramsSchema: PARAM_SCHEMAS[capability],
          defaultParams: DEFAULT_PARAMS[capability],
          ...refInfo,
          ...complianceInfo,
        });
      }
    }
  }

  return templates;
}

const BUILTIN_MODEL_TEMPLATES = buildBuiltinTemplates();

export function getBuiltinModelTemplates(): ModelTemplate[] {
  return BUILTIN_MODEL_TEMPLATES;
}

export function getModelTemplatesByCapability(
  capability: ModelTemplateCapability,
  provider?: AIProvider,
): ModelTemplate[] {
  return BUILTIN_MODEL_TEMPLATES.filter((template) => (
    template.capability === capability && (!provider || template.provider === provider)
  ));
}

export function findModelTemplateByModel(
  model: string | null | undefined,
  capability?: ModelTemplateCapability,
): ModelTemplate | null {
  const normalized = model?.trim();
  if (!normalized) return null;
  const normalizedInput = normalizeModelId(normalized);
  return BUILTIN_MODEL_TEMPLATES.find((template) => (
    (!capability || template.capability === capability)
    && (
      normalizeModelId(template.model) === normalizedInput
      || normalizedInput.endsWith(`/${normalizeModelId(template.model)}`)
      || normalizeModelId(template.model).endsWith(`/${normalizedInput}`)
    )
  )) ?? null;
}

export function getModelCapabilities(model: string | null | undefined, capability?: ModelTemplateCapability) {
  const template = findModelTemplateByModel(model, capability);
  if (!template) return null;
  return {
    referenceSlots: template.referenceSlots,
    maxReferences: template.maxReferences,
    referenceTypes: template.referenceTypes,
    complianceCheck: template.complianceCheck,
    promptOptimization: template.promptOptimization,
    notes: template.notes,
    supportsReferenceImage: template.supportsReferenceImage,
    supportsMaskEdit: template.supportsMaskEdit,
  };
}

export function isSeedanceModel(model: string | null | undefined): boolean {
  const normalized = model?.trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes('seedance');
}

export function getReferenceSlotMax(model: string | null | undefined, kind: ModelReferenceKind, capability?: ModelTemplateCapability): number {
  const template = findModelTemplateByModel(model, capability);
  if (!template?.referenceSlots) return kind === 'image' ? 1 : 0;
  return template.referenceSlots.find(slot => slot.kind === kind)?.max ?? 0;
}
