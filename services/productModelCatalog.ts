import type {
  AICapability,
  AIProvider,
  ProductRouteBinding,
  ProductModelMode,
  UserApiKey,
} from '../types';
import type { VideoAspectRatio } from './aiGateway';
import { getRouteCatalog } from './runningHubRouteCatalog';
import { PRODUCT_MODEL_ENTRIES } from '../tools/flovart/product-models.js';

export type ProductModelCapability = {
  modes: ProductModelMode[];
  aspectRatios: VideoAspectRatio[];
  resolutions: string[];
  durations: number[];
  qualities: string[];
  counts: number[];
  audioControl: 'none' | 'optional' | 'always';
  supportsWebSearch: boolean;
  supportsRealPersonCheck: boolean;
  supportsSeed: boolean;
  maxImageReferences: number;
  maxVideoReferences: number;
  maxAudioReferences: number;
};

export type ProductModelDefinition = {
  id: string;
  name: string;
  shortName: string;
  company: string;
  capability: Extract<AICapability, 'image' | 'video'>;
  provider: AIProvider;
  officialModelIds: string[];
  aliases: string[];
  badge?: string;
  status: 'available' | 'mapping-required';
  description: string;
  capabilities: ProductModelCapability;
};

const IMAGE_RATIOS: VideoAspectRatio[] = ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4'];
const VIDEO_RATIOS: VideoAspectRatio[] = ['16:9', '9:16'];
const baseImage = {
  modes: ['text-to-image', 'image-to-image'] as ProductModelMode[],
  aspectRatios: IMAGE_RATIOS,
  resolutions: ['1K', '2K', '4K'],
  durations: [],
  qualities: ['low', 'medium', 'high'],
  counts: [1, 2, 4],
  audioControl: 'none' as const,
  supportsWebSearch: false,
  supportsRealPersonCheck: false,
  supportsSeed: false,
  maxImageReferences: 8,
  maxVideoReferences: 0,
  maxAudioReferences: 0,
};
const baseVideo = {
  modes: ['text-to-video', 'image-to-video'] as ProductModelMode[],
  aspectRatios: VIDEO_RATIOS,
  resolutions: ['720p', '1080p'],
  durations: [4, 6, 8],
  qualities: [],
  counts: [1],
  audioControl: 'always' as const,
  supportsWebSearch: false,
  supportsRealPersonCheck: false,
  supportsSeed: false,
  maxImageReferences: 1,
  maxVideoReferences: 0,
  maxAudioReferences: 0,
};

