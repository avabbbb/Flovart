import type { AIProvider, ProductModelMode } from '../types';
import type {
  CanonicalGenerationInput,
  WorkflowGenerationCapability,
} from '../components/workflow/inputResolver';
import type {
  WorkflowArtifactRef,
  WorkflowGenerationReferenceRole,
} from '../components/workflow/types';
import {
  getEffectiveReferenceLimits,
  getProductModel,
  getReferenceVideoPixelRange,
  getReferenceVideoLimits,
  type ReferenceVideoLimits,
  getRoutedImageModes,
  getRoutedVideoModes,
} from './productModelCatalog';

export type ProviderReferenceKind = 'image' | 'video' | 'audio';

export interface ProviderAdapterContext {
  provider: AIProvider;
  routeId: string;
  productModelId?: string;
}

export interface ProviderPixelRange {
  /** 总像素（宽×高）下限，含。 */
  min?: number;
  /** 总像素（宽×高）上限，含。 */
  max?: number;
}

export interface ProviderCapabilities {
  provider: AIProvider;
  routeId: string;
  productModelId?: string;
  supportedCapabilities: readonly WorkflowGenerationCapability[];
  supportedReferenceKinds: readonly ProviderReferenceKind[];
  supportedReferenceRoles: readonly WorkflowGenerationReferenceRole[];
  maxReferences: Record<ProviderReferenceKind, number>;
  /** 参考媒体总像素范围；未声明的类型不做前置校验。 */
  referencePixelRange?: Partial<Record<ProviderReferenceKind, ProviderPixelRange>>;
  // 参考视频时长/体积/宽高比硬限制；未声明则不做前置校验。
  referenceVideoLimits?: ReferenceVideoLimits;
}

export type ProviderValidationCode =
  | 'UNSUPPORTED_CAPABILITY'
  | 'UNSUPPORTED_REFERENCE_KIND'
  | 'REFERENCE_LIMIT_EXCEEDED'
  | 'UNSUPPORTED_REFERENCE_ROLE'
  | 'MISSING_REFERENCE'
  | 'REFERENCE_RESOLUTION_OUT_OF_RANGE'
  | 'REFERENCE_DURATION_OUT_OF_RANGE'
  | 'REFERENCE_TOTAL_DURATION_EXCEEDED'
  | 'REFERENCE_FILE_TOO_LARGE'
  | 'REFERENCE_ASPECT_OUT_OF_RANGE';

export interface ProviderValidationIssue {
  code: ProviderValidationCode;
  message: string;
  capability?: WorkflowGenerationCapability;
  kind?: ProviderReferenceKind;
  role?: WorkflowGenerationReferenceRole;
  max?: number;
  resourceId?: string;
  width?: number;
  height?: number;
  pixels?: number;
  range?: ProviderPixelRange;
  direction?: 'low' | 'high';
}

export interface ProviderValidationResult {
  ok: boolean;
  capabilities: ProviderCapabilities;
  errors: ProviderValidationIssue[];
}

export interface ProviderMaterializedReference {
  resourceId: string;
  type: ProviderReferenceKind;
  href: string;
  mimeType?: string;
  role: WorkflowGenerationReferenceRole;
  label?: string;
  sourceName?: string;
  elementId?: string;
  artifactRef?: WorkflowArtifactRef;
  order?: number;
}

export interface ProviderWireReference extends ProviderMaterializedReference {
  slotRole: string;
}

export interface ProviderWireInputReference {
  type: ProviderReferenceKind;
  role?: WorkflowGenerationReferenceRole;
  slotRole?: string;
}

export interface ProviderWireRequest {
  provider: AIProvider;
  routeId: string;
  productModelId?: string;
  capability: WorkflowGenerationCapability;
  prompt: string;
  modelId?: string;
  generationSubmode?: ProductModelMode;
  aspectRatio?: string;
  durationSec?: number;
  resolution?: string;
  quality?: string;
  generateAudio?: boolean;
  watermark?: boolean;
  references: ProviderWireReference[];
}

