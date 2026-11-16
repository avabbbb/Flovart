import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_COVERAGE_HINT,
  candidateMask,
  cropMaskToRegion,
  cycleCandidate,
  encodeAlphaMaskPng,
  maskBoundingBox,
  normalizePickPoints,
  padRegion,
  pickBestCandidate,
  regionFromMask,
  regionPixelRect,
  toSamPrompt,
} from '../components/workflow/subjectMask';
import { MAX_PICK_POINTS, referenceRegionKey, validateReferenceRegion } from '../components/workflow/referenceRegion';

/** 用字符画建蒙版：'#' = 主体。 */
function maskFrom(rows: string[]) {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8Array(width * height);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { data[y * width + x] = ch === '#' ? 1 : 0; }));
  return { data, width, height };
}

function alphaRows(mask: { data: Uint8ClampedArray; width: number; height: number }) {
  const rows: string[] = [];
  for (let y = 0; y < mask.height; y += 1) {
    let row = '';
    for (let x = 0; x < mask.width; x += 1) row += mask.data[(y * mask.width + x) * 4 + 3] === 255 ? '#' : mask.data[(y * mask.width + x) * 4 + 3] === 0 ? '.' : '~';
    rows.push(row);
  }
  return rows;
}

describe('normalizePickPoints', () => {
  it('clamps, drops invalid, defaults label and dedupes (last wins)', () => {
    expect(normalizePickPoints([
      { x: -0.2, y: 1.5 },
      { x: Number.NaN, y: 0.5, label: 1 },
      { x: 0.3, y: 0.3, label: 1 },
      { x: 0.3, y: 0.3, label: 0 },
      { x: 0.123456, y: 0.5, label: 7 },
    ])).toEqual([
      { x: 0, y: 1, label: 1 },
      { x: 0.3, y: 0.3, label: 0 },
      { x: 0.1235, y: 0.5, label: 1 },
    ]);
    expect(normalizePickPoints(undefined)).toEqual([]);
  });

  it('keeps at most 16 points, newest last', () => {
    const points = Array.from({ length: 20 }, (_, i) => ({ x: i / 100, y: 0.5 }));
    const result = normalizePickPoints(points);
    expect(result).toHaveLength(MAX_PICK_POINTS);
    expect(result[0].x).toBe(0.04);
    expect(result[15].x).toBe(0.19);
  });
});

describe('toSamPrompt', () => {
  it('maps normalized points/box to reshaped [h,w] pixel coordinates', () => {
    const prompt = toSamPrompt([{ x: 0.5, y: 0.25, label: 1 }, { x: 1, y: 0, label: 0 }], [512, 1024], { x: 0.1, y: 0.2, w: 0.5, h: 0.5 });
    expect(prompt.points).toEqual([512, 128, 1024, 0]);
    expect(prompt.labels).toEqual([1, 0]);
    expect(prompt.count).toBe(2);
    expect(prompt.box?.map(v => Math.round(v * 1000) / 1000)).toEqual([102.4, 102.4, 614.4, 358.4]);
  });

  it('omits a degenerate box and works with box only', () => {
    expect(toSamPrompt([], [100, 100], { x: 0.5, y: 0.5, w: 0, h: 0.2 }).box).toBeUndefined();
    expect(toSamPrompt([], [100, 200], { x: 0, y: 0, w: 1, h: 1 })).toEqual({ points: [], labels: [], count: 0, box: [0, 0, 200, 100] });
  });
});

describe('candidate selection', () => {
  it('picks the highest IoU and cycles', () => {
    expect(pickBestCandidate([0.88, 0.93, 0.98])).toBe(2);
    expect(pickBestCandidate([0.95, 0.93, 0.5])).toBe(0);
    expect(pickBestCandidate([Number.NaN, 0.2, 0.1])).toBe(1);
    expect(pickBestCandidate([])).toBe(0);
    expect(cycleCandidate(0, 3)).toBe(1);
    expect(cycleCandidate(2, 3)).toBe(0);
    expect(cycleCandidate(5, 0)).toBe(0);
  });

  it('slices one candidate out of [count,h,w] data', () => {
    const data = new Uint8Array([1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1]);
    expect([...candidateMask(data, 1, 2, 2)]).toEqual([0, 1, 1, 0]);
    expect(() => candidateMask(data, 3, 2, 2)).toThrow(/越界/);
  });
});

describe('maskBoundingBox', () => {
  it('handles single blob, multiple blobs, empty and edge-touching masks', () => {
    const single = maskFrom(['.....', '.##..', '.##..', '.....']);
    expect(maskBoundingBox(single.data, single.width, single.height)).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    const multi = maskFrom(['#....', '.....', '....#']);
    expect(maskBoundingBox(multi.data, multi.width, multi.height)).toEqual({ x: 0, y: 0, w: 5, h: 3 });
    const empty = maskFrom(['...', '...']);
    expect(maskBoundingBox(empty.data, empty.width, empty.height)).toBeNull();
    const edge = maskFrom(['....#', '....#']);
    expect(maskBoundingBox(edge.data, edge.width, edge.height)).toEqual({ x: 4, y: 0, w: 1, h: 2 });
    expect(() => maskBoundingBox(new Uint8Array(3), 2, 2)).toThrow(/长度/);
  });
});

