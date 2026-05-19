import type { AICapability, AIProvider } from '../types';
import {
  DEFAULT_PROVIDER_MODELS,
  PROVIDER_LABELS,
  supportsMaskImageEditing,
  supportsReferenceImageEditing,
} from './aiGateway';

export type ModelTemplateCapability = AICapability | 'videoEdit';
export type ModelParamFieldType = 'text' | 'number' | 'boolean' | 'select';

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
  agent: [],
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
  agent: {},
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

function buildBuiltinTemplates(): ModelTemplate[] {
  const templates: ModelTemplate[] = [];

  for (const [provider, modelMap] of Object.entries(DEFAULT_PROVIDER_MODELS) as Array<[
    AIProvider,
    { text: string[]; image: string[]; video: string[]; agent?: string[] }
  ]>) {
    for (const capability of ['text', 'image', 'video', 'agent'] as const) {
      const models = modelMap[capability] ?? [];
      for (const model of models) {
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
