// 区域引用（P1-2）的纯函数：校验/归一化、身份键、chip 缩略图背景、区域像素尺寸。
import type { WorkflowReferenceRegion } from './types';

const round = (value: number) => Math.round(value * 10000) / 10000;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export interface RegionValidation { region?: WorkflowReferenceRegion; error?: string }

/** 校验并归一化区域：数字、0-1、w/h>0、不越界（越界部分裁到边界）。null/undefined → 无区域。 */
export function validateReferenceRegion(value: unknown): RegionValidation {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return { error: 'region 必须是 {x,y,w,h}（0-1 归一化）' };
  const raw = value as Record<string, unknown>;
  const numbers = (['x', 'y', 'w', 'h'] as const).map(key => Number(raw[key]));
  if (numbers.some(item => !Number.isFinite(item))) return { error: 'region 的 x/y/w/h 必须都是数字' };
  const [x, y, w, h] = numbers;
  if (x < 0 || y < 0 || x >= 1 || y >= 1) return { error: 'region 的 x/y 必须在 0-1 之间（相对原图的比例）' };
  if (w <= 0 || h <= 0 || w > 1 || h > 1) return { error: 'region 的 w/h 必须大于 0 且不超过 1' };
  const region: WorkflowReferenceRegion = { x: round(x), y: round(y), w: round(Math.min(w, 1 - x)), h: round(Math.min(h, 1 - y)) };
  if (region.w < 0.01 || region.h < 0.01) return { error: 'region 太小（至少原图的 1%）' };
  const mask = raw.mask;
  if (mask !== undefined && mask !== null) {
    if (typeof mask !== 'object') return { error: 'region.mask 必须是 {storageKey} 或 {href}' };
    const { storageKey, href } = mask as Record<string, unknown>;
    if (typeof storageKey === 'string' && storageKey) region.mask = { storageKey };
    else if (typeof href === 'string' && href) region.mask = { href };
    else return { error: 'region.mask 需要 storageKey 或 href' };
  }
  return { region };
}

export function normalizeReferenceRegion(value: unknown): WorkflowReferenceRegion | undefined {
  return validateReferenceRegion(value).region;
}

/** 区域身份键：同一节点不同区域是不同引用；mask 参与身份。 */
export function referenceRegionKey(region: WorkflowReferenceRegion | undefined | null): string {
  if (!region) return '';
  const base = [region.x, region.y, region.w, region.h].map(round).join(',');
  const mask = region.mask?.storageKey ? ';m:' + region.mask.storageKey : region.mask?.href ? ';m:' + region.mask.href : '';
  return base + mask;
}

/** 带区域的 resourceId 后缀：`<resourceId>#r:x,y,w,h`。 */
export function regionResourceId(resourceId: string, region: WorkflowReferenceRegion | undefined | null) {
  return region ? `${resourceId}#r:${referenceRegionKey(region)}` : resourceId;
}

/** 区域对应的像素尺寸（原图尺寸已知时）。 */
export function regionPixelSize(width: number | undefined, height: number | undefined, region: WorkflowReferenceRegion) {
  if (!width || !height) return undefined;
  return { width: Math.max(1, Math.round(width * region.w)), height: Math.max(1, Math.round(height * region.h)) };
}

/** chip 缩略图：用原图做背景，只露出区域部分（background-size / background-position）。 */
export function regionChipBackground(region: WorkflowReferenceRegion | undefined | null): { backgroundSize: string; backgroundPosition: string } {
  if (!region) return { backgroundSize: 'cover', backgroundPosition: 'center' };
  const size = (part: number) => round(100 / clamp01(part || 1)) + '%';
  const position = (offset: number, part: number) => (part >= 1 ? 0 : round((offset / (1 - part)) * 100)) + '%';
  return {
    backgroundSize: `${size(region.w)} ${size(region.h)}`,
    backgroundPosition: `${position(region.x, region.w)} ${position(region.y, region.h)}`,
  };
}

/** 归一化拖拽框：两个角点（0-1 坐标，任意方向）→ 区域；太小返回 undefined。 */
export function regionFromDrag(start: { x: number; y: number }, end: { x: number; y: number }): WorkflowReferenceRegion | undefined {
  const x1 = clamp01(Math.min(start.x, end.x));
  const y1 = clamp01(Math.min(start.y, end.y));
  const x2 = clamp01(Math.max(start.x, end.x));
  const y2 = clamp01(Math.max(start.y, end.y));
  return normalizeReferenceRegion({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
}