describe('padRegion', () => {
  it('pads by 4% of the box (at least 8px) and normalizes', () => {
    // 1000x500 图，框 400x200 @ (300,100)：4% = 16px / 8px
    expect(padRegion({ x: 300, y: 100, w: 400, h: 200 }, 1000, 500).region).toEqual({ x: 0.284, y: 0.184, w: 0.432, h: 0.432 });
    // 小框：至少 8px
    expect(padRegion({ x: 100, y: 100, w: 50, h: 50 }, 1000, 1000).region).toEqual({ x: 0.092, y: 0.092, w: 0.066, h: 0.066 });
  });

  it('never exceeds the image bounds and passes validateReferenceRegion', () => {
    const { region } = padRegion({ x: 0, y: 490, w: 1000, h: 10 }, 1000, 500);
    expect(region).toEqual({ x: 0, y: 0.964, w: 1, h: 0.036 });
    expect(validateReferenceRegion(region).region).toEqual(region);
  });

  it('rejects regions that are too small', () => {
    expect(padRegion({ x: 0, y: 0, w: 1, h: 1 }, 10000, 10000, 0.04, 0).error).toMatch(/太小/);
    expect(padRegion({ x: 0, y: 0, w: 1, h: 1 }, 0, 10).error).toMatch(/尺寸/);
  });
});

describe('cropMaskToRegion', () => {
  const mask = maskFrom([
    '..........',
    '..........',
    '...###....',
    '...####...',
    '....##....',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
  ]);

  it('outputs a region-sized RGBA alpha mask (alpha 0/255, white) at the right offset', () => {
    const region = { x: 0.2, y: 0.1, w: 0.6, h: 0.5 };
    const rgba = cropMaskToRegion(mask.data, mask.width, mask.height, region);
    expect(regionPixelRect(region, 10, 10)).toEqual({ x: 2, y: 1, w: 6, h: 5 });
    expect({ width: rgba.width, height: rgba.height }).toEqual({ width: 6, height: 5 });
    expect(alphaRows(rgba)).toEqual(['......', '.###..', '.####.', '..##..', '......']);
    for (let i = 0; i < rgba.data.length; i += 4) {
      expect([rgba.data[i], rgba.data[i + 1], rgba.data[i + 2]]).toEqual([255, 255, 255]);
      expect([0, 255]).toContain(rgba.data[i + 3]);
    }
  });

  it('feathering produces intermediate alpha on edges only', () => {
    const rgba = cropMaskToRegion(mask.data, mask.width, mask.height, { x: 0, y: 0, w: 1, h: 1 }, { feather: 1 });
    const alpha = (x: number, y: number) => rgba.data[(y * 10 + x) * 4 + 3];
    expect(alpha(0, 9)).toBe(0); // 远离主体
    expect(alpha(4, 3)).toBeGreaterThan(alpha(3, 2)); // 越靠主体内部 alpha 越高
    expect(alpha(3, 2)).toBeGreaterThan(0);
    expect(alpha(3, 2)).toBeLessThan(255); // 边缘过渡
  });
});

describe('regionFromMask', () => {
  it('combines bbox → padded region → region-sized alpha mask', () => {
    const big = new Uint8Array(200 * 100);
    for (let y = 40; y < 60; y += 1) for (let x = 50; x < 90; x += 1) big[y * 200 + x] = 1;
    const result = regionFromMask(big, 200, 100, { pick: { points: [{ x: 0.35, y: 0.5, label: 1 }], candidate: 2, engine: 'slimsam-77-uniform' } });
    expect(result.error).toBeUndefined();
    expect(result.region).toEqual({ x: 0.21, y: 0.32, w: 0.28, h: 0.36, pick: { points: [{ x: 0.35, y: 0.5, label: 1 }], candidate: 2, engine: 'slimsam-77-uniform' } });
    expect({ w: result.maskRgba?.width, h: result.maskRgba?.height }).toEqual({ w: 56, h: 36 });
    expect(result.coversBackground).toBe(false);
    // 主体在蒙版里的位置：原图 (50,40) → 框内 (8,8)
    const alpha = (x: number, y: number) => result.maskRgba!.data[(y * 56 + x) * 4 + 3];
    expect(alpha(8, 8)).toBe(255);
    expect(alpha(7, 8)).toBe(0);
    expect(alpha(47, 27)).toBe(255);
    expect(alpha(48, 27)).toBe(0);
  });

  it('reports empty masks and background-like selections', () => {
    expect(regionFromMask(new Uint8Array(100), 10, 10).error).toMatch(/没有选中/);
    const all = new Uint8Array(100).fill(1);
    const result = regionFromMask(all, 10, 10);
    expect(result.region).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(result.coversBackground).toBe(true);
    expect(BACKGROUND_COVERAGE_HINT).toBeGreaterThan(0.5);
  });

  it('rejects an invalid pick', () => {
    const all = new Uint8Array(100).fill(1);
    expect(regionFromMask(all, 10, 10, { pick: { points: [{ x: 2, y: 0, label: 1 }] } }).error).toMatch(/pick/);
  });
});

