import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateImageWithProvider, routeMinPixels, sizeFromAspectRatio } from '../services/aiGateway';
import { getRouteSchema } from '../services/runningHubRouteCatalog';
import { getProductModel } from '../services/productModelCatalog';

// 2026-11-15 评测：Seedream 输出比例不稳定。根因是同时发了 resolution（官方：优先级高于 width/height），
// 宽高被忽略；另外旧换算按 16 取整，3:2、21:9 等比例并不精确。
const FLASH = 'seedream-v5-flash/text-to-image';
const V45 = 'seedream-v4.5/text-to-image';

const FLASH_2K: Record<string, [number, number]> = {
  '1:1': [2048, 2048],
  '16:9': [2048, 1152],
  '9:16': [1152, 2048],
  '4:3': [2048, 1536],
  '3:4': [1536, 2048],
  '3:2': [2046, 1364],
  '2:3': [1364, 2046],
  '21:9': [2044, 876],
};
// 2026-11-16 实测：RunningHub Seedream 5 Flash 要求面积 ≥ 921600（1024×576 被 1007 拒绝）。
// 1K 时长边按 1024 取；面积不够就保持比例放大到刚好达标。
const FLASH_1K: Record<string, [number, number]> = {
  '1:1': [1024, 1024],
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '4:3': [1112, 834],
  '3:4': [834, 1112],
  '3:2': [1176, 784],
  '2:3': [784, 1176],
  '21:9': [1470, 630],
};
const FLASH_MIN_PIXELS = 921_600;
const V45_2K: Record<string, [number, number]> = {
  '1:1': [2048, 2048],
  '16:9': [2048, 1152],
  '9:16': [1152, 2048],
  '4:3': [2048, 1536],
  '3:4': [1536, 2048],
  '3:2': [2040, 1360],
  '2:3': [1360, 2040],
  '21:9': [2016, 864],
};

function ratioOf(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number);
  return w / h;
}

describe('Seedream width/height sizing', () => {
  it('covers every aspect ratio the product exposes for Seedream 5 Flash', () => {
    const ratios = getProductModel('flovart:seedream-5-flash')?.capabilities.aspectRatios ?? [];
    expect(ratios.length).toBeGreaterThan(0);
    for (const ratio of ratios) expect(FLASH_2K[ratio], ratio).toBeDefined();
  });

  for (const [routeId, table, resolution] of [
    [FLASH, FLASH_2K, undefined],
    [FLASH, FLASH_2K, '2K'],
    [FLASH, FLASH_1K, '1K'],
    [V45, V45_2K, undefined],
  ] as const) {
    const schema = getRouteSchema(routeId)!;
    for (const [ratio, [width, height]] of Object.entries(table)) {
      it(`${routeId} ${ratio}${resolution ? ` @${resolution}` : ''} → ${width}x${height} (exact ratio, within schema)`, () => {
        const size = sizeFromAspectRatio(ratio, schema.params, resolution, routeMinPixels(routeId));
        expect(size).toEqual({ width, height });
        if (routeId === FLASH) expect(width * height).toBeGreaterThanOrEqual(FLASH_MIN_PIXELS);
        expect(width * Number(ratio.split(':')[1])).toBe(height * Number(ratio.split(':')[0]));
        expect(Math.abs(width / height - ratioOf(ratio))).toBeLessThan(1e-9);
        const w = schema.params.find(p => p.field === 'width')!;
        expect(width).toBeGreaterThanOrEqual(w.minimum!);
        expect(height).toBeGreaterThanOrEqual(w.minimum!);
        expect(width % w.multipleOf!).toBe(0);
        expect(height % w.multipleOf!).toBe(0);
      });
    }
  }
});

describe('Seedream request body sent to RunningHub', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function submittedBody(routeId: string, aspectRatio?: string, resolution?: string): Promise<Record<string, unknown>> {
    vi.useFakeTimers();
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    let body: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith(`/${routeId}`)) {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ taskId: 'rh-seedream-1', status: 'RUNNING', errorCode: '', errorMessage: '' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/query')) {
        return new Response(JSON.stringify({ taskId: 'rh-seedream-1', status: 'SUCCESS', errorCode: '', errorMessage: '', results: [{ url: 'https://rh-images.example.com/out.png', outputType: 'png' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }));
    const pending = generateImageWithProvider('a lighthouse at dusk', routeId, {
      id: 'k1', provider: 'runningHub', key: 'rh-secret', name: 'RH', status: 'ok',
    } as never, [], { aspectRatio: aspectRatio as never, resolution });
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(body).not.toBeNull();
    return body!;
  }

  for (const [ratio, [width, height]] of Object.entries(FLASH_2K)) {
    it(`seedream 5 flash ${ratio} sends exact width/height and no resolution`, async () => {
      const body = await submittedBody(FLASH, ratio);
      expect(body.width).toBe(width);
      expect(body.height).toBe(height);
      // resolution 优先级高于宽高，必须不发
      expect(body).not.toHaveProperty('resolution');
      expect(body.prompt).toBe('a lighthouse at dusk');
    });
  }

  it('1K + 16:9 meets the RunningHub minimum area instead of sending 1024x576 (→ 1280x720)', async () => {
    const body = await submittedBody(FLASH, '16:9', '1K');
    expect(body).toMatchObject({ width: 1280, height: 720 });
    expect(Number(body.width) * Number(body.height)).toBeGreaterThanOrEqual(FLASH_MIN_PIXELS);
    expect(body).not.toHaveProperty('resolution');
  });

  it('seedream 4.5 3:2 sends multiple-of-8 exact size', async () => {
    const body = await submittedBody(V45, '3:2');
    expect(body).toMatchObject({ width: 2040, height: 1360 });
    expect(body).not.toHaveProperty('resolution');
  });

  it('without an aspect ratio keeps the documented default (resolution 2k)', async () => {
    const body = await submittedBody(FLASH, undefined);
    expect(body.resolution).toBe('2k');
  });
});
