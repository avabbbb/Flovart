import type { UserApiKey } from '../types';
import { buildCapabilityModelOptions, modelRefModelId, modelRefProvider } from '../utils/modelRefs';
import { DEFAULT_PROVIDER_MODELS, getCapabilityDictionary, type VideoAspectRatio } from './aiGateway';

export type GenerationMode = 'text' | 'image' | 'video';

export interface GenerationCapability {
  mode: GenerationMode;
  models: string[];
  aspectRatios: VideoAspectRatio[];
  resolutions: string[];
  durations: number[];
  supportsReferences: Array<'image' | 'video'>;
}

const fallbackModels = (mode: GenerationMode) => Array.from(new Set(
  Object.values(DEFAULT_PROVIDER_MODELS).flatMap(models => models?.[mode] || []),
));

export function getGenerationCapability(
  keys: UserApiKey[],
  mode: GenerationMode,
  selectedModel?: string,
  fallback: string[] = fallbackModels(mode),
): GenerationCapability {
  const models = buildCapabilityModelOptions(keys, mode, fallback, selectedModel);
  if (mode === 'text') {
    return { mode, models, aspectRatios: [], resolutions: [], durations: [], supportsReferences: [] };
  }

  const modelRef = selectedModel || models[0] || '';
  const model = modelRefModelId(modelRef);
  const dictionary = getCapabilityDictionary(model, modelRefProvider(modelRef, keys));
  const supportsReferences = (['image', 'video'] as const).filter(kind => Boolean(dictionary.multimodalSlots[kind]?.max));

  return {
    mode,
    models,
    aspectRatios: [...(dictionary.aspectRatios || [])],
    resolutions: [...(dictionary.resolutions || [])],
    durations: [...(dictionary.durations || [])],
    supportsReferences,
  };
}
