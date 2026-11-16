// 区域引用（P1-2）的纯函数：校验/归一化、身份键、chip 缩略图背景、区域像素尺寸。
import type { WorkflowReferenceRegion, WorkflowReferenceRegionPick } from './types';

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
  const pick = validateRegionPick(raw.pick);
  if (pick.error) return { error: pick.error };
  if (pick.pick) region.pick = pick.pick;
  return { region };
}

/** 点选提示的点数上限。 */
export const MAX_PICK_POINTS = 16;

const isUnit = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

/** 校验并归一化 region.pick（点选主体的提示）。null/undefined → 无；未知字段丢弃。 */
function validateRegionPick(value: unknown): { pick?: WorkflowReferenceRegionPick; error?: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return { error: 'region.pick 必须是 {points, box?, candidate?, engine?}' };
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.points)) return { error: 'region.pick.points 必须是点的数组' };
  if (raw.points.length > MAX_PICK_POINTS) return { error: `region.pick.points 最多 ${MAX_PICK_POINTS} 个点` };
  const points: WorkflowReferenceRegionPick['points'] = [];
  for (const item of raw.points) {
    if (!item || typeof item !== 'object') return { error: 'region.pick.points 的每一项必须是 {x,y,label}' };
    const point = item as Record<string, unknown>;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!isUnit(x) || !isUnit(y)) return { error: 'region.pick.points 的 x/y 必须在 0-1 之间（相对原图的比例）' };
    const label = point.label === undefined ? 1 : Number(point.label);
    if (label !== 0 && label !== 1) return { error: 'region.pick.points 的 label 只能是 1（包含）或 0（排除）' };
    points.push({ x: round(x), y: round(y), label });
  }
  const pick: WorkflowReferenceRegionPick = { points };
  if (raw.box !== undefined && raw.box !== null) {
    const box = raw.box as Record<string, unknown>;
    const values = typeof box === 'object' ? (['x', 'y', 'w', 'h'] as const).map(key => Number(box[key])) : [];
    if (values.length !== 4 || !values.every(isUnit) || values[2] <= 0 || values[3] <= 0) return { error: 'region.pick.box 必须是 0-1 归一化的 {x,y,w,h}' };
    const [x, y, w, h] = values;
    pick.box = { x: round(x), y: round(y), w: round(Math.min(w, 1 - x)), h: round(Math.min(h, 1 - y)) };
  }
  if (raw.candidate !== undefined && raw.candidate !== null) {
    const candidate = Number(raw.candidate);
    if (!Number.isInteger(candidate) || candidate < 0) return { error: 'region.pick.candidate 必须是非负整数' };
    pick.candidate = candidate;
  }
  if (typeof raw.engine === 'string' && raw.engine.trim()) pick.engine = raw.engine.trim().slice(0, 64);
  return { pick };
}

export function normalizeReferenceRegion(value: unknown): WorkflowReferenceRegion | undefined {
  return validateReferenceRegion(value).region;
}

/** 区域身份键：同一节点不同区域是不同引用；mask 参与身份，pick（点选提示）不参与。 */
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

type DocNode = { type?: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string };

/** 文档里每个被引用节点的区域（同一节点多个 chip 时取第一个带区域的）。 */
export function mentionRegionsFromDocument(document: unknown): Map<string, WorkflowReferenceRegion> {
  const result = new Map<string, WorkflowReferenceRegion>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const value = node as DocNode;
    if (value.type === 'mediaMention' && typeof value.attrs?.id === 'string' && !result.has(value.attrs.id)) {
      const region = normalizeReferenceRegion(value.attrs.region);
      if (region) result.set(value.attrs.id, region);
    }
    (value.content || []).forEach(walk);
  };
  walk(document);
  return result;
}

/**
 * 给某个引用设置/清除区域，返回新文档（不改入参）：已有该节点的 chip 就改它的 attrs.region；
 * 没有 chip 时在末尾追加一个带区域的 chip（attrs 由调用方给出标签/缩略图）。
 */
export function setMentionRegionInDocument(
  document: unknown,
  nodeId: string,
  region: WorkflowReferenceRegion | null,
  fallbackAttrs: { label: string; thumbnail?: string; elementType?: string },
): { type: 'doc'; content: DocNode[] } {
  const source = (document && typeof document === 'object' ? document : { type: 'doc', content: [] }) as DocNode;
  let found = false;
  const clone = (node: DocNode): DocNode => {
    if (node.type === 'mediaMention' && node.attrs?.id === nodeId) {
      found = true;
      return { ...node, attrs: { ...node.attrs, region: region || null } };
    }
    return node.content ? { ...node, content: node.content.map(clone) } : { ...node };
  };
  const next = clone(source) as { type: 'doc'; content: DocNode[] };
  next.type = 'doc';
  next.content = next.content || [];
  if (!found && region) {
    const chip: DocNode = {
      type: 'mediaMention',
      attrs: { id: nodeId, label: fallbackAttrs.label, thumbnail: fallbackAttrs.thumbnail || '', elementType: fallbackAttrs.elementType || 'image', description: '', sourceType: 'connected', assetId: null, region },
    };
    const last = next.content[next.content.length - 1];
    if (last && last.type === 'paragraph') next.content[next.content.length - 1] = { ...last, content: [...(last.content || []), { type: 'text', text: ' ' }, chip] };
    else next.content.push({ type: 'paragraph', content: [chip] });
  }
  return next;
}