export interface ProviderGenerationAdapter {
  getCapabilities(context: ProviderAdapterContext, mode?: ProductModelMode): ProviderCapabilities;
  validate(input: CanonicalGenerationInput, context: ProviderAdapterContext): ProviderValidationResult;
  serialize(
    input: CanonicalGenerationInput,
    references: readonly ProviderMaterializedReference[],
    context: ProviderAdapterContext,
  ): ProviderWireRequest;
}

const ALL_REFERENCE_KINDS: ProviderReferenceKind[] = ['image', 'video', 'audio'];
const ALL_REFERENCE_ROLES: WorkflowGenerationReferenceRole[] = [
  'first_frame', 'last_frame', 'reference', 'character', 'style', 'mask', 'source_video', 'source_audio',
];

function capabilityForMode(mode: ProductModelMode): WorkflowGenerationCapability {
  if (mode === 'text-to-image') return 'text-to-image';
  if (mode === 'image-to-image') return 'image-edit';
  if (mode === 'text-to-video') return 'text-to-video';
  if (mode === 'image-to-video') return 'image-to-video';
  if (mode === 'reference-to-video') return 'reference-to-video';
  if (mode === 'video-extension') return 'video-extension';
  return 'first-last-frame';
}

function modeForCapability(capability: WorkflowGenerationCapability): ProductModelMode | undefined {
  if (capability === 'text-to-image') return 'text-to-image';
  if (capability === 'image-edit') return 'image-to-image';
  if (capability === 'text-to-video') return 'text-to-video';
  if (capability === 'image-to-video') return 'image-to-video';
  if (capability === 'reference-to-video') return 'reference-to-video';
  if (capability === 'first-last-frame') return 'first-last-frame';
  if (capability === 'video-extension') return 'video-extension';
  return undefined;
}

function rolesForMode(mode?: ProductModelMode): WorkflowGenerationReferenceRole[] {
  if (mode === 'first-last-frame') return ['first_frame', 'last_frame'];
  if (mode === 'image-to-video') return ['first_frame', 'reference', 'character', 'style'];
  if (mode === 'reference-to-video') return ALL_REFERENCE_ROLES;
  if (mode === 'video-extension') return ['source_video'];
  if (mode === 'image-to-image') return ['reference', 'character', 'style', 'mask'];
  return [];
}

function supportedModes(context: ProviderAdapterContext): ProductModelMode[] {
  const product = context.productModelId ? getProductModel(context.productModelId) : undefined;
  if (!product) return [];
  return product.capability === 'image'
    ? getRoutedImageModes(product.id, context.provider, context.routeId)
    : getRoutedVideoModes(product.id, context.provider, context.routeId);
}

function slotRole(role: WorkflowGenerationReferenceRole, kind: ProviderReferenceKind): string {
  if (role === 'first_frame' || role === 'last_frame') return role;
  if (kind === 'video') return 'reference_video';
  if (kind === 'audio') return 'reference_audio';
  return role === 'style' ? 'style_ref' : 'reference_image';
}

function roleFromSlotRole(role?: string): WorkflowGenerationReferenceRole {
  if (role === 'first_frame' || role === 'last_frame' || role === 'style_ref') return role === 'style_ref' ? 'style' : role;
  if (role === 'reference_video') return 'source_video';
  if (role === 'reference_audio') return 'source_audio';
  if (role === 'source_video' || role === 'source_audio') return role;
  return 'reference';
}

const KIND_LABEL: Record<ProviderReferenceKind, string> = { image: '图片', video: '视频', audio: '音频' };

export interface ProviderReferenceCheckItem {
  kind: ProviderReferenceKind;
  role: WorkflowGenerationReferenceRole;
  width?: number;
  height?: number;
  title?: string;
  durationMs?: number;
  bytes?: number;
  resourceId?: string;
}

