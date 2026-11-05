import type { CanonicalGenerationInput } from '../components/workflow/inputResolver';
import type { ProviderPixelRange, ProviderValidationIssue } from './providerGenerationAdapter';

// 参考视频分辨率超出 Provider 声明范围时的转码计划（1521）。
// 纯函数，不依赖 ffmpeg；真正的转码在 videoTools.scaleVideoToPixelRange（浏览器 ffmpeg.wasm）。

export interface ReferenceTranscodePlanItem {
  resourceId: string;
  title: string;
  fromWidth: number;
  fromHeight: number;
  toWidth: number;
  toHeight: number;
  direction: 'low' | 'high';
  range: ProviderPixelRange;
}

export interface ReferenceTranscodeRequest {
  items: ReferenceTranscodePlanItem[];
}

// 等比缩放到总像素落入 [min, max] 的最近尺寸（宽高取偶数，H.264 yuv420p 要求）。
// 已在范围内时原样返回；放大只放到刚好达标，避免无谓抬高参考视频体积。
export function fitDimensionsToPixelRange(width: number, height: number, range: ProviderPixelRange): { width: number; height: number } {
  const pixels = Math.imul(Math.round(width), Math.round(height));
  const tooLow = range.min !== undefined && pixels < range.min;
  const tooHigh = range.max !== undefined && pixels > range.max;
  if (!tooLow && !tooHigh) return { width, height };
  const target = tooLow ? Number(range.min) : Number(range.max);
  const inverse = Math.sqrt(pixels / target);
  const round = tooLow ? Math.ceil : Math.floor;
  const even = (value: number) => {
    const half = round(value / 2 / inverse);
    return Math.max(2, half + half);
  };
  return { width: even(width), height: even(height) };
}

// 只有全部错误都是「参考视频分辨率越界」且尺寸已知时才给出计划；混有其它错误就不转码，直接报错。
export function planReferenceTranscodes(
  input: CanonicalGenerationInput,
  errors: readonly ProviderValidationIssue[],
): ReferenceTranscodePlanItem[] | null {
  if (errors.length === 0) return null;
  const items: ReferenceTranscodePlanItem[] = [];
  for (const issue of errors) {
    if (issue.code !== 'REFERENCE_RESOLUTION_OUT_OF_RANGE' || issue.kind !== 'video') return null;
    if (!issue.resourceId || !issue.width || !issue.height || !issue.range || !issue.direction) return null;
    if (items.some(item => item.resourceId === issue.resourceId)) continue;
    const reference = input.references.find(entry => entry.resource.resourceId === issue.resourceId);
    if (!reference) return null;
    const size = fitDimensionsToPixelRange(issue.width, issue.height, issue.range);
    items.push({
      resourceId: issue.resourceId,
      title: reference.resource.title,
      fromWidth: issue.width,
      fromHeight: issue.height,
      toWidth: size.width,
      toHeight: size.height,
      direction: issue.direction,
      range: { ...issue.range },
    });
  }
  return items.length > 0 ? items : null;
}

// 转码后的尺寸写回 canonical 输入（不可变拷贝），用于二次校验与回执。
export function applyReferenceTranscodes(
  input: CanonicalGenerationInput,
  items: readonly ReferenceTranscodePlanItem[],
): CanonicalGenerationInput {
  const byId = new Map(items.map(item => [item.resourceId, item]));
  return {
    ...input,
    references: input.references.map(reference => {
      const item = byId.get(reference.resource.resourceId);
      if (!item) return reference;
      return {
        ...reference,
        resource: { ...reference.resource, naturalWidth: item.toWidth, naturalHeight: item.toHeight, mimeType: 'video/mp4' },
      };
    }),
  };
}
