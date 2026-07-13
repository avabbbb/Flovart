import type { UserApiKey } from '../types';
import { buildCapabilityModelOptions, modelRefModelId, modelRefProvider } from '../utils/modelRefs';
import { DEFAULT_PROVIDER_MODELS, getCapabilityDictionary, type VideoAspectRatio } from './aiGateway';
import { getProductModel } from './productModelCatalog';

export type GenerationMode = 'text' | 'image' | 'video' | 'audio';

export interface GenerationCapability {
  mode: GenerationMode;
  models: string[];
  aspectRatios: VideoAspectRatio[];
  resolutions: string[];
  durations: number[];
  supportsReferences: Array<'image' | 'video' | 'audio'>;
}

const fallbackModels = (mode: GenerationMode) => {
  if (mode === 'audio') return [];
  return Array.from(new Set(
    Object.values(DEFAULT_PROVIDER_MODELS).flatMap(models => models?.[mode] || []),
  ));
};

export function getGenerationCapability(
  keys: UserApiKey[],
  mode: GenerationMode,
  selectedModel?: string,
  fallback: string[] = fallbackModels(mode),
): GenerationCapability {
  if (mode === 'audio') {
    return { mode, models: [], aspectRatios: [], resolutions: [], durations: [], supportsReferences: [] };
  }
  const models = buildCapabilityModelOptions(keys, mode, fallback, selectedModel);
  if (mode === 'text') {
    return { mode, models, aspectRatios: [], resolutions: [], durations: [], supportsReferences: [] };
  }

  const modelRef = selectedModel || models[0] || '';
  const product = getProductModel(modelRef);
  if (product?.capability === mode) {
    return {
      mode,
      models,
      aspectRatios: [...product.capabilities.aspectRatios],
      resolutions: [...product.capabilities.resolutions],
      durations: [...product.capabilities.durations],
      supportsReferences: [
        ...(product.capabilities.maxImageReferences > 0 ? ['image' as const] : []),
        ...(product.capabilities.maxVideoReferences > 0 ? ['video' as const] : []),
        ...(product.capabilities.maxAudioReferences > 0 ? ['audio' as const] : []),
      ],
    };
  }
  const model = modelRefModelId(modelRef);
  const dictionary = getCapabilityDictionary(model, modelRefProvider(modelRef, keys));
  const supportsReferences = (['image', 'video', 'audio'] as const).filter(kind => Boolean(dictionary.multimodalSlots[kind]?.max));

  return {
    mode,
    models,
    aspectRatios: [...(dictionary.aspectRatios || [])],
    resolutions: [...(dictionary.resolutions || [])],
    durations: [...(dictionary.durations || [])],
    supportsReferences,
  };
}