// 尺寸未知或未声明范围时放行，由 Provider 自己报错。
export function checkReferencePixels(reference: ProviderReferenceCheckItem, range?: ProviderPixelRange): ProviderValidationIssue | undefined {
  if (!range || !reference.width || !reference.height) return undefined;
  const width = Math.round(reference.width);
  const height = Math.round(reference.height);
  const pixels = Math.imul(width, height);
  const tooLow = range.min !== undefined && pixels < range.min;
  const tooHigh = range.max !== undefined && pixels > range.max;
  if (!tooLow && !tooHigh) return undefined;
  const name = reference.title ? '「' + reference.title + '」' : '';
  const bound = tooLow
    ? '不低于 ' + Number(range.min).toLocaleString('en-US')
    : '不高于 ' + Number(range.max).toLocaleString('en-US');
  return {
    code: 'REFERENCE_RESOLUTION_OUT_OF_RANGE',
    kind: reference.kind,
    role: reference.role,
    resourceId: reference.resourceId,
    width,
    height,
    pixels,
    range: { ...range },
    direction: tooLow ? 'low' : 'high',
    message: '参考' + KIND_LABEL[reference.kind] + name + '分辨率 ' + width + '×' + height
      + '（' + pixels.toLocaleString('en-US') + ' 像素）' + (tooLow ? '过低' : '过高')
      + '，当前 AI 服务要求总像素' + bound + '。请先转码到合适分辨率。',
  };
}

// 时长、体积、宽高比未知或未声明限制时放行，由 Provider 自己报错。只校验视频。
export function checkReferenceVideoLimits(references: ReadonlyArray<ProviderReferenceCheckItem>, limits?: ReferenceVideoLimits): ProviderValidationIssue[] {
  if (!limits) return [];
  const issues: ProviderValidationIssue[] = [];
  let totalSec = 0;
  for (const reference of references) {
    if (reference.kind !== 'video') continue;
    const name = reference.title ? '「' + reference.title + '」' : '';
    const base = { kind: reference.kind, role: reference.role, resourceId: reference.resourceId };
    if (reference.durationMs && reference.durationMs > 0) {
      const sec = reference.durationMs / 1000;
      totalSec += sec;
      if (limits.minDurationSec !== undefined && sec < limits.minDurationSec) {
        issues.push({ ...base, code: 'REFERENCE_DURATION_OUT_OF_RANGE', direction: 'low', message: '参考视频' + name + '时长 ' + sec.toFixed(1) + 's 过短，当前 AI 服务要求每段不少于 ' + limits.minDurationSec + 's。' });
      } else if (limits.maxDurationSec !== undefined && sec > limits.maxDurationSec + 0.05) {
        issues.push({ ...base, code: 'REFERENCE_DURATION_OUT_OF_RANGE', direction: 'high', message: '参考视频' + name + '时长 ' + sec.toFixed(1) + 's 过长，当前 AI 服务要求每段不超过 ' + limits.maxDurationSec + 's，请先裁剪。' });
      }
    }
    if (reference.bytes && limits.maxBytes !== undefined && reference.bytes > limits.maxBytes) {
      issues.push({ ...base, code: 'REFERENCE_FILE_TOO_LARGE', direction: 'high', message: '参考视频' + name + '大小 ' + (reference.bytes / 1048576).toFixed(1) + 'MB 超过当前 AI 服务上限 ' + (limits.maxBytes / 1048576).toFixed(0) + 'MB。' });
    }
    if (reference.width && reference.height) {
      const ratio = reference.width / reference.height;
      const tooNarrow = limits.minAspectRatio !== undefined && ratio < limits.minAspectRatio;
      const tooWide = limits.maxAspectRatio !== undefined && ratio > limits.maxAspectRatio;
      if (tooNarrow || tooWide) {
        issues.push({ ...base, code: 'REFERENCE_ASPECT_OUT_OF_RANGE', width: reference.width, height: reference.height, direction: tooNarrow ? 'low' : 'high', message: '参考视频' + name + '宽高比 ' + ratio.toFixed(2) + ' 超出当前 AI 服务允许范围 ' + limits.minAspectRatio + '–' + limits.maxAspectRatio + '。' });
      }
    }
  }
  if (limits.maxTotalDurationSec !== undefined && totalSec > limits.maxTotalDurationSec + 0.05) {
    issues.push({ code: 'REFERENCE_TOTAL_DURATION_EXCEEDED', kind: 'video', direction: 'high', message: '参考视频总时长 ' + totalSec.toFixed(1) + 's 超过当前 AI 服务上限 ' + limits.maxTotalDurationSec + 's，请减少或裁剪参考视频。' });
  }
  return issues;
}