const CAPABILITY_BY_ID: Record<string, ProductModelCapability> = {
  'flovart:gpt-image-2': { ...baseImage, resolutions: ['1K', '2K', '4K'], qualities: ['low', 'medium', 'high'], maxImageReferences: 16 },
  'flovart:gemini-3-pro-image': { ...baseImage, supportsWebSearch: true, maxImageReferences: 14 },
  'flovart:gemini-3.1-flash-image': { ...baseImage, aspectRatios: ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4', '1:4', '4:1', '1:8', '8:1', '21:9', '9:21'], resolutions: ['512', '1K', '2K', '4K'], supportsWebSearch: true, maxImageReferences: 14 },
  'flovart:gemini-3.1-flash-lite-image': { ...baseImage, aspectRatios: ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4'], resolutions: ['512', '1K', '2K'], supportsWebSearch: true, maxImageReferences: 14 },
  'flovart:imagen-4': { ...baseImage, modes: ['text-to-image'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'], resolutions: ['1K', '2K', '4K'], maxImageReferences: 0 },
  'flovart:seedream-5-pro': { ...baseImage, supportsWebSearch: true, supportsRealPersonCheck: true },
  'flovart:midjourney-v8-1': { ...baseImage, modes: ['text-to-image'], qualities: ['low', 'medium', 'high'], maxImageReferences: 1 },
  'flovart:seedance-2': { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'], durations: [-1, 4, 5, 6, 8, 10, 12, 15], resolutions: ['480p', '720p', '1080p'], audioControl: 'optional', supportsRealPersonCheck: true, supportsSeed: true, maxImageReferences: 9, maxVideoReferences: 3, maxAudioReferences: 3 },
  'flovart:seedance-2-fast': { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'reference-to-video'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'], durations: [-1, 4, 5, 6, 8, 10, 12, 15], resolutions: ['480p', '720p'], audioControl: 'optional', supportsRealPersonCheck: true, supportsSeed: true, maxImageReferences: 9, maxVideoReferences: 3, maxAudioReferences: 3 },
  'flovart:veo-3.1': { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame'], resolutions: ['720p', '1080p', '4K'], maxImageReferences: 3, supportsSeed: true },
  'flovart:veo-3.1-fast': { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame'], resolutions: ['720p', '1080p', '4K'], maxImageReferences: 3, supportsSeed: true },
  'flovart:veo-3.1-lite': { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'first-last-frame'], supportsSeed: true },
  'flovart:kling-video-3': { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'first-last-frame'], durations: [3, 5, 10, 15], audioControl: 'optional' },
  'flovart:kling-video-3-omni': { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame'], durations: [3, 5, 10, 15], audioControl: 'optional', maxImageReferences: 4, maxVideoReferences: 1, maxAudioReferences: 1 },
  'flovart:grok-imagine-video': { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'video-extension'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2'], durations: [1, 3, 5, 8, 10, 15], resolutions: ['720p', '1080p'], audioControl: 'none', maxImageReferences: 1, maxVideoReferences: 1 },
  'flovart:grok-imagine-video-1.5': { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'video-extension'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2'], durations: [1, 3, 5, 8, 10, 15], resolutions: ['720p', '1080p'], audioControl: 'none', maxImageReferences: 1, maxVideoReferences: 1 },
};

export const PRODUCT_MODEL_CATALOG: ProductModelDefinition[] = PRODUCT_MODEL_ENTRIES.map(entry => ({
  ...entry,
  capability: entry.capability as Extract<AICapability, 'image' | 'video'>,
  provider: entry.provider as AIProvider,
  status: entry.status as ProductModelDefinition['status'],
  capabilities: CAPABILITY_BY_ID[entry.id],
}));

const byId = new Map(PRODUCT_MODEL_CATALOG.map(model => [model.id, model]));
const normalize = (value?: string) => value?.trim().toLowerCase() || '';

export function getProductModel(value?: string | null): ProductModelDefinition | undefined {
  if (!value) return undefined;
  const direct = byId.get(value);
  if (direct) return direct;
  const normalized = normalize(value);
  return PRODUCT_MODEL_CATALOG.find(model => [...model.officialModelIds, ...model.aliases].some(id => normalize(id) === normalized));
}

export function getProductModels(capability: 'image' | 'video'): ProductModelDefinition[] {
  return PRODUCT_MODEL_CATALOG.filter(model => model.capability === capability);
}

export function getProductModelsByCompany(capability: 'image' | 'video'): { company: string; models: ProductModelDefinition[] }[] {
  const groups: { company: string; models: ProductModelDefinition[] }[] = [];
  const indexByCompany = new Map<string, number>();
  for (const model of getProductModels(capability)) {
    const idx = indexByCompany.get(model.company);
    if (idx === undefined) {
      indexByCompany.set(model.company, groups.length);
      groups.push({ company: model.company, models: [model] });
    } else {
      groups[idx].models.push(model);
    }
  }
  return groups;
}

export const VIDEO_MODE_ORDER: ProductModelMode[] = ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-extension'];

/** 固定产品能力与当前 BYOK 线路实际已实现的请求适配器取交集，避免 PromptBar 展示“能选但发不出去”的模式。 */
export function getRoutedVideoModes(productModelId: string, provider?: AIProvider, routeId = ''): ProductModelMode[] {
  const product = getProductModel(productModelId);
  if (!product || product.capability !== 'video') return [];
  const supported = (() => {
    if (!provider || provider === 'volcengine') return VIDEO_MODE_ORDER;
    if (provider === 'google') return ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame'];
    if (provider === 'xai') return ['text-to-video', 'image-to-video', 'video-extension'];
    if (provider === 'keling' || provider === 'minimax' || provider === 'custom' || provider === 'openai_compatible') return ['text-to-video', 'image-to-video'];
    if (provider === 'runningHub') {
      const endpoint = routeId.toLowerCase();
      if (/reference-to-video|multimodal-video|omni-reference/.test(endpoint)) return ['reference-to-video'];
      if (/start-end-to-video|first-last-frame/.test(endpoint)) return ['first-last-frame'];
      if (/image-to-video/.test(endpoint)) return ['image-to-video'];
      if (/text-to-video/.test(endpoint)) return ['text-to-video'];
      return ['text-to-video', 'image-to-video'];
    }
    return ['text-to-video'];
  })() as ProductModelMode[];
  return product.capabilities.modes.filter(mode => supported.includes(mode));
}

/** 各模式的不可用原因，用于 PromptBar 灰显 tooltip。 */
export function explainUnsupportedVideoMode(productModelId: string, mode: ProductModelMode): string | null {
  const product = getProductModel(productModelId);
  if (!product || product.capability !== 'video') return null;
  if (product.capabilities.modes.includes(mode)) return null;
  if (mode === 'reference-to-video') return '该模型不支持多模态参考输入';
  if (mode === 'first-last-frame') return '该模型不支持显式首尾帧';
  if (mode === 'video-extension') return '该模型不支持视频扩展';
  if (mode === 'image-to-video') return '该模型不支持图生视频';
  return '该模型不支持该生成方式';
}

function keyModels(key: UserApiKey): string[] {
  return Array.from(new Set([
    key.defaultModel,
    ...(key.models || []).map(model => model.id),
    ...(key.customModels || []),
  ].filter((value): value is string => Boolean(value?.trim()))));
}

function keySupportsProduct(key: UserApiKey, model: ProductModelDefinition): boolean {
  return !key.capabilities?.length || key.capabilities.includes(model.capability);
}

function keyStillExposesRoute(key: UserApiKey, routeId: string): boolean {
  const models = keyModels(key);
  return models.length === 0 || models.some(candidate => normalize(candidate) === normalize(routeId));
}

/** 第一阶段 RunningHub Route 注册表：从 runningHubRouteCatalog 派生，保证 seed 与完整 Route Capability Schema 同源。 */
type RunningHubRouteSeed = { productModelId: string; mode: ProductModelMode; routeId: string };
const RUNNINGHUB_ROUTE_SEED: RunningHubRouteSeed[] = getRouteCatalog().flatMap(schema =>
    schema.modes.map(mode => ({ productModelId: schema.productModelId, mode, routeId: schema.routeId })),
);

export function suggestProductRouteBindings(key: UserApiKey): ProductRouteBinding[] {
  if (key.provider === 'runningHub') {
    const filter = keyModels(key).map(normalize);
    const filterSet = filter.length ? new Set(filter) : null;
    return RUNNINGHUB_ROUTE_SEED
      .filter(seed => !filterSet || filterSet.has(normalize(seed.routeId)))
      .filter(seed => keySupportsProduct(key, byId.get(seed.productModelId)!))
      .map(seed => ({ productModelId: seed.productModelId, mode: seed.mode, routeId: seed.routeId, priority: 0, enabled: false, confirmed: false }));
  }
  const candidates = keyModels(key);
  return PRODUCT_MODEL_CATALOG.flatMap(model => {
    const ids = [...model.officialModelIds, ...model.aliases].map(normalize);
    const routeId = candidates.find(candidate => ids.includes(normalize(candidate)));
    if (!routeId) return [];
    return model.capabilities.modes.map(mode => ({ productModelId: model.id, mode, routeId, priority: 0, enabled: false, confirmed: false }));
  });
}

export function mergeSuggestedMappings(key: UserApiKey): ProductRouteBinding[] {
  const existing = key.routeBindings || [];
  const existingKeys = new Set(existing.map(binding => `${binding.productModelId}::${binding.mode}`));
  return [...existing, ...suggestProductRouteBindings(key).filter(binding => !existingKeys.has(`${binding.productModelId}::${binding.mode}`))];
}

export function resolveProductModelRoute(
  productModelId: string,
  mode: ProductModelMode,
  keys: UserApiKey[],
): { model: ProductModelDefinition; routeId: string; key: UserApiKey } | null {
  const model = byId.get(productModelId);
  if (!model) return null;
  const routes = keys
    .filter(key => key.status !== 'error' && keySupportsProduct(key, model))
    .flatMap(key => (key.routeBindings || []).filter(binding => (
      binding.productModelId === productModelId
      && binding.mode === mode
      && binding.enabled
      && binding.confirmed
      && Boolean(binding.routeId?.trim())
      && keyStillExposesRoute(key, binding.routeId)
    )).map(binding => ({ key, binding })))
    .sort((left, right) => (
      left.binding.priority - right.binding.priority
      || Number(Boolean(right.key.isDefault)) - Number(Boolean(left.key.isDefault))
      || left.key.id.localeCompare(right.key.id)
    ));
  const route = routes[0];
  return route ? { model, routeId: route.binding.routeId.trim(), key: route.key } : null;
}

export function resolveAnyProductRoute(
  productModelId: string,
  keys: UserApiKey[],
): { model: ProductModelDefinition; routeId: string; key: UserApiKey; mode: ProductModelMode } | null {
  const model = byId.get(productModelId);
  if (!model) return null;
  for (const mode of model.capabilities.modes) {
    const route = resolveProductModelRoute(productModelId, mode, keys);
    if (route) return { ...route, mode };
  }
  return null;
}

export function isProductModelConfigured(productModelId: string, keys: UserApiKey[]): boolean {
  return Boolean(resolveAnyProductRoute(productModelId, keys));
}

export function productModelLabel(value: string): string {
  return getProductModel(value)?.name || value;
}

export function sanitizeProductGenerationParams(productModelId: string | undefined, input: {
  mode?: ProductModelMode;
  aspectRatio?: VideoAspectRatio;
  resolution?: string;
  quality?: string;
  durationSec?: number;
  count?: number;
  generateAudio?: boolean;
  webSearch?: boolean;
  realPersonCheck?: boolean;
  referenceCount?: number;
}) {
  const model = getProductModel(productModelId);
  if (!model) return input;
  const capability = model.capabilities;
  const mode = input.mode === 'video-extension' && model.id.startsWith('flovart:veo-3.1')
    ? input.mode
    : input.mode && capability.modes.includes(input.mode) ? input.mode : capability.modes[0];
  const aspectRatio = input.aspectRatio && capability.aspectRatios.includes(input.aspectRatio) ? input.aspectRatio : capability.aspectRatios[0];
  const resolution = capability.resolutions.find(value => value.toLowerCase() === input.resolution?.toLowerCase())
    || capability.resolutions.find(value => value.toLowerCase() === (model.capability === 'video' ? '720p' : '1k'))
    || capability.resolutions[0];
  const quality = capability.qualities.includes(input.quality || '') ? input.quality : capability.qualities[0];
  let durationSec = input.durationSec !== undefined && capability.durations.includes(input.durationSec) ? input.durationSec : capability.durations.find(value => value > 0);
  if (model.id.startsWith('flovart:veo-3.1')) {
    const constrainedMode = mode === 'reference-to-video' || mode === 'video-extension';
    if ((resolution && resolution.toLowerCase() !== '720p') || constrainedMode) durationSec = 8;
    if (mode === 'video-extension') return {
      mode, aspectRatio, resolution: '720p', quality, durationSec: 8, count: 1, generateAudio: true,
      webSearch: undefined, realPersonCheck: undefined,
    };
  }
  const count = capability.counts.includes(input.count || 1) ? input.count || 1 : capability.counts[0];
  return {
    mode,
    aspectRatio,
    resolution,
    quality,
    durationSec,
    count,
    generateAudio: capability.audioControl === 'always' ? true : capability.audioControl === 'optional' ? input.generateAudio !== false : undefined,
    webSearch: capability.supportsWebSearch ? Boolean(input.webSearch) : undefined,
    realPersonCheck: capability.supportsRealPersonCheck ? input.realPersonCheck !== false : undefined,
  };
}
