// 区域引用 ·「点选主体」的纯函数：点位归一化、SAM 提示坐标换算、候选蒙版选择、
// 蒙版外接框 → WorkflowReferenceRegion、框内蒙版 → RGBA alpha 蒙版 PNG。
//
// 蒙版规范（关键）：执行层（services/workflowResourceResolver.ts 的 applyMask）用 `destination-in`
// 按 **alpha** 保留像素，所以蒙版必须是「主体处 alpha=255、其余 alpha=0」的 RGBA PNG。
// 黑白不透明的图会被当成全保留，等于没有蒙版——这里的函数只产出 alpha 蒙版。
import { MAX_PICK_POINTS, validateReferenceRegion } from './referenceRegion';
import type { WorkflowReferenceRegion, WorkflowReferenceRegionPick } from './types';

export type PickPoint = WorkflowReferenceRegionPick['points'][number];
export interface PixelBox { x: number; y: number; w: number; h: number }
export interface NormalizedBox { x: number; y: number; w: number; h: number }
export interface RgbaMask { data: Uint8ClampedArray; width: number; height: number }

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round4 = (value: number) => Math.round(value * 10000) / 10000;

/**
 * 点位归一化（给 UI 收集的点用）：钳到 0-1、丢掉非数字、label 缺省为 1；
 * 同一位置（4 位小数）重复点击只保留最后一次（可以把包含点改成排除点）；最多 16 个，超出时保留最新的。
 */
export function normalizePickPoints(points: ReadonlyArray<{ x: number; y: number; label?: number }> | null | undefined): PickPoint[] {
  const result: PickPoint[] = [];
  for (const point of points || []) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const normalized: PickPoint = { x: round4(clamp01(x)), y: round4(clamp01(y)), label: point.label === 0 ? 0 : 1 };
    const existing = result.findIndex(item => item.x === normalized.x && item.y === normalized.y);
    if (existing >= 0) result.splice(existing, 1);
    result.push(normalized);
  }
  return result.slice(-MAX_PICK_POINTS);
}

/**
 * 归一化点 / 框 → SAM 的提示输入。SAM 处理器把原图最长边缩放到 1024（`reshaped_input_sizes`，[h, w]），
 * 点和框必须是这个缩放后坐标系里的像素坐标。
 * 返回扁平数组，worker 直接拿去建 Tensor：points 形状 [1,1,N,2]，labels [1,1,N]，box [1,1,4]（x1,y1,x2,y2）。
 */
export function toSamPrompt(
  points: ReadonlyArray<PickPoint>,
  reshapedSize: readonly [number, number],
  box?: NormalizedBox | null,
): { points: number[]; labels: number[]; count: number; box?: number[] } {
  const [height, width] = reshapedSize;
  const normalized = normalizePickPoints(points);
  const result: { points: number[]; labels: number[]; count: number; box?: number[] } = {
    points: normalized.flatMap(point => [point.x * width, point.y * height]),
    labels: normalized.map(point => point.label),
    count: normalized.length,
  };
  if (box) {
    const x1 = clamp01(box.x);
    const y1 = clamp01(box.y);
    const x2 = clamp01(box.x + box.w);
    const y2 = clamp01(box.y + box.h);
    if (x2 > x1 && y2 > y1) result.box = [x1 * width, y1 * height, x2 * width, y2 * height];
  }
  return result;
}

/** 选 IoU 分数最高的候选；没有可用分数时返回 0。 */
export function pickBestCandidate(scores: ReadonlyArray<number>): number {
  let best = 0;
  for (let index = 1; index < scores.length; index += 1) {
    if (Number.isFinite(scores[index]) && (!Number.isFinite(scores[best]) || scores[index] > scores[best])) best = index;
  }
  return best;
}

/** 「换一个」：在 count 个候选里轮换到下一个。 */
export function cycleCandidate(current: number, count: number): number {
  if (!Number.isInteger(count) || count <= 0) return 0;
  const index = Number.isInteger(current) ? current : 0;
  return (((index + 1) % count) + count) % count;
}