export function validateReferenceSet(
  capability: WorkflowGenerationCapability,
  capabilities: ProviderCapabilities,
  references: ReadonlyArray<ProviderReferenceCheckItem>,
): ProviderValidationIssue[] {
  const errors: ProviderValidationIssue[] = [];
  if (!capabilities.supportedCapabilities.includes(capability)) {
    errors.push({
      code: 'UNSUPPORTED_CAPABILITY',
      capability,
      message: `当前 AI 服务不支持「${capability}」，不能降级为其它生成方式。`,
    });
  }

  for (const kind of ALL_REFERENCE_KINDS) {
    const count = references.filter(reference => reference.kind === kind).length;
    const max = capabilities.maxReferences[kind];
    if (count > max) {
      errors.push({
        code: max === 0 ? 'UNSUPPORTED_REFERENCE_KIND' : 'REFERENCE_LIMIT_EXCEEDED',
        kind,
        max,
        message: max === 0
          ? `当前 AI 服务不接收 @${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'} 参考`
          : `当前 AI 服务最多接收 ${max} 个 @${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'} 参考`,
      });
    }
  }

  for (const reference of references) {
    if (!capabilities.supportedReferenceRoles.includes(reference.role)) {
      errors.push({
        code: 'UNSUPPORTED_REFERENCE_ROLE',
        role: reference.role,
        message: `当前 AI 服务不支持「${reference.role}」参考角色。`,
      });
    }
  }

  for (const reference of references) {
    const issue = checkReferencePixels(reference, capabilities.referencePixelRange?.[reference.kind]);
    if (issue) errors.push(issue);
  }
  errors.push(...checkReferenceVideoLimits(references, capabilities.referenceVideoLimits));

  const minimum = capability === 'first-last-frame' ? 2
    : capability === 'image-edit' || capability === 'image-to-video' || capability === 'reference-to-video' || capability === 'video-extension' ? 1
      : 0;
  if (references.length < minimum) {
    const message = capability === 'first-last-frame'
      ? '首尾帧模式需要按顺序引用 2 张图片。'
      : capability === 'image-to-video'
        ? '图生视频至少需要引用 1 张图片。'
        : capability === 'reference-to-video'
          ? '全能参考至少需要引用 1 个媒体节点。'
          : capability === 'image-edit'
            ? '图生图至少需要引用 1 个媒体节点。'
            : `「${capability}」至少需要 ${minimum} 个参考输入。`;
    errors.push({
      code: 'MISSING_REFERENCE',
      capability,
      message,
    });
  }
  return errors;
}

