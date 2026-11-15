import type {
  AICapability,
  AIProvider,
  ProductModelMode,
  RouteMappingBinding,
  UserApiKey,
} from '../types';
import type { VideoAspectRatio } from './aiGateway';
import { getRouteCatalog, getRouteDurations, getRouteSchema, type RouteCapabilitySchema } from './runningHubRouteCatalog';
import { familyDisplayName, getRunningHubRoutesVersion, modeFromEndpoint, runningHubDocSite } from './runningHubDynamicRoutes';
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
  /** 参考视频总像素（宽×高）允许范围；未声明则不做前置校验。 */
  referenceVideoPixelRange?: { min: number; max: number };
  // 参考视频时长/体积/宽高比硬限制；未声明则不做前置校验。
  referenceVideoLimits?: ReferenceVideoLimits;
};

export type ReferenceVideoLimits = {
  minDurationSec?: number;
  maxDurationSec?: number;
  maxTotalDurationSec?: number;
  maxBytes?: number;
  minAspectRatio?: number;
  maxAspectRatio?: number;
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

/**
 * Seedance 2.0 参考视频总像素范围（1521 前置校验）。
 * 实测：360×640（230,400）被拒，720×1280（921,600）通过。
 * 区间取火山方舟口径 640×640–834×1112，未找到厂商原文，属推测值（2026-11-02）；拿到原文后在此修正。
 */
const SEEDANCE_2_REFERENCE_VIDEO_PIXELS = { min: 409_600, max: 927_408 };
// 方舟 Seedance 2.0 文档：单段 2–15s、总长 ≤15s、≤200MB、宽高比 0.4–2.5；fps 24–60 节点未记录，无法前置校验。
const SEEDANCE_2_REFERENCE_VIDEO_LIMITS: ReferenceVideoLimits = { minDurationSec: 2, maxDurationSec: 15, maxTotalDurationSec: 15, maxBytes: 209_715_200, minAspectRatio: 0.4, maxAspectRatio: 2.5 };
// RunningHub Seedance 2.5 多模态文档：最多 30 图 + 10 视频 + 10 音频，单段 2–30s，总长 ≤30s。
const SEEDANCE_25_REFERENCE_VIDEO_LIMITS: ReferenceVideoLimits = { ...SEEDANCE_2_REFERENCE_VIDEO_LIMITS, maxDurationSec: 30, maxTotalDurationSec: 30 };

const CAPABILITY_BY_ID: Record<string, ProductModelCapability> = {
  'flovart:gpt-image-2': { ...baseImage, resolutions: ['1K', '2K', '4K'], qualities: ['low', 'medium', 'high'], maxImageReferences: 16 },
  'flovart:gemini-3-pro-image': { ...baseImage, supportsWebSearch: true, maxImageReferences: 14 },
  'flovart:gemini-3.1-flash-image': { ...baseImage, aspectRatios: ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4', '1:4', '4:1', '1:8', '8:1', '21:9', '9:21'], resolutions: ['512', '1K', '2K', '4K'], supportsWebSearch: true, maxImageReferences: 14 },
  'flovart:gemini-3.1-flash-lite-image': { ...baseImage, aspectRatios: ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4'], resolutions: ['512', '1K', '2K'], supportsWebSearch: true, maxImageReferences: 14 },
  'flovart:imagen-4': { ...baseImage, modes: ['text-to-image'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'], resolutions: ['1K', '2K', '4K'], maxImageReferences: 0 },
  'flovart:seedream-5-pro': { ...baseImage, supportsWebSearch: true, supportsRealPersonCheck: true },
  // 模式与参考图上限不在此硬编码：由 RunningHub 官方文档解析出的 seedream-v5-flash 家族线路（文生图 + 图生图，最多 10 张）合并而来。
  'flovart:seedream-5-flash': { ...baseImage, modes: ['text-to-image'], aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'], resolutions: ['1K', '2K'], maxImageReferences: 0 },
  'flovart:seedream-4.5': { ...baseImage, modes: ['text-to-image'], resolutions: ['2K', '4K'], maxImageReferences: 0 },
  'flovart:midjourney-v8-1': { ...baseImage, modes: ['text-to-image'], qualities: ['low', 'medium', 'high'], maxImageReferences: 1 },
  'flovart:seedance-2': { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'], durations: [-1, 4, 5, 6, 8, 10, 12, 15], resolutions: ['480p', '720p', '1080p'], audioControl: 'optional', supportsRealPersonCheck: true, supportsSeed: true, maxImageReferences: 9, maxVideoReferences: 3, maxAudioReferences: 3, referenceVideoPixelRange: SEEDANCE_2_REFERENCE_VIDEO_PIXELS, referenceVideoLimits: SEEDANCE_2_REFERENCE_VIDEO_LIMITS },
  'flovart:seedance-2-fast': { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'reference-to-video'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'], durations: [-1, 4, 5, 6, 8, 10, 12, 15], resolutions: ['480p', '720p'], audioControl: 'optional', supportsRealPersonCheck: true, supportsSeed: true, maxImageReferences: 9, maxVideoReferences: 3, maxAudioReferences: 3, referenceVideoPixelRange: SEEDANCE_2_REFERENCE_VIDEO_PIXELS, referenceVideoLimits: SEEDANCE_2_REFERENCE_VIDEO_LIMITS },
  'flovart:seedance-2.5': { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', 'adaptive'], durations: [-1, ...Array.from({ length: 27 }, (_, i) => i + 4)], resolutions: ['480p', '720p', '1080p'], audioControl: 'optional', supportsRealPersonCheck: true, supportsSeed: true, maxImageReferences: 30, maxVideoReferences: 10, maxAudioReferences: 10, referenceVideoPixelRange: SEEDANCE_2_REFERENCE_VIDEO_PIXELS, referenceVideoLimits: SEEDANCE_25_REFERENCE_VIDEO_LIMITS },
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

const normalize = (value?: string) => value?.trim().toLowerCase() || '';

// ── RunningHub 动态产品卡 ─────────────────────────────────────────────────────
// RunningHub 模型的能力不在前端硬编码：每个模型家族（去掉模式后缀的 endpoint）由官方文档解析出的
// 兄弟线路组成一张产品卡，能力（模式 / 比例 / 分辨率 / 时长 / 参考上限）取线路并集；
// 兜底种子已绑定到静态产品卡的家族（Seedream 5 Flash、Seedance、Veo …）则把线路模式合并进该静态卡。

const KNOWN_RATIOS: VideoAspectRatio[] = ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4', '4:5', '5:4', '1:4', '4:1', '1:8', '8:1', '21:9', '9:21', 'adaptive'];
const MODE_ORDER: ProductModelMode[] = ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-extension'];
const MEDIA_MODES = new Set<ProductModelMode>(['image-to-image', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-extension']);

function routeMediaMax(routes: RouteCapabilitySchema[], kind: 'image' | 'video' | 'audio'): number {
  return routes
    .filter(route => route.modes.some(mode => MEDIA_MODES.has(mode)))
    .reduce((max, route) => Math.max(max, route.media.filter(spec => spec.kind === kind).reduce((sum, spec) => sum + spec.max, 0)), 0);
}

function capabilitiesFromRoutes(capability: 'image' | 'video', routes: RouteCapabilitySchema[]): ProductModelCapability {
  const modes = MODE_ORDER.filter(mode => routes.some(route => route.modes.includes(mode)));
  const ratios = new Set<VideoAspectRatio>();
  for (const route of routes) {
    const sizedByWidthHeight = route.params.some(param => param.field === 'width') && route.params.some(param => param.field === 'height');
    if (route.aspectRatioField && route.aspectRatioValues?.length) {
      route.aspectRatioValues.forEach(value => { if (KNOWN_RATIOS.includes(value as VideoAspectRatio)) ratios.add(value as VideoAspectRatio); });
    } else if (route.aspectRatioField || (capability === 'image' && sizedByWidthHeight)) {
      (capability === 'image' ? IMAGE_RATIOS : VIDEO_RATIOS).forEach(value => ratios.add(value));
    }
  }
  const resolutions: string[] = [];
  for (const route of routes) {
    for (const value of route.resolutionValues || (route.resolutionDefault ? [route.resolutionDefault] : [])) {
      if (!resolutions.some(existing => normalize(existing) === normalize(value))) resolutions.push(value);
    }
  }
  const durations = [...new Set(routes.flatMap(route => getRouteDurations(route.routeId) || []))].sort((a, b) => a - b);
  const fields = new Set(routes.flatMap(route => route.params.map(param => param.field)));
  return {
    modes,
    aspectRatios: [...ratios],
    resolutions,
    durations,
    qualities: [],
    counts: [1],
    audioControl: capability === 'video' && fields.has('generateAudio') ? 'optional' : 'none',
    supportsWebSearch: fields.has('webSearch'),
    supportsRealPersonCheck: fields.has('realPersonMode'),
    supportsSeed: fields.has('seed'),
    maxImageReferences: routeMediaMax(routes, 'image'),
    maxVideoReferences: routeMediaMax(routes, 'video'),
    maxAudioReferences: routeMediaMax(routes, 'audio'),
  };
}

function shortLabel(name: string): string {
  return name.length <= 16 ? name : `${name.slice(0, 15)}…`;
}

type ProductRegistry = { version: number; dynamic: ProductModelDefinition[]; byId: Map<string, ProductModelDefinition>; all: ProductModelDefinition[] };
let registryMemo: ProductRegistry | null = null;

function productRegistry(): ProductRegistry {
  const version = getRunningHubRoutesVersion();
  if (registryMemo?.version === version) return registryMemo;
  const routesByProduct = new Map<string, RouteCapabilitySchema[]>();
  for (const route of getRouteCatalog()) {
    routesByProduct.set(route.productModelId, [...(routesByProduct.get(route.productModelId) || []), route]);
  }
  // 静态卡：合并家族线路的模式与参考上限（不改动比例 / 分辨率等产品级选项，线路级限制由 getEffectiveProductModelCapabilities 收窄）。
  const statics = PRODUCT_MODEL_CATALOG.map(model => {
    const routes = routesByProduct.get(model.id);
    if (!routes?.length) return model;
    const modes = MODE_ORDER.filter(mode => model.capabilities.modes.includes(mode) || routes.some(route => route.modes.includes(mode) && (MODE_ORDER.indexOf(mode) < 2) === (model.capability === 'image')));
    const maxImageReferences = Math.max(model.capabilities.maxImageReferences, routeMediaMax(routes, 'image'));
    const maxVideoReferences = Math.max(model.capabilities.maxVideoReferences, routeMediaMax(routes, 'video'));
    const maxAudioReferences = Math.max(model.capabilities.maxAudioReferences, routeMediaMax(routes, 'audio'));
    const unchanged = modes.length === model.capabilities.modes.length
      && maxImageReferences === model.capabilities.maxImageReferences
      && maxVideoReferences === model.capabilities.maxVideoReferences
      && maxAudioReferences === model.capabilities.maxAudioReferences;
    return unchanged ? model : { ...model, capabilities: { ...model.capabilities, modes, maxImageReferences, maxVideoReferences, maxAudioReferences } };
  });
  const dynamic: ProductModelDefinition[] = [];
  for (const [productModelId, routes] of routesByProduct) {
    if (!productModelId.startsWith('rh:')) continue;
    const capability = routes[0].capability || (routes[0].modes.some(mode => mode === 'text-to-image' || mode === 'image-to-image') ? 'image' : 'video');
    const family = routes[0].family || productModelId.slice(3).replace(/@(image|video)$/, '');
    const name = familyDisplayName(routes.map(route => route.title || ''), family);
    dynamic.push({
      id: productModelId,
      name,
      shortName: shortLabel(name),
      company: routes.find(route => route.vendor)?.vendor || 'RunningHub',
      capability,
      provider: 'runningHub',
      officialModelIds: [],
      aliases: [family, ...routes.map(route => route.routeId)],
      badge: 'RunningHub',
      status: 'available',
      description: routes.find(route => route.description)?.description || `RunningHub ${family}`,
      capabilities: capabilitiesFromRoutes(capability, routes),
    });
  }
  const all = [...statics, ...dynamic];
  registryMemo = { version, dynamic, byId: new Map(all.map(model => [model.id, model])), all };
  return registryMemo;
}

/** 从 RunningHub 官方文档动态生成的产品卡（rh:<family>）。 */
export function getDynamicProductModels(capability?: 'image' | 'video'): ProductModelDefinition[] {
  const { dynamic } = productRegistry();
  return capability ? dynamic.filter(model => model.capability === capability) : dynamic;
}

export function getProductModel(value?: string | null): ProductModelDefinition | undefined {
  if (!value) return undefined;
  const registry = productRegistry();
  const direct = registry.byId.get(value);
  if (direct) return direct;
  const normalized = normalize(value);
  return registry.all.find(model => [...model.officialModelIds, ...model.aliases].some(id => normalize(id) === normalized));
}

export function getProductModels(capability: 'image' | 'video'): ProductModelDefinition[] {
  return productRegistry().all.filter(model => model.capability === capability);
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
      const schema = getRouteSchema(routeId);
      if (schema) return schema.modes;
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
    if (provider === 'openai_compatible' || provider === 'openai' || provider === 'custom') return ['text-to-image', 'image-to-image'];
    if (provider === 'google') return ['text-to-image', 'image-to-image'];
    if (provider === 'runningHub') {
      const schema = getRouteSchema(routeId);
      if (schema) return schema.modes;
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
    const sizedByWidthHeight = schema.params.some(param => param.field === 'width') && schema.params.some(param => param.field === 'height');
    // 只收 width/height 的线路（Seedream）由网关按比例换算宽高，比例选项沿用产品能力。
    const routeRatios = schema.aspectRatioField === null
      ? (sizedByWidthHeight ? base.aspectRatios : [])
      : (schema.aspectRatioValues?.filter((value): value is VideoAspectRatio => base.aspectRatios.includes(value as VideoAspectRatio)) || base.aspectRatios);
    const routeDurations = getRouteDurations(schema.routeId);
    const routeFields = new Set(schema.params.map(param => param.field));
    const routeResolutions = schema.resolutionValues?.length
      ? base.resolutions.filter(value => schema.resolutionValues!.some(option => normalize(option) === normalize(value)))
      : [];
    return {
      ...base,
      aspectRatios: [...routeRatios],
      resolutions: routeResolutions.length ? routeResolutions : [...base.resolutions],
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

/** 参考视频总像素允许范围；undefined 表示该产品未声明，不做前置校验。 */
export function getReferenceVideoPixelRange(productModelId: string): { min: number; max: number } | undefined {
  const range = getProductModel(productModelId)?.capabilities.referenceVideoPixelRange;
  return range ? { ...range } : undefined;
}

// 参考视频时长/体积/宽高比硬限制；undefined 表示该产品未声明，不做前置校验。
export function getReferenceVideoLimits(productModelId: string): ReferenceVideoLimits | undefined {
  const limits = getProductModel(productModelId)?.capabilities.referenceVideoLimits;
  return limits ? { ...limits } : undefined;
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
    return max === 0 ? `当前 AI 服务不接收 @${label} 参考` : `当前 AI 服务最多接收 ${max} 个 @${label} 参考`;
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

/** RunningHub 线路排序：模式词与 endpoint 一致、且该模式是线路主模式的优先（避免多模式线路抢占专用线路）。 */
function runningHubRouteRank(route: RouteCapabilitySchema, mode: ProductModelMode): number {
  return (route.modes[0] === mode ? 0 : 2) + (modeFromEndpoint(route.routeId) ? 0 : 1);
}

export function suggestProductRouteMappings(key: UserApiKey): RouteMappingBinding[] {
  if (keyModels(key).length === 0) return [];
  if (key.provider === 'runningHub') {
    const filterSet = new Set(keyModels(key).map(normalize));
    const site = runningHubDocSite(key.baseUrl);
    const catalog = getRouteCatalog();
    // 兜底种子线路沿用旧规则（出现在服务模型列表里，或同一产品的兄弟线路）；
    // 官方文档解析出的线路随「获取模型」同步，同站点全部自动映射，用户无需逐条配置。
    const exposedProducts = new Set(catalog.filter(route => filterSet.has(normalize(route.routeId))).map(route => route.productModelId));
    const eligible = catalog.filter(route => route.source === 'docs'
      ? !route.site || route.site === site
      : filterSet.has(normalize(route.routeId)) || exposedProducts.has(route.productModelId));
    const best = new Map<string, { route: RouteCapabilitySchema; rank: number; mode: ProductModelMode }>();
    for (const route of eligible) {
      const product = getProductModel(route.productModelId);
      if (!product || product.id !== route.productModelId || !keySupportsProduct(key, product)) continue;
      for (const mode of route.modes) {
        if (!product.capabilities.modes.includes(mode)) continue;
        const target = `${route.productModelId}|${mode}`;
        const rank = runningHubRouteRank(route, mode);
        const current = best.get(target);
        if (!current || rank < current.rank) best.set(target, { route, rank, mode });
      }
    }
    return [...best.values()].map(({ route, mode }) => ({ target: { kind: 'product-mode', productModelId: route.productModelId, mode }, routeId: route.routeId, order: 0 }));
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
  const model = getProductModel(productModelId);
  if (!model || model.id !== productModelId) return null;
  const route = resolveRouteMapping({ kind: 'product-mode', productModelId, mode }, keys);
  return route ? { model, routeId: route.routeId, key: route.key } : null;
}

export function resolveAnyProductRoute(
  productModelId: string,
  keys: UserApiKey[],
): { model: ProductModelDefinition; routeId: string; key: UserApiKey; mode: ProductModelMode } | null {
  const model = getProductModel(productModelId);
  if (!model || model.id !== productModelId) return null;
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

// 不在产品目录里的模型（旧节点遗留 id、自定义模型）使用通用参数；参数面板和请求清洗共用这一份，实际支持以供应商为准。
export const GENERIC_IMAGE_CAPABILITIES: ProductModelCapability = {
  modes: ['text-to-image', 'image-to-image'], aspectRatios: ['1:1', '3:2', '2:3', '16:9', '9:16', '4:3', '3:4'], resolutions: ['1K', '2K', '4K'], durations: [], qualities: ['low', 'medium', 'high'], counts: [1, 2, 4],
  audioControl: 'none', supportsWebSearch: false, supportsRealPersonCheck: false, supportsSeed: false, maxImageReferences: 8, maxVideoReferences: 0, maxAudioReferences: 0,
};
export const GENERIC_VIDEO_CAPABILITIES: ProductModelCapability = {
  modes: ['text-to-video', 'image-to-video'], aspectRatios: ['16:9', '9:16'], resolutions: ['720p', '1080p'], durations: [4, 6, 8], qualities: [], counts: [1],
  audioControl: 'none', supportsWebSearch: false, supportsRealPersonCheck: false, supportsSeed: false, maxImageReferences: 1, maxVideoReferences: 0, maxAudioReferences: 0,
};

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
  // 非目录模型按媒体类型套用通用能力清洗；目录模型忽略。
  mediaType?: 'image' | 'video';
}, context?: ProductRouteContext) {
  const model = getProductModel(productModelId);
  if (!model) {
    // 非目录模型：只清洗明显不属于该媒体类型的值（图片残留 720p、时长 -1/0），其余原样交给供应商。
    if (!input.mediaType) return input;
    const generic = input.mediaType === 'video' ? GENERIC_VIDEO_CAPABILITIES : GENERIC_IMAGE_CAPABILITIES;
    const resolution = generic.resolutions.find(value => value.toLowerCase() === input.resolution?.toLowerCase())
      || generic.resolutions.find(value => value.toLowerCase() === (input.mediaType === 'video' ? '720p' : '1k'));
    const durationSec = input.mediaType === 'video' && input.durationSec !== undefined && input.durationSec > 0 ? input.durationSec : undefined;
    return { ...input, resolution, durationSec, generateAudio: input.mediaType === 'video' ? input.generateAudio : undefined };
  }
  const requestedMode = input.mode && model.capabilities.modes.includes(input.mode) ? input.mode : model.capabilities.modes[0];
  const capability = getEffectiveProductModelCapabilities(model.id, requestedMode, context) || model.capabilities;
  const mode = input.mode === 'video-extension' && model.id.startsWith('flovart:veo-3.1')
    ? input.mode
    : input.mode && capability.modes.includes(input.mode) ? input.mode : capability.modes[0];
  const aspectRatio = input.aspectRatio && capability.aspectRatios.includes(input.aspectRatio) ? input.aspectRatio : capability.aspectRatios[0];
  const resolution = capability.resolutions.find(value => value.toLowerCase() === input.resolution?.toLowerCase())
    || capability.resolutions.find(value => value.toLowerCase() === (model.capability === 'video' ? '720p' : '1k'))
    || capability.resolutions[0];
  const quality = capability.qualities.includes(input.quality || '')
    ? input.quality
    : capability.qualities.includes('high') ? 'high' : capability.qualities[0];
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