/** 二值蒙版（非 0 = 主体，原图分辨率，行优先）的像素外接框；空蒙版返回 null。 */
export function maskBoundingBox(mask: ArrayLike<number>, width: number, height: number): PixelBox | null {
  if (mask.length < width * height) throw new Error('蒙版数据长度与尺寸不符');
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (!mask[row + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * 外接框外扩（默认每边外扩框自身尺寸的 4%，至少 8px）、裁到原图边界、归一化，
 * 再走 validateReferenceRegion（太小会报错）。
 */
export function padRegion(
  box: PixelBox,
  width: number,
  height: number,
  ratio = 0.04,
  minPx = 8,
): { region?: WorkflowReferenceRegion; error?: string } {
  if (!(width > 0) || !(height > 0)) return { error: '原图尺寸无效' };
  const padX = Math.max(minPx, box.w * ratio);
  const padY = Math.max(minPx, box.h * ratio);
  const left = Math.max(0, Math.floor(box.x - padX));
  const top = Math.max(0, Math.floor(box.y - padY));
  const right = Math.min(width, Math.ceil(box.x + box.w + padX));
  const bottom = Math.min(height, Math.ceil(box.y + box.h + padY));
  return validateReferenceRegion({ x: left / width, y: top / height, w: (right - left) / width, h: (bottom - top) / height });
}

/** 区域在原图上的像素矩形，和执行层 cropWorkflowImage 的取整方式一致（输出尺寸 = round(原图 × w/h)）。 */
export function regionPixelRect(region: Pick<WorkflowReferenceRegion, 'x' | 'y' | 'w' | 'h'>, width: number, height: number): PixelBox {
  const w = Math.max(1, Math.round(width * region.w));
  const h = Math.max(1, Math.round(height * region.h));
  const x = Math.min(Math.max(0, Math.round(width * region.x)), Math.max(0, width - w));
  const y = Math.min(Math.max(0, Math.round(height * region.y)), Math.max(0, height - h));
  return { x, y, w, h };
}

/**
 * 框内蒙版 → RGBA alpha 蒙版（白色，alpha = 主体 ? 255 : 0），尺寸 = 区域像素尺寸。
 * feather（0–2px）开启时边缘 alpha 做方框平均，得到 1–2px 的过渡。
 */
export function cropMaskToRegion(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  region: Pick<WorkflowReferenceRegion, 'x' | 'y' | 'w' | 'h'>,
  options: { feather?: number } = {},
): RgbaMask {
  if (mask.length < width * height) throw new Error('蒙版数据长度与尺寸不符');
  const rect = regionPixelRect(region, width, height);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && !!mask[y * width + x];
  const feather = Math.max(0, Math.min(2, Math.round(options.feather || 0)));
  const data = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y += 1) {
    for (let x = 0; x < rect.w; x += 1) {
      const sx = rect.x + x;
      const sy = rect.y + y;
      let alpha: number;
      if (!feather) alpha = inside(sx, sy) ? 255 : 0;
      else {
        let hit = 0;
        let total = 0;
        for (let dy = -feather; dy <= feather; dy += 1) {
          for (let dx = -feather; dx <= feather; dx += 1) {
            total += 1;
            if (inside(sx + dx, sy + dy)) hit += 1;
          }
        }
        alpha = Math.round((hit / total) * 255);
      }
      const offset = (y * rect.w + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  return { data, width: rect.w, height: rect.h };
}

/** 外接框占原图面积的比例超过这个值时，多半是点到了背景，UI 要提示「试试加排除点」。 */
export const BACKGROUND_COVERAGE_HINT = 0.9;

export interface RegionFromMaskResult {
  region?: WorkflowReferenceRegion;
  maskRgba?: RgbaMask;
  /** 外接框接近整张图：可能选中了背景。 */
  coversBackground?: boolean;
  error?: string;
}

/**
 * 组合：二值蒙版 → { region（外扩后的外接框，未带 mask.storageKey）, maskRgba（与框同尺寸的 alpha 蒙版）}。
 * PNG 编码（encodeAlphaMaskPng）与写入 workflowMediaStorage 由有副作用的那一层（弹层）完成。
 */
export function regionFromMask(
  mask: ArrayLike<number>,
  width: number,
  height: number,
  options: { padRatio?: number; padMinPx?: number; feather?: number; pick?: WorkflowReferenceRegionPick } = {},
): RegionFromMaskResult {
  const box = maskBoundingBox(mask, width, height);
  if (!box) return { error: '没有选中任何主体，请换个位置点选' };
  const padded = padRegion(box, width, height, options.padRatio ?? 0.04, options.padMinPx ?? 8);
  if (!padded.region) return { error: padded.error || '选中的主体太小' };
  const region = padded.region;
  if (options.pick) {
    const checked = validateReferenceRegion({ ...region, pick: options.pick });
    if (checked.error) return { error: checked.error };
    if (checked.region?.pick) region.pick = checked.region.pick;
  }
  return {
    region,
    maskRgba: cropMaskToRegion(mask, width, height, region, { feather: options.feather }),
    coversBackground: (box.w * box.h) / (width * height) >= BACKGROUND_COVERAGE_HINT,
  };
}

/** 从模型输出的扁平候选数据（形状 [count, height, width]）里取第 index 个候选蒙版（视图，不复制）。 */
export function candidateMask(data: Uint8Array, index: number, width: number, height: number): Uint8Array {
  const size = width * height;
  if (index < 0 || (index + 1) * size > data.length) throw new Error('候选蒙版序号越界');
  return data.subarray(index * size, (index + 1) * size);
}

// ---- PNG 编码（RGBA，8bit，无滤波 + zlib 压缩；用 CompressionStream，主线程 / worker / Node 都可用）----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function zlibDeflate(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') throw new Error('当前环境不支持 CompressionStream，无法编码蒙版 PNG');
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  const reading = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  })();
  await writer.write(bytes as Uint8Array<ArrayBuffer>);
  await writer.close();
  await reading;
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + payload.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  for (let i = 0; i < 4; i += 1) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(chunk, 4, 8 + payload.length));
  return chunk;
}

/** RGBA alpha 蒙版 → PNG 字节（color type 6，保留 alpha）。调用方包成 `new Blob([bytes], { type: 'image/png' })`。 */
export async function encodeAlphaMaskPng(mask: RgbaMask): Promise<Uint8Array> {
  const { data, width, height } = mask;
  if (!(width > 0) || !(height > 0) || data.length !== width * height * 4) throw new Error('蒙版尺寸无效');
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // 滤波类型 None
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', await zlibDeflate(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