describe('encodeAlphaMaskPng', () => {
  it('writes a valid RGBA PNG whose alpha matches the mask', async () => {
    const rgba = cropMaskToRegion(maskFrom(['.#', '#.']).data, 2, 2, { x: 0, y: 0, w: 1, h: 1 });
    const png = await encodeAlphaMaskPng(rgba);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect([view.getUint32(16), view.getUint32(20), png[24], png[25]]).toEqual([2, 2, 8, 6]);
    const idatLength = view.getUint32(33);
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe('IDAT');
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    // 每行：滤波字节 0 + RGBA
    expect([...raw]).toEqual([0, 255, 255, 255, 0, 255, 255, 255, 255, 0, 255, 255, 255, 255, 255, 255, 255, 0]);
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe('IEND');
  });

  it('rejects inconsistent sizes', async () => {
    await expect(encodeAlphaMaskPng({ data: new Uint8ClampedArray(3), width: 1, height: 1 })).rejects.toThrow(/尺寸/);
  });
});

describe('validateReferenceRegion · pick', () => {
  const base = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };

  it('accepts and normalizes pick, dropping unknown fields', () => {
    const { region } = validateReferenceRegion({
      ...base,
      mask: { storageKey: 'workflow-mask-1' },
      pick: { points: [{ x: 0.123456, y: 0.5 }, { x: 0.2, y: 0.3, label: 0 }], box: { x: 0.5, y: 0.5, w: 0.8, h: 0.2 }, candidate: 1, engine: ' slimsam ', extra: 1 },
    });
    expect(region?.pick).toEqual({
      points: [{ x: 0.1235, y: 0.5, label: 1 }, { x: 0.2, y: 0.3, label: 0 }],
      box: { x: 0.5, y: 0.5, w: 0.5, h: 0.2 },
      candidate: 1,
      engine: 'slimsam',
    });
    expect(validateReferenceRegion({ ...base, pick: null }).region).toEqual(base);
    expect(validateReferenceRegion({ ...base, pick: { points: [] } }).region?.pick).toEqual({ points: [] });
  });

  it('enforces the point limit and rejects invalid points', () => {
    const points = Array.from({ length: MAX_PICK_POINTS + 1 }, () => ({ x: 0.5, y: 0.5 }));
    expect(validateReferenceRegion({ ...base, pick: { points } }).error).toMatch(/最多 16/);
    expect(validateReferenceRegion({ ...base, pick: { points: points.slice(0, 16) } }).region?.pick?.points).toHaveLength(16);
    expect(validateReferenceRegion({ ...base, pick: 'x' }).error).toMatch(/pick/);
    expect(validateReferenceRegion({ ...base, pick: {} }).error).toMatch(/points/);
    expect(validateReferenceRegion({ ...base, pick: { points: [null] } }).error).toMatch(/每一项/);
    expect(validateReferenceRegion({ ...base, pick: { points: [{ x: 1.2, y: 0 }] } }).error).toMatch(/0-1/);
    expect(validateReferenceRegion({ ...base, pick: { points: [{ x: 'a', y: 0 }] } }).error).toMatch(/0-1/);
    expect(validateReferenceRegion({ ...base, pick: { points: [{ x: 0, y: 0, label: 2 }] } }).error).toMatch(/label/);
    expect(validateReferenceRegion({ ...base, pick: { points: [], box: { x: 0, y: 0, w: 0, h: 1 } } }).error).toMatch(/box/);
    expect(validateReferenceRegion({ ...base, pick: { points: [], candidate: -1 } }).error).toMatch(/candidate/);
    expect(validateReferenceRegion({ ...base, pick: { points: [], candidate: 1.5 } }).error).toMatch(/candidate/);
  });

  it('keeps pick out of the identity key', () => {
    const withMask = { ...base, mask: { storageKey: 'workflow-mask-1' } };
    const picked = validateReferenceRegion({ ...withMask, pick: { points: [{ x: 0.3, y: 0.3 }] } }).region;
    const repicked = validateReferenceRegion({ ...withMask, pick: { points: [{ x: 0.4, y: 0.4, label: 0 }], candidate: 2 } }).region;
    expect(referenceRegionKey(picked)).toBe(referenceRegionKey(withMask));
    expect(referenceRegionKey(repicked)).toBe('0.1,0.1,0.5,0.5;m:workflow-mask-1');
  });
});