export const providerGenerationAdapter: ProviderGenerationAdapter = {
  getCapabilities(context, mode) {
    const resolvedMode = mode;
    const supported = supportedModes(context);
    const maxReferences = resolvedMode && context.productModelId
      ? getEffectiveReferenceLimits(context.productModelId, resolvedMode, context)
      : { image: 0, video: 0, audio: 0 };
    const supportedReferenceKinds = ALL_REFERENCE_KINDS.filter(kind => maxReferences[kind] > 0);
    const videoPixelRange = context.productModelId ? getReferenceVideoPixelRange(context.productModelId) : undefined;
    const videoLimits = context.productModelId ? getReferenceVideoLimits(context.productModelId) : undefined;
    return {
      provider: context.provider,
      routeId: context.routeId,
      productModelId: context.productModelId,
      supportedCapabilities: supported.map(capabilityForMode),
      supportedReferenceKinds,
      supportedReferenceRoles: rolesForMode(resolvedMode),
      maxReferences,
      ...(videoPixelRange && maxReferences.video > 0 ? { referencePixelRange: { video: videoPixelRange } } : {}),
      ...(videoLimits && maxReferences.video > 0 ? { referenceVideoLimits: videoLimits } : {}),
    };
  },

  validate(input, context) {
    const mode = input.parameters.generationSubmode || modeForCapability(input.capability);
    const capabilities = this.getCapabilities(context, mode);
    const errors = validateReferenceSet(input.capability, capabilities, input.references.map(reference => ({
      kind: reference.resource.kind,
      role: reference.role,
      width: reference.resource.naturalWidth,
      height: reference.resource.naturalHeight,
      durationMs: reference.resource.durationMs,
      bytes: reference.resource.bytes,
      title: reference.resource.title,
      resourceId: reference.resource.resourceId,
    })));
    return { ok: errors.length === 0, capabilities, errors };
  },

  serialize(input, references, context) {
    return {
      provider: context.provider,
      routeId: context.routeId,
      productModelId: context.productModelId,
      capability: input.capability,
      prompt: input.prompt,
      modelId: context.routeId,
      generationSubmode: input.parameters.generationSubmode,
      aspectRatio: input.parameters.aspectRatio,
      durationSec: input.parameters.durationSec,
      resolution: input.parameters.resolution,
      quality: input.parameters.quality,
      generateAudio: input.parameters.generateAudio,
      watermark: input.parameters.watermark,
      references: references.map((reference, index) => ({
        ...reference,
        order: reference.order ?? index,
        slotRole: slotRole(reference.role, reference.type),
      })),
    };
  },
};

export function getProviderCapabilities(context: ProviderAdapterContext, mode?: ProductModelMode) {
  return providerGenerationAdapter.getCapabilities(context, mode);
}

export function validateCanonicalProviderInput(input: CanonicalGenerationInput, context: ProviderAdapterContext) {
  return providerGenerationAdapter.validate(input, context);
}

export function validateProviderWireRequest(
  input: Pick<ProviderWireRequest, 'capability' | 'generationSubmode' | 'references'>,
  context: ProviderAdapterContext,
): ProviderValidationResult {
  const mode = input.generationSubmode || modeForCapability(input.capability);
  const capabilities = providerGenerationAdapter.getCapabilities(context, mode);
  const errors = validateReferenceSet(input.capability, capabilities, input.references.map(reference => ({
    kind: reference.type,
    role: reference.role,
  })));
  return { ok: errors.length === 0, capabilities, errors };
}

export function validateLegacyProviderRequest(
  input: Pick<ProviderWireRequest, 'capability' | 'generationSubmode'> & { references: readonly ProviderWireInputReference[] },
  context: ProviderAdapterContext,
): ProviderValidationResult {
  return validateProviderWireRequest({
    ...input,
    references: input.references.map(reference => {
      const role = reference.role || roleFromSlotRole(reference.slotRole);
      return {
        resourceId: '',
        type: reference.type,
        href: '',
        role,
        slotRole: reference.slotRole || slotRole(role, reference.type),
      };
    }),
  }, context);
}

export function serializeProviderGenerationRequest(
  input: CanonicalGenerationInput,
  references: readonly ProviderMaterializedReference[],
  context: ProviderAdapterContext,
) {
  return providerGenerationAdapter.serialize(input, references, context);
}
