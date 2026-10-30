import type { GenerationMode, ProductModelMode, UserApiKey } from '../types';
import { PROVIDER_LABELS, type VideoAspectRatio } from './aiGateway';
import type { ImageReferenceChip } from '../components/workflow/references';
import {
  getProductModel,
  getProductModels,
  getEffectiveProductModelCapabilities,
  getEffectiveReferenceLimits,
  explainReferenceCompatibility,
  getResolvableVideoModes,
  getResolvableImageModes,
  explainUnsupportedVideoMode,
  explainUnsupportedImageMode,
  isProductModelConfigured,
  resolveProductModelRoute,
  resolveAnyProductRoute,
  sanitizeProductGenerationParams,
  GENERIC_IMAGE_CAPABILITIES,
  GENERIC_VIDEO_CAPABILITIES,
} from './productModelCatalog';
import { estimateApiCost } from '../utils/usageMonitor';
import { resolveRouteMapping } from './routeMapping';
import { modelRefLabel, modelRefModelId, modelRefProvider } from '../utils/modelRefs';
import type { ProductModelCapability } from './productModelCatalog';

export type { VideoAspectRatio } from './aiGateway';

export const PROMPT_VIDEO_MODE_ORDER: ProductModelMode[] = ['text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-extension'];
export const PROMPT_IMAGE_MODE_ORDER: ProductModelMode[] = ['text-to-image', 'image-to-image'];

export function promptProductModeLabel(mode: ProductModelMode) {
  const labels: Record<ProductModelMode, string> = {
    'text-to-image': '文生图',
    'image-to-image': '图生图',
    'text-to-video': '文生视频',
    'image-to-video': '图生视频',
    'reference-to-video': '全能参考',
    'first-last-frame': '首尾帧',
    'video-extension': '视频扩展',
  };
  return labels[mode];
}

// 不在产品目录里的模型（旧节点遗留 id、自定义模型）使用通用参数，保证参数面板始终可用；实际支持以供应商为准。

function productFamily(model: ReturnType<typeof getProductModels>[number]): string {
  if (model.id.includes('seedance')) return 'Seedance';
  if (model.id.includes('seedream')) return 'Seedream';
  if (model.id.includes('kling')) return 'Kling';
  if (model.id.includes('veo')) return 'Veo';
  if (model.id.includes('gpt-image')) return 'GPT Image';
  if (model.id.includes('gemini')) return 'Gemini Image';
  return model.company;
}

export function promptModelLabel(mode: GenerationMode, textModel?: string, imageModel?: string, videoModel?: string, userApiKeys: UserApiKey[] = []) {
  if (mode === 'text') return '文本映射';
  const model = mode === 'video' || mode === 'keyframe' ? videoModel : imageModel;
  // 未选模型返回空串，由 UI 按当前语言显示占位文案
  if (!model) return '';
  const product = getProductModel(model);
  if (product) return product.name;
  const provider = modelRefProvider(model, userApiKeys);
  const shortProvider = PROVIDER_LABELS[provider]?.split(' ')[0] || provider;
  return `${shortProvider} · ${modelRefModelId(model).replace(/^(google|openai|anthropic|openrouter)\//, '')}`;
}

