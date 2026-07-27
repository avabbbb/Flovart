import type {
  AICapability,
  AIProvider,
  ProductModelMode,
  RouteMappingBinding,
  UserApiKey,
} from '../types';
import type { VideoAspectRatio } from './aiGateway';
import { getRouteCatalog, getRouteDurations, getRouteSchema } from './runningHubRouteCatalog';
import { PRODUCT_MODEL_ENTRIES } from '../tools/flovart/product-models.js';
import { resolveRouteMapping } from './routeMapping';

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

export type ProductRouteContext = {
  provider?: AIProvider;
  routeId?: string;
};

export type ProductReferenceLimits = {
  image: number;
  video: number;
  audio: number;
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
export const IMAGE_MODE_ORDER: ProductModelMode[] = ['text-to-image', 'image-to-image'];

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

/** 图片产品模型与当前 BYOK 线路实际已实现的请求适配器取交集。RunningHub 路由名带 /text-to-image 或 /image-to-image 决定支持的模式；非 RunningHub Provider 默认仅 text-to-image，OpenAI GPT Image 系列支持 image-to-image。 */
export function getRoutedImageModes(productModelId: string, provider?: AIProvider, routeId = ''): ProductModelMode[] {
  const product = getProductModel(productModelId);
  if (!product || product.capability !== 'image') return [];
  const supported = (() => {
    if (!provider) return IMAGE_MODE_ORDER;
    if (provider === 'openai_compatible' || provider === 'openai') return ['text-to-image', 'image-to-image'];
    if (provider === 'google') return ['text-to-image', 'image-to-image'];
    if (provider === 'runningHub') {
      const endpoint = routeId.toLowerCase();
      if (/image-to-image/.test(endpoint)) return ['image-to-image'];
      if (/text-to-image/.test(endpoint)) return ['text-to-image'];
      return IMAGE_MODE_ORDER;
    }
    return ['text-to-image'];
  })() as ProductModelMode[];
  return product.capabilities.modes.filter(mode => supported.includes(mode));
}

/** 图片产品模型是否在当前 BYOK 线路下支持 image-to-image；用于 PromptBar 决定是否暴露「生成方式」按钮与「保留参考图原始比例」开关。 */
export function routedImageSupportsImageToImage(productModelId: string, provider?: AIProvider, routeId = ''): boolean {
  return getRoutedImageModes(productModelId, provider, routeId).includes('image-to-image');
}

/** 图片模式不可用原因，用于 PromptBar 灰显 tooltip。 */
export function explainUnsupportedImageMode(productModelId: string, mode: ProductModelMode): string | null {
  const product = getProductModel(productModelId);
  if (!product || product.capability !== 'image') return null;
  if (product.capabilities.modes.includes(mode)) return null;
  if (mode === 'image-to-image') return '该模型不支持图生图';
  if (mode === 'text-to-image') return '该模型不支持纯文生图';
  return '该模式当前不存在';
}

const DIRECT_VIDEO_RATIOS: Partial<Record<AIProvider, VideoAspectRatio[]>> = {
  google: ['16:9', '9:16'],
  minimax: ['16:9', '9:16', '1:1'],
  keling: ['16:9', '9:16', '1:1'],
  xai: ['1:1', '16:9', '9:16', '4:3', '3:4', '2:3', '3:2'],
};

function mappedRouteSchema(productModelId: string, mode: ProductModelMode, context?: ProductRouteContext) {
  if (context?.provider !== 'runningHub' || !context.routeId) return undefined;
  const schema = getRouteSchema(context.routeId);
  return schema?.productModelId === productModelId && schema.modes.includes(mode) ? schema : undefined;
}

/** PromptBar 与提交校验共同使用的最终线路能力，避免产品卡能力覆盖 Provider 的真实限制。 */
export function getEffectiveProductModelCapabilities(
  productModelId: string,
  mode: ProductModelMode,
  context?: ProductRouteContext,
): ProductModelCapability | undefined {
  const product = getProductModel(productModelId);
  if (!product) return undefined;
  const base = product.capabilities;
  const schema = mappedRouteSchema(product.id, mode, context);
  if (schema) {
    const routeRatios = schema.aspectRatioField === null
      ? []
      : (schema.aspectRatioValues?.filter((value): value is VideoAspectRatio => base.aspectRatios.includes(value as VideoAspectRatio)) || base.aspectRatios);
    const routeDurations = getRouteDurations(schema.routeId);
    const routeFields = new Set(schema.params.map(param => param.field));
    return {
      ...base,
      aspectRatios: [...routeRatios],
      durations: routeDurations?.length ? routeDurations : [...base.durations],
      audioControl: base.audioControl === 'always' ? 'always' : routeFields.has('generateAudio') ? base.audioControl : 'none',
      supportsWebSearch: base.supportsWebSearch && routeFields.has('webSearch'),
      supportsRealPersonCheck: base.supportsRealPersonCheck && routeFields.has('realPersonMode'),
      supportsSeed: base.supportsSeed && routeFields.has('seed'),
    };
  }
  const providerRatios = product.capability === 'video' && context?.provider ? DIRECT_VIDEO_RATIOS[context.provider] : undefined;
  return {
    ...base,
    aspectRatios: providerRatios ? base.aspectRatios.filter(ratio => providerRatios.includes(ratio)) : [...base.aspectRatios],
    durations: product.id.startsWith('flovart:veo-3.1') && (mode === 'reference-to-video' || mode === 'video-extension') ? [8] : [...base.durations],
    audioControl: product.capability === 'video' && ['keling', 'minimax', 'custom', 'openai_compatible'].includes(context?.provider || '') ? 'none' : base.audioControl,
  };
}

/** 线路实际可接收的 @ 媒体数量；0 表示该媒体类型不得进入 Provider payload。 */
export function getEffectiveReferenceLimits(
  productModelId: string,
  mode: ProductModelMode,
  context?: ProductRouteContext,
): ProductReferenceLimits {
  const empty = { image: 0, video: 0, audio: 0 };
  const product = getProductModel(productModelId);
  if (!product) return empty;
  const schema = mappedRouteSchema(product.id, mode, context);
  if (schema) {
    return schema.media.reduce<ProductReferenceLimits>((limits, spec) => ({
      ...limits,
      [spec.kind]: limits[spec.kind] + spec.max,
    }), empty);
  }
  if (product.capability === 'image') {
    return mode === 'image-to-image' ? { ...empty, image: product.capabilities.maxImageReferences } : empty;
  }
  if (mode === 'image-to-video') return { ...empty, image: 1 };
  if (mode === 'first-last-frame') return { ...empty, image: 2 };
  if (mode === 'video-extension') return { ...empty, video: 1 };
  if (mode !== 'reference-to-video') return empty;
  if (context?.provider === 'google') return { ...empty, image: Math.min(3, product.capabilities.maxImageReferences) };
  return {
    image: product.capabilities.maxImageReferences,
    video: product.capabilities.maxVideoReferences,
    audio: product.capabilities.maxAudioReferences,
  };
}

export function explainReferenceCompatibility(
  productModelId: string | undefined,
  mode: ProductModelMode,
  referenceKinds: Array<'image' | 'video' | 'audio'>,
  context?: ProductRouteContext,
): string | null {
  if (!productModelId) return null;
  const limits = getEffectiveReferenceLimits(productModelId, mode, context);
  for (const kind of ['image', 'video', 'audio'] as const) {
    const count = referenceKinds.filter(value => value === kind).length;
    const max = limits[kind];
    if (count === 0 || count <= max) continue;
    const label = kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频';
    return max === 0 ? `当前 Provider 线路不接收 @${label} 参考` : `当前 Provider 线路最多接收 ${max} 个 @${label} 参考`;
  }
  return null;
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

export function suggestProductRouteMappings(key: UserApiKey): RouteMappingBinding[] {
  if (keyModels(key).length === 0) return [];
  if (key.provider === 'runningHub') {
    const filter = keyModels(key).map(normalize);
    const filterSet = filter.length ? new Set(filter) : null;
    return RUNNINGHUB_ROUTE_SEED
      .filter(seed => !filterSet || filterSet.has(normalize(seed.routeId)))
      .filter(seed => keySupportsProduct(key, byId.get(seed.productModelId)!))
      .map(seed => ({ target: { kind: 'product-mode', productModelId: seed.productModelId, mode: seed.mode }, routeId: seed.routeId, order: 0 }));
  }
  const candidates = keyModels(key);
  return PRODUCT_MODEL_CATALOG.filter(model => keySupportsProduct(key, model)).flatMap(model => {
    const ids = [...model.officialModelIds, ...model.aliases].map(normalize);
    const routeId = candidates.find(candidate => ids.includes(normalize(candidate)));
    if (!routeId) return [];
    const modes = model.capability === 'video' ? getRoutedVideoModes(model.id, key.provider, routeId) : model.capabilities.modes;
    return modes.map(mode => ({ target: { kind: 'product-mode', productModelId: model.id, mode }, routeId, order: 0 }));
  });
}

export function resolveProductModelRoute(
  productModelId: string,
  mode: ProductModelMode,
  keys: UserApiKey[],
): { model: ProductModelDefinition; routeId: string; key: UserApiKey } | null {
  const model = byId.get(productModelId);
  if (!model) return null;
  const route = resolveRouteMapping({ kind: 'product-mode', productModelId, mode }, keys);
  return route ? { model, routeId: route.routeId, key: route.key } : null;
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

/**
 * 当前 BYOK 映射下，该视频产品模型实际可切换的生成方式。
 * 逐个 mode 调用 resolveProductModelRoute 解析线路（与提交时按 mode 解析一致），
 * 命中且该线路确实承载该 mode 即视为可选。避免 PromptBar 用单条 activeRoute
 * （仅承载当前 submode）误判其它模式不可用，导致“配了图生视频线路却点不动”。
 */
export function getResolvableVideoModes(productModelId: string, keys: UserApiKey[]): ProductModelMode[] {
  const product = getProductModel(productModelId);
  if (!product || product.capability !== 'video') return [];
  return product.capabilities.modes.filter(mode => {
    const route = resolveProductModelRoute(productModelId, mode, keys);
    return !!route && getRoutedVideoModes(productModelId, route.key.provider, route.routeId).includes(mode);
  });
}

/** 同 getResolvableVideoModes，图片侧：解决文生图线路下图生图按钮点不动的问题。 */
export function getResolvableImageModes(productModelId: string, keys: UserApiKey[]): ProductModelMode[] {
  const product = getProductModel(productModelId);
  if (!product || product.capability !== 'image') return [];
  return product.capabilities.modes.filter(mode => {
    const route = resolveProductModelRoute(productModelId, mode, keys);
    return !!route && getRoutedImageModes(productModelId, route.key.provider, route.routeId).includes(mode);
  });
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
}, context?: ProductRouteContext) {
  const model = getProductModel(productModelId);
  if (!model) return input;
  const requestedMode = input.mode && model.capabilities.modes.includes(input.mode) ? input.mode : model.capabilities.modes[0];
  const capability = getEffectiveProductModelCapabilities(model.id, requestedMode, context) || model.capabilities;
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
