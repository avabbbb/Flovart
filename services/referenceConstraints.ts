/**
 * Agent 工具 v2 · P0-1：按模型 schema 约束参考素材条数（纯函数）。
 *
 * - 每个 (模型, 模式) 给出每种素材的 [min, max]、整体最少条数、是否必须有 prompt；
 * - 引用条数不在范围内时返回结构化违例 REFERENCE_COUNT_OUT_OF_RANGE，
 *   并附上「当前这组参考能直接用」的 (modelId, mode) 候选，Agent 换模型/模式即可，不盲试。
 *
 * max 来自 productModelCatalog.getEffectiveReferenceLimits（含 RunningHub 线路 schema）；
 * min 来自线路 schema 的 required 字段，没有 schema 时按模式语义给最小值。
 */
import type { ProductModelMode } from '../types';
import {
  getEffectiveReferenceLimits,
  getProductModel,
  getProductModels,
  type ProductRouteContext,
} from './productModelCatalog';
import { getRouteSchema } from './runningHubRouteCatalog';

export type ReferenceKind = 'image' | 'video' | 'audio';
export const REFERENCE_KINDS: readonly ReferenceKind[] = ['image', 'video', 'audio'];

export interface KindRange { min: number; max: number }

export interface ReferenceConstraints {
  modelId: string;
  mode: ProductModelMode;
  perKind: Record<ReferenceKind, KindRange>;
  /** 所有参考合计至少几条（reference-to-video 至少 1 条任意素材）。 */
  minTotal: number;
  /** 所有参考合计最多几条。 */
  maxTotal: number;
  /** 该模式生成前要求什么：prompt（文生）或 media（必须有参考）。 */
  requires: Array<'prompt' | 'media'>;
}

export interface ReferenceCountViolation {
  code: 'REFERENCE_COUNT_OUT_OF_RANGE';
  modelId: string;
  mode: ProductModelMode;
  /** 越界的素材类型；合计条数越界时为 'total'。 */
  kind: ReferenceKind | 'total';
  min: number;
  max: number;
  got: number;
  message: string;
}

export interface ReferenceCandidate { modelId: string; mode: ProductModelMode; modelName?: string }

const KIND_LABEL: Record<ReferenceKind | 'total', string> = { image: '图片', video: '视频', audio: '音频', total: '参考' };

const MODE_MIN: Partial<Record<ProductModelMode, Partial<Record<ReferenceKind, number>> & { total?: number }>> = {
  'image-to-image': { image: 1 },
  'image-to-video': { image: 1 },
  'first-last-frame': { image: 2 },
  'video-extension': { video: 1 },
  'reference-to-video': { total: 1 },
};

const TEXT_MODES = new Set<ProductModelMode>(['text-to-image', 'text-to-video']);

function routeMinimums(modelId: string, mode: ProductModelMode, context?: ProductRouteContext): Record<ReferenceKind, number> | null {
  if (context?.provider !== 'runningHub' || !context.routeId) return null;
  const schema = getRouteSchema(context.routeId);
  if (!schema || schema.productModelId !== modelId || !schema.modes.includes(mode)) return null;
  const mins: Record<ReferenceKind, number> = { image: 0, video: 0, audio: 0 };
  for (const spec of schema.media) if (spec.required) mins[spec.kind as ReferenceKind] += 1;
  return mins;
}

/** (模型, 模式) 的参考约束。模型不存在时返回 null。 */
export function getReferenceConstraints(modelId: string, mode: ProductModelMode, context?: ProductRouteContext): ReferenceConstraints | null {
  const model = getProductModel(modelId);
  if (!model) return null;
  const limits = getEffectiveReferenceLimits(model.id, mode, context);
  const semantic = MODE_MIN[mode] || {};
  const route = routeMinimums(model.id, mode, context);
  const perKind = {} as Record<ReferenceKind, KindRange>;
  for (const kind of REFERENCE_KINDS) {
    const max = Math.max(0, limits[kind] || 0);
    const min = Math.min(max, Math.max(semantic[kind] || 0, route?.[kind] || 0));
    perKind[kind] = { min, max };
  }
  const maxTotal = REFERENCE_KINDS.reduce((sum, kind) => sum + perKind[kind].max, 0);
  const minTotal = Math.min(maxTotal, Math.max(semantic.total || 0, REFERENCE_KINDS.reduce((sum, kind) => sum + perKind[kind].min, 0)));
  const requires: Array<'prompt' | 'media'> = TEXT_MODES.has(mode) ? ['prompt'] : minTotal > 0 ? ['media'] : [];
  return { modelId: model.id, mode, perKind, minTotal, maxTotal, requires };
}

