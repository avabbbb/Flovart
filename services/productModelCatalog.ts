import type {
  AICapability,
  AIProvider,
  ProductModelMapping,
  ProductModelMode,
  UserApiKey,
} from '../types';
import type { VideoAspectRatio } from './aiGateway';

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

export const PRODUCT_MODEL_CATALOG: ProductModelDefinition[] = [
  {
    id: 'flovart:gpt-image-2', name: 'GPT Image 2', shortName: 'GPT', company: 'OpenAI', capability: 'image', provider: 'openai',
    officialModelIds: ['gpt-image-2'], aliases: ['gpt-image-2-2026-04-21'], status: 'available', badge: '文字精准',
    description: '高质量图片生成与编辑',
    capabilities: { ...baseImage, resolutions: ['1K', '2K', '4K'], qualities: ['low', 'medium', 'high'], maxImageReferences: 16 },
  },
  {
    id: 'flovart:gemini-3-pro-image', name: 'Gemini 3 Pro Image', shortName: 'NB Pro', company: 'Google', capability: 'image', provider: 'google',
    officialModelIds: ['gemini-3-pro-image'], aliases: [], status: 'available', badge: '设计推理',
    description: 'Nano Banana Pro，适合专业设计资产',
    capabilities: { ...baseImage, supportsWebSearch: true, maxImageReferences: 14 },
  },
  {
    id: 'flovart:seedream-5-pro', name: 'Seedream 5.0 Pro', shortName: 'S5 Pro', company: 'ByteDance', capability: 'image', provider: 'volcengine',
    officialModelIds: [], aliases: ['seedream-5.0-pro', 'doubao-seedream-5.0-pro'], status: 'mapping-required', badge: '待映射',
    description: '官方产品已发布，API 模型 ID 由用户映射',
    capabilities: { ...baseImage, supportsWebSearch: true, supportsRealPersonCheck: true },
  },
  {
    id: 'flovart:seedance-2', name: 'Seedance 2.0', shortName: 'S2', company: 'ByteDance', capability: 'video', provider: 'volcengine',
    officialModelIds: ['doubao-seedance-2-0-260128'], aliases: ['dreamina-seedance-2-0-260128', 'doubao-seedance-2.0', 'seedance-2.0'], status: 'available', badge: '多模态',
    description: '图文音视频统一参考，任务提交后不自动切线',
    capabilities: { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'], durations: [-1, 4, 5, 6, 8, 10, 12, 15], resolutions: ['480p', '720p', '1080p'], audioControl: 'optional', supportsRealPersonCheck: true, supportsSeed: true, maxImageReferences: 9, maxVideoReferences: 3, maxAudioReferences: 3 },
  },
  {
    id: 'flovart:seedance-2-fast', name: 'Seedance 2.0 Fast', shortName: 'S2 Fast', company: 'ByteDance', capability: 'video', provider: 'volcengine',
    officialModelIds: ['doubao-seedance-2-0-fast-260128'], aliases: [], status: 'available', badge: '快速',
    description: '快速版本，独立能力与价格线路',
    capabilities: { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'reference-to-video'], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'], durations: [-1, 4, 5, 6, 8, 10, 12, 15], resolutions: ['480p', '720p'], audioControl: 'optional', supportsRealPersonCheck: true, supportsSeed: true, maxImageReferences: 9, maxVideoReferences: 3, maxAudioReferences: 3 },
  },
  {
    id: 'flovart:veo-3.1', name: 'Veo 3.1', shortName: 'Veo', company: 'Google', capability: 'video', provider: 'google',
    officialModelIds: ['veo-3.1-generate-preview'], aliases: [], status: 'available', badge: '电影感',
    description: '支持首尾帧与最多 3 张参考图',
    capabilities: { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame'], resolutions: ['720p', '1080p', '4K'], maxImageReferences: 3, supportsSeed: true },
  },
  {
    id: 'flovart:veo-3.1-fast', name: 'Veo 3.1 Fast', shortName: 'Veo Fast', company: 'Google', capability: 'video', provider: 'google',
    officialModelIds: ['veo-3.1-fast-generate-preview'], aliases: [], status: 'available', badge: '快速',
    description: '更快的 Veo 3.1 线路',
    capabilities: { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame'], resolutions: ['720p', '1080p', '4K'], maxImageReferences: 3, supportsSeed: true },
  },
  {
    id: 'flovart:veo-3.1-lite', name: 'Veo 3.1 Lite', shortName: 'Veo Lite', company: 'Google', capability: 'video', provider: 'google',
    officialModelIds: ['veo-3.1-lite-generate-preview'], aliases: [], status: 'available', badge: '经济',
    description: '轻量线路，不显示 4K 与参考图模式', capabilities: { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'first-last-frame'], supportsSeed: true },
  },
  {
    id: 'flovart:kling-video-3', name: 'Kling VIDEO 3.0', shortName: 'Kling 3', company: 'Kuaishou', capability: 'video', provider: 'keling',
    officialModelIds: [], aliases: ['kling-video-3.0', 'kling-v3'], status: 'mapping-required', badge: '待映射',
    description: '公开产品能力已确认，API ID 由用户映射',
    capabilities: { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'first-last-frame'], durations: [3, 5, 10, 15], audioControl: 'optional' },
  },
  {
    id: 'flovart:kling-video-3-omni', name: 'Kling VIDEO 3.0 Omni', shortName: 'Kling Omni', company: 'Kuaishou', capability: 'video', provider: 'keling',
    officialModelIds: [], aliases: ['kling-video-3.0-omni', 'kling-v3-omni'], status: 'mapping-required', badge: '全能参考',
    description: '多模态参考与多镜头版本',
    capabilities: { ...baseVideo, modes: ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame'], durations: [3, 5, 10, 15], audioControl: 'optional', maxImageReferences: 4, maxVideoReferences: 1, maxAudioReferences: 1 },
  },
];

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

function keyModels(key: UserApiKey): string[] {
  return Array.from(new Set([
    key.defaultModel,
    ...(key.models || []).map(model => model.id),
    ...(key.customModels || []),
  ].filter((value): value is string => Boolean(value?.trim()))));
}

export function suggestProductModelMappings(key: UserApiKey): ProductModelMapping[] {
  const candidates = keyModels(key);
  return PRODUCT_MODEL_CATALOG.flatMap(model => {
    const ids = [...model.officialModelIds, ...model.aliases].map(normalize);
    const upstreamModelId = candidates.find(candidate => ids.includes(normalize(candidate)));
    if (!upstreamModelId) return [];
    return [{ productModelId: model.id, upstreamModelId, priority: 0, enabled: false, confirmed: false }];
  });
}

export function mergeSuggestedMappings(key: UserApiKey): ProductModelMapping[] {
  const existing = key.modelMappings || [];
  const existingIds = new Set(existing.map(mapping => mapping.productModelId));
  return [...existing, ...suggestProductModelMappings(key).filter(mapping => !existingIds.has(mapping.productModelId))];
}

export function resolveProductModelRoute(productModelId: string, keys: UserApiKey[]): { model: ProductModelDefinition; upstreamModelId: string; key: UserApiKey } | null {
  const model = byId.get(productModelId);
  if (!model) return null;
  const routes = keys
    .filter(key => key.status !== 'error')
    .flatMap(key => (key.modelMappings || []).filter(mapping => mapping.productModelId === productModelId && mapping.enabled && mapping.confirmed).map(mapping => ({ key, mapping })))
    .sort((left, right) => left.mapping.priority - right.mapping.priority);
  const route = routes[0];
  return route ? { model, upstreamModelId: route.mapping.upstreamModelId, key: route.key } : null;
}

export function isProductModelConfigured(productModelId: string, keys: UserApiKey[]): boolean {
  return Boolean(resolveProductModelRoute(productModelId, keys));
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
  const aspectRatio = input.aspectRatio && capability.aspectRatios.includes(input.aspectRatio) ? input.aspectRatio : capability.aspectRatios[0];
  const resolution = capability.resolutions.find(value => value.toLowerCase() === input.resolution?.toLowerCase())
    || capability.resolutions.find(value => value.toLowerCase() === (model.capability === 'video' ? '720p' : '1k'))
    || capability.resolutions[0];
  const quality = capability.qualities.includes(input.quality || '') ? input.quality : capability.qualities[0];
  let durationSec = input.durationSec !== undefined && capability.durations.includes(input.durationSec) ? input.durationSec : capability.durations.find(value => value > 0);
  if (model.id.startsWith('flovart:veo-3.1')) {
    const constrainedMode = input.mode === 'reference-to-video' || input.mode === 'video-extension';
    if ((resolution && resolution.toLowerCase() !== '720p') || constrainedMode) durationSec = 8;
    if (input.mode === 'video-extension') return {
      aspectRatio, resolution: '720p', quality, durationSec: 8, count: 1, generateAudio: true,
      webSearch: undefined, realPersonCheck: undefined,
    };
  }
  const count = capability.counts.includes(input.count || 1) ? input.count || 1 : capability.counts[0];
  return {
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