export function createPromptBarGenerationPolicy(input: {
  generationMode: GenerationMode;
  selectedTextModel?: string;
  selectedImageModel?: string;
  selectedVideoModel?: string;
  textModelOptions: string[];
  imageModelOptions: string[];
  videoModelOptions: string[];
  userApiKeys: UserApiKey[];
  generationSubmode?: ProductModelMode;
  imageReferenceChips?: ImageReferenceChip[];
  modelCapabilityFilter: ProductModelMode | 'all';
  activeModelFamily: string;
  generationQuality?: string;
  videoResolution?: string;
  activeRatio: VideoAspectRatio;
  videoDurationSec?: number;
  batchCount: number;
  preserveReferenceAspectRatio?: boolean;
}) {
  const videoLikeMode = input.generationMode === 'video' || input.generationMode === 'keyframe';
  const activeModel = input.generationMode === 'text' ? input.selectedTextModel : videoLikeMode ? input.selectedVideoModel : input.selectedImageModel;
  // Key 自定义模型以 model ref（含 keyId / provider 前缀）保存；按底层模型 id 回落匹配产品模型，否则尺寸/比例/时长面板会整体消失。
  const rawModelId = activeModel ? modelRefModelId(activeModel) : '';
  const activeProductModel = getProductModel(activeModel)
    || getProductModel(rawModelId)
    || getProductModel(rawModelId.split('/').pop());
  const activeSubmode = input.generationSubmode || (input.generationMode === 'video' ? 'text-to-video' : 'text-to-image');
  const activeRoute = activeProductModel
    ? resolveProductModelRoute(activeProductModel.id, activeSubmode, input.userApiKeys)
    : input.generationMode === 'text'
      ? resolveRouteMapping({ kind: 'runtime-capability', capability: 'agent-text' }, input.userApiKeys)
      : null;
  const activeRouteContext = { provider: activeRoute?.key.provider, routeId: activeRoute?.routeId };
  const activeCapabilities = activeProductModel
    ? getEffectiveProductModelCapabilities(activeProductModel.id, activeSubmode, activeRouteContext)
    : input.generationMode === 'text' ? undefined : videoLikeMode ? GENERIC_VIDEO_CAPABILITIES : GENERIC_IMAGE_CAPABILITIES;
  const productModels = input.generationMode === 'text' ? [] : getProductModels(videoLikeMode ? 'video' : 'image');
  const productModelGroups = [...productModels.reduce((groups, product) => {
    const family = productFamily(product);
    groups.set(family, [...(groups.get(family) || []), product]);
    return groups;
  }, new Map<string, typeof productModels>())].map(([family, models]) => ({ family, company: models[0]?.company || '', models }));
  const modelCapabilityFilters = [...new Set(productModels.flatMap(product => product.capabilities.modes))];
  const filteredProductModelGroups = productModelGroups
    .map(group => ({ ...group, models: group.models.filter(product => input.modelCapabilityFilter === 'all' || product.capabilities.modes.includes(input.modelCapabilityFilter)) }))
    .filter(group => group.models.length > 0);
  const displayedModelGroup = filteredProductModelGroups.find(group => group.family === input.activeModelFamily) || filteredProductModelGroups[0];
  // 未选模型时存储值可能是视频默认 720p；显示/摘要用能力范围内的有效值，不回写状态（回写会产生 undo 历史）
  const resolutionOptions = activeCapabilities?.resolutions || [];
  const effectiveResolution = resolutionOptions.length === 0 ? undefined
    : resolutionOptions.find(value => value.toLowerCase() === input.videoResolution?.toLowerCase())
      || resolutionOptions.find(value => value.toLowerCase() === (videoLikeMode ? '720p' : '1k'))
      || resolutionOptions[0];
  // LibTV 式摘要：比例 · 分辨率 · 画质 · 时长 · 数量，例如 16:9 · 720P · 7s · 1个
  const paramSummary = !activeCapabilities ? '' : [
    activeCapabilities.aspectRatios.length > 0 && input.activeRatio ? (input.preserveReferenceAspectRatio ? '原比例' : input.activeRatio === 'adaptive' ? '自适应' : input.activeRatio) : undefined,
    effectiveResolution,
    !videoLikeMode && activeCapabilities.qualities.length > 0 && input.generationQuality ? (input.generationQuality === 'low' ? '低画面' : input.generationQuality === 'medium' ? '标准' : '高画面') : undefined,
    input.generationMode === 'video' && activeCapabilities.durations.length > 0 ? (input.videoDurationSec === -1 ? '无限时' : input.videoDurationSec + 's') : undefined,
    String(input.batchCount) + (videoLikeMode ? '个' : '张'),
  ].filter(Boolean).join(' · ');
  const isSeedanceVideoModel = videoLikeMode && !!input.selectedVideoModel && modelRefModelId(input.selectedVideoModel).toLowerCase().includes('seedance') || activeProductModel?.id.includes('seedance') === true;
  const isSeedanceFastModel = isSeedanceVideoModel && modelRefModelId(input.selectedVideoModel).toLowerCase().includes('fast');
  const routedVideoModes = activeProductModel?.capability === 'video' ? getResolvableVideoModes(activeProductModel.id, input.userApiKeys) : [];
  const routedImageModes = activeProductModel?.capability === 'image' ? getResolvableImageModes(activeProductModel.id, input.userApiKeys) : [];
  const activeKey = activeRoute?.key || input.userApiKeys.find(key => key.isDefault) || input.userApiKeys[0];
  const estimatedCost = activeRoute && activeProductModel ? estimateApiCost({
    key: activeRoute.key,
    productModelId: activeProductModel.id,
    routeId: activeRoute.routeId,
    type: activeProductModel.capability,
    durationSec: input.generationMode === 'video' ? input.videoDurationSec : undefined,
    count: input.batchCount,
    resolution: input.videoResolution,
    quality: input.generationQuality,
  }) : null;
  const estimatedCostLabel = estimatedCost
    ? `${estimatedCost.currency === 'CNY' ? '¥' : '$'}${estimatedCost.amount < 1 ? estimatedCost.amount.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : estimatedCost.amount.toFixed(2)}`
    : null;
  const mentionedReferences = input.imageReferenceChips?.filter(reference => reference.mentioned) || [];
  const mentionedImageCount = mentionedReferences.filter(reference => reference.elementType === 'image').length;
  const effectiveReferenceLimits = activeProductModel
    ? getEffectiveReferenceLimits(activeProductModel.id, activeSubmode, activeRouteContext)
    : { image: 0, video: 0, audio: 0 };
  const referenceCompatibilityIssue = input.generationMode === 'video'
    ? explainReferenceCompatibility(activeProductModel?.id, activeSubmode, mentionedReferences.map(reference => reference.elementType), activeRouteContext)
    : null;
  const videoInputRequirement = input.generationMode !== 'video' ? null
    : activeSubmode === 'image-to-video' && mentionedImageCount < 1 ? '图生视频需要添加 1 张图片'
      : activeSubmode === 'first-last-frame' && mentionedImageCount < 2 ? '首尾帧需要按顺序添加 2 张图片'
        : activeSubmode === 'reference-to-video' && mentionedReferences.length < 1 ? '全能参考需要添加至少 1 个素材'
          : referenceCompatibilityIssue;
  const paramDisabledReason = (kind: 'resolution' | 'aspectRatio' | 'durationSec', value: string | number): string | null => {
    if (!activeProductModel) {
      if (!activeCapabilities) return '请先选择模型';
      const options: readonly (string | number)[] = kind === 'resolution' ? activeCapabilities.resolutions : kind === 'aspectRatio' ? activeCapabilities.aspectRatios : activeCapabilities.durations;
      return options.includes(value) ? null : '当前模式下此选项不可用';
    }
    const base: { mode: ProductModelMode; aspectRatio?: VideoAspectRatio; resolution?: string; durationSec?: number } = { mode: activeSubmode };
    if (kind === 'aspectRatio') base.aspectRatio = value as VideoAspectRatio; else base.aspectRatio = input.activeRatio;
    if (kind === 'resolution') base.resolution = String(value); else base.resolution = input.videoResolution;
    if (kind === 'durationSec') base.durationSec = Number(value); else base.durationSec = input.videoDurationSec;
    const probe = sanitizeProductGenerationParams(activeProductModel.id, base, activeRouteContext);
    return (probe[kind] as string | number) === value ? null : '当前模式下此选项不可用';
  };
  return {
    videoLikeMode, activeModel, activeProductModel, activeSubmode, activeRoute, activeRouteContext, activeCapabilities,
    productModels, productModelGroups, modelCapabilityFilters, filteredProductModelGroups, displayedModelGroup,
    paramSummary, effectiveResolution, isSeedanceVideoModel, isSeedanceFastModel, routedVideoModes, routedImageModes, activeKey,
    estimatedCostLabel, mentionedReferences, mentionedImageCount, effectiveReferenceLimits, referenceCompatibilityIssue,
    videoInputRequirement, paramDisabledReason, usesGenericCapabilities: !activeProductModel && !!activeCapabilities,
    currentModelOptions: input.generationMode === 'text' ? input.textModelOptions : videoLikeMode ? input.videoModelOptions : input.imageModelOptions,
    isProductModelConfigured: (modelId: string) => isProductModelConfigured(modelId, input.userApiKeys),
    resolveAnyProductRoute: (modelId: string) => resolveAnyProductRoute(modelId, input.userApiKeys),
    modelLabel: (model: string) => modelRefLabel(model, input.userApiKeys),
    explainUnsupportedVideoMode: (mode: ProductModelMode) => activeProductModel ? explainUnsupportedVideoMode(activeProductModel.id, mode) : undefined,
    explainUnsupportedImageMode: (mode: ProductModelMode) => activeProductModel ? explainUnsupportedImageMode(activeProductModel.id, mode) : undefined,
    sanitizeParameters: (mode: ProductModelMode, aspectRatio: VideoAspectRatio, resolution?: string, durationSec?: number) => activeProductModel
      ? sanitizeProductGenerationParams(activeProductModel.id, { mode, aspectRatio, resolution, durationSec }, activeRouteContext)
      : {},
    modelLabelForMode: () => promptModelLabel(input.generationMode, input.selectedTextModel, input.selectedImageModel, input.selectedVideoModel, input.userApiKeys),
  };
}