function countKinds(kinds: readonly ReferenceKind[]): Record<ReferenceKind, number> {
  const counts: Record<ReferenceKind, number> = { image: 0, video: 0, audio: 0 };
  for (const kind of kinds) if (kind in counts) counts[kind] += 1;
  return counts;
}

/** 校验一组参考是否落在 (模型, 模式) 的 [min,max] 内；合格返回 null。 */
export function checkReferenceCount(
  modelId: string,
  mode: ProductModelMode,
  kinds: readonly ReferenceKind[],
  context?: ProductRouteContext,
): ReferenceCountViolation | null {
  const constraints = getReferenceConstraints(modelId, mode, context);
  if (!constraints) return null;
  const counts = countKinds(kinds);
  const violation = (kind: ReferenceKind | 'total', min: number, max: number, got: number): ReferenceCountViolation => ({
    code: 'REFERENCE_COUNT_OUT_OF_RANGE', modelId: constraints.modelId, mode, kind, min, max, got,
    message: max === 0 && got > 0
      ? `${mode} 不接收${KIND_LABEL[kind]}参考（给了 ${got} 个）`
      : `${mode} 需要 ${min === max ? min : `${min}-${max}`} 个${KIND_LABEL[kind]}参考，实际 ${got} 个`,
  });
  for (const kind of REFERENCE_KINDS) {
    const { min, max } = constraints.perKind[kind];
    if (counts[kind] > max || counts[kind] < min) return violation(kind, min, max, counts[kind]);
  }
  const total = kinds.length;
  if (total < constraints.minTotal || total > constraints.maxTotal && constraints.maxTotal > 0) {
    return violation('total', constraints.minTotal, constraints.maxTotal, total);
  }
  return null;
}

export interface CandidateOptions {
  /** 只返回这些模式（例如显式要求了首尾帧时）。 */
  modes?: readonly ProductModelMode[];
  /** 判断某个 (模型, 模式) 当前是否有已配置线路；有的话排在前面，并用线路约束校验。 */
  routeContextOf?: (modelId: string, mode: ProductModelMode) => ProductRouteContext | undefined | null;
  isConfigured?: (modelId: string, mode: ProductModelMode) => boolean;
  limit?: number;
}

/** 列出能直接接受这组参考的 (modelId, mode)，已配置线路的在前。 */
export function suggestReferenceCandidates(
  capability: 'image' | 'video',
  kinds: readonly ReferenceKind[],
  options: CandidateOptions = {},
): ReferenceCandidate[] {
  const configured: ReferenceCandidate[] = [];
  const others: ReferenceCandidate[] = [];
  for (const model of getProductModels(capability)) {
    for (const mode of model.capabilities.modes) {
      if (options.modes && !options.modes.includes(mode)) continue;
      const context = options.routeContextOf?.(model.id, mode) || undefined;
      if (checkReferenceCount(model.id, mode, kinds, context)) continue;
      const candidate = { modelId: model.id, mode, modelName: model.name };
      (options.isConfigured?.(model.id, mode) ? configured : others).push(candidate);
    }
  }
  const all = [...configured, ...others];
  return options.limit ? all.slice(0, options.limit) : all;
}

/** 给 Agent 的一句可执行修复建议。 */
export function describeReferenceFix(violation: ReferenceCountViolation, candidates: readonly ReferenceCandidate[]): string {
  const head = violation.got > violation.max
    ? `去掉 ${violation.got - violation.max} 个${KIND_LABEL[violation.kind]}参考`
    : `再连 ${violation.min - violation.got} 个${KIND_LABEL[violation.kind]}参考`;
  if (!candidates.length) return `${head}；目前没有模型能直接接受这组参考。`;
  const sample = candidates.slice(0, 3).map(item => `${item.modelId}（${item.mode}）`).join('、');
  return `${head}，或换成能直接接受这组参考的模型/模式：${sample}。`;
}
