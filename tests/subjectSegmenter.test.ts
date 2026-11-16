import { describe, expect, it, vi } from 'vitest';
import { createSamEngine, detectWebGpu, EMBEDDING_CACHE_LIMIT, type TransformersLike } from '../services/segmentation/samEngine';
import {
  DEFAULT_SEGMENTATION_MODEL_BASE_URL,
  normalizeBaseUrl,
  resolveSegmentationConfig,
  segmentationLoadOptions,
} from '../services/segmentation/segmentationConfig';
import { createSubjectSegmenter, SegmentationError, type WorkerLike } from '../services/segmentation/subjectSegmenter';
import type { SamWorkerRequest, SamWorkerResponse } from '../services/segmentation/samWorker';

describe('segmentationConfig', () => {
  it('normalizes base urls and falls back to the HF default', () => {
    expect(normalizeBaseUrl('https://hf-mirror.com')).toBe('https://hf-mirror.com/');
    expect(normalizeBaseUrl(' /models ')).toBe('/models/');
    expect(normalizeBaseUrl('ftp://x')).toBeUndefined();
    expect(normalizeBaseUrl('not a url')).toBeUndefined();
    expect(resolveSegmentationConfig().modelBaseUrl).toBe(DEFAULT_SEGMENTATION_MODEL_BASE_URL);
    expect(resolveSegmentationConfig({ modelBaseUrl: 'https://hf-mirror.com' })).toEqual({ modelId: 'Xenova/slimsam-77-uniform', modelBaseUrl: 'https://hf-mirror.com/' });
    expect(resolveSegmentationConfig({ modelBaseUrl: 'javascript:alert(1)' }).modelBaseUrl).toBe(DEFAULT_SEGMENTATION_MODEL_BASE_URL);
    expect(resolveSegmentationConfig({ wasmBaseUrl: 'https://cdn.example.com/ort' }).wasmBaseUrl).toBe('https://cdn.example.com/ort/');
  });

  it('picks per-device model files', () => {
    expect(segmentationLoadOptions('webgpu').device.vision_encoder).toBe('webgpu');
    expect(segmentationLoadOptions('webgpu').dtype.prompt_encoder_mask_decoder).toBe('q8');
    expect(segmentationLoadOptions('wasm')).toEqual({
      device: { vision_encoder: 'wasm', prompt_encoder_mask_decoder: 'wasm' },
      dtype: { vision_encoder: 'q8', prompt_encoder_mask_decoder: 'q8' },
    });
  });

  it('detects WebGPU only when an adapter is available', async () => {
    expect(await detectWebGpu({})).toBe(false);
    expect(await detectWebGpu({ gpu: { requestAdapter: async () => null } })).toBe(false);
    expect(await detectWebGpu({ gpu: { requestAdapter: async () => ({}) } })).toBe(true);
    expect(await detectWebGpu({ gpu: { requestAdapter: async () => { throw new Error('x'); } } })).toBe(false);
  });
});

/** 假的 transformers.js：原图 4x2，reshaped 8x4（[h,w] = [4,8]），3 个候选。 */
function fakeTransformers(options: { failWebGpu?: boolean } = {}) {
  const calls = { embed: 0, loads: [] as string[], lastInputs: undefined as Record<string, unknown> | undefined };
  const env = { remoteHost: '', allowLocalModels: true, backends: { onnx: { wasm: { wasmPaths: undefined as unknown } } } };
  class Tensor { constructor(public type: string, public data: unknown, public dims: number[]) {} }
  const model = Object.assign(async (inputs: Record<string, unknown>) => {
    calls.lastInputs = inputs;
    return { pred_masks: 'raw', iou_scores: { data: new Float32Array([0.5, 0.9, 0.7]), dims: [1, 1, 3] } };
  }, {
    get_image_embeddings: async () => { calls.embed += 1; return { image_embeddings: 'E', image_positional_embeddings: 'P' }; },
    dispose: vi.fn(),
  });
  const processor = Object.assign(async () => ({ pixel_values: 'px', original_sizes: [[2, 4]] as [number, number][], reshaped_input_sizes: [[4, 8]] as [number, number][] }), {
    post_process_masks: async () => [{
      dims: [1, 3, 2, 4],
      data: new Uint8Array([
        1, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 0, 0, 1, 1, 0,
        1, 1, 1, 1, 1, 1, 1, 1,
      ]),
    }],
  });
  const lib: TransformersLike = {
    env,
    Tensor: Tensor as unknown as TransformersLike['Tensor'],
    RawImage: { fromBlob: async () => 'raw-image' },
    AutoProcessor: { from_pretrained: async () => processor as never },
    SamModel: {
      from_pretrained: async (_id: string, opts: Record<string, unknown>) => {
        const device = (opts.device as { vision_encoder: string }).vision_encoder;
        calls.loads.push(device);
        if (device === 'webgpu' && options.failWebGpu) throw new Error('no webgpu');
        return model as never;
      },
    },
  };
  return { lib, calls, env, model };
}

describe('samEngine (fake transformers)', () => {
  const blob = new Blob(['img']);

  it('configures the model host, builds prompts in reshaped space and returns per-candidate masks', async () => {
    const fake = fakeTransformers();
    const engine = createSamEngine(async () => fake.lib, { modelId: 'Xenova/slimsam-77-uniform', modelBaseUrl: 'https://hf-mirror.com/', wasmBaseUrl: '/ort/' }, { detectDevice: async () => false });
    const result = await engine.segment(blob, [{ x: 0.5, y: 0.5, label: 1 }, { x: 0, y: 1, label: 0 }], { box: { x: 0, y: 0, w: 0.5, h: 1 } });
    expect(fake.env.remoteHost).toBe('https://hf-mirror.com/');
    expect(fake.env.allowLocalModels).toBe(false);
    expect(fake.env.backends.onnx.wasm.wasmPaths).toBe('/ort/');
    expect(fake.calls.loads).toEqual(['wasm']);
    const inputs = fake.calls.lastInputs as Record<string, { type: string; data: ArrayLike<number | bigint>; dims: number[] }>;
    expect(inputs.image_embeddings).toBe('E');
    expect(inputs.input_points.dims).toEqual([1, 1, 2, 2]);
    expect([...(inputs.input_points.data as Float32Array)]).toEqual([4, 2, 0, 4]);
    expect(inputs.input_labels.type).toBe('int64');
    expect([...(inputs.input_labels.data as BigInt64Array)]).toEqual([1n, 0n]);
    expect([...(inputs.input_boxes.data as Float32Array)]).toEqual([0, 0, 4, 4]);
    expect(result.width).toBe(4);
    expect(result.height).toBe(2);
    expect(result.scores.map(s => Math.round(s * 10) / 10)).toEqual([0.5, 0.9, 0.7]);
    expect(result.masks.map(mask => [...mask])).toEqual([[1, 0, 0, 0, 0, 0, 0, 0], [0, 1, 1, 0, 0, 1, 1, 0], [1, 1, 1, 1, 1, 1, 1, 1]]);
  });

  it('falls back from WebGPU to WASM and caches embeddings per imageKey (LRU)', async () => {
    const fake = fakeTransformers({ failWebGpu: true });
    const engine = createSamEngine(async () => fake.lib, resolveSegmentationConfig(), { detectDevice: async () => true });
    expect(await engine.prepare()).toEqual({ device: 'wasm' });
    expect(fake.calls.loads).toEqual(['webgpu', 'wasm']);
    await engine.segment(blob, [{ x: 0.1, y: 0.1, label: 1 }], { imageKey: 'a' });
    await engine.segment(blob, [{ x: 0.2, y: 0.1, label: 1 }], { imageKey: 'a' });
    expect(fake.calls.embed).toBe(1);
    for (const key of ['b', 'c', 'd']) await engine.segment(blob, [{ x: 0.1, y: 0.1, label: 1 }], { imageKey: key });
    expect(fake.calls.embed).toBe(1 + EMBEDDING_CACHE_LIMIT);
    await engine.segment(blob, [{ x: 0.1, y: 0.1, label: 1 }], { imageKey: 'a' }); // a 已被挤出
    expect(fake.calls.embed).toBe(2 + EMBEDDING_CACHE_LIMIT);
    await engine.segment(blob, [{ x: 0.1, y: 0.1, label: 1 }]); // 无 key 不缓存
    await engine.segment(blob, [{ x: 0.1, y: 0.1, label: 1 }]);
    expect(fake.calls.embed).toBe(4 + EMBEDDING_CACHE_LIMIT);
  });

  it('requires a point or box, retries loading after failure and disposes the model', async () => {
    const fake = fakeTransformers();
    let attempts = 0;
    const engine = createSamEngine(async () => { attempts += 1; if (attempts === 1) throw new Error('network'); return fake.lib; }, resolveSegmentationConfig(), { detectDevice: async () => false });
    await expect(engine.prepare()).rejects.toThrow('network');
    await expect(engine.segment(blob, [])).rejects.toThrow(/至少需要/);
    await engine.dispose();
    expect(fake.model.dispose).toHaveBeenCalled();
  });
});

/** 假 worker：按请求类型回消息；可以设定为挂起或崩溃。 */
function fakeWorker(behavior: { mode?: 'ok' | 'hang' | 'error' | 'crash' } = {}) {
  const sent: SamWorkerRequest[] = [];
  const worker: WorkerLike & { terminated: boolean } = {
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(message) {
      sent.push(message);
      const reply = (data: SamWorkerResponse) => queueMicrotask(() => worker.onmessage?.({ data } as MessageEvent<SamWorkerResponse>));
      if (message.type === 'dispose') return;
      const mode = behavior.mode || 'ok';
      if (mode === 'hang') return;
      if (mode === 'crash') { queueMicrotask(() => worker.onerror?.({ message: 'boom' } as ErrorEvent)); return; }
      if (mode === 'error') { reply({ id: message.id, type: 'error', message: '下载失败' }); return; }
      reply({ id: message.id, type: 'progress', progress: { file: 'onnx/vision_encoder_quantized.onnx', loaded: 10, total: 100 } });
      if (message.type === 'prepare') reply({ id: message.id, type: 'prepared', device: 'wasm' });
      else reply({ id: message.id, type: 'result', result: { masks: [new Uint8Array([1, 0]), new Uint8Array([1, 1])], scores: [0.4, 0.8], width: 2, height: 1 } });
    },
    terminate() { worker.terminated = true; },
  };
  return { worker, sent };
}

describe('subjectSegmenter client (mocked worker)', () => {
  const env = { hasWorker: true, hasWebAssembly: true, hasWebGpu: false };
  const blob = new Blob(['img']);

  it('reports availability with a reason', async () => {
    expect(await createSubjectSegmenter({ environment: { ...env, hasWorker: false } }).checkAvailability()).toEqual({ available: false, reason: expect.stringMatching(/Worker/) });
    expect(await createSubjectSegmenter({ environment: { ...env, hasWebAssembly: false } }).isAvailable()).toBe(false);
    expect(await createSubjectSegmenter({ environment: { ...env, hasWebGpu: true } }).checkAvailability()).toEqual({ available: true, preferredDevice: 'webgpu' });
    const unavailable = createSubjectSegmenter({ environment: { ...env, hasWorker: false } });
    await expect(unavailable.segment(blob, [{ x: 0.5, y: 0.5 }])).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
  });

  it('lazily creates the worker, forwards progress, normalizes points and returns the result', async () => {
    const { worker, sent } = fakeWorker();
    const createWorker = vi.fn(() => worker);
    const segmenter = createSubjectSegmenter({ environment: env, createWorker, config: { modelBaseUrl: 'https://hf-mirror.com/' } });
    expect(createWorker).not.toHaveBeenCalled();
    const progress = vi.fn();
    const result = await segmenter.segment(blob, [{ x: 1.4, y: 0.5 }, { x: 0.2, y: 0.2, label: 0 }], { imageKey: 'node-1@2x1', onProgress: progress, box: { x: 0, y: 0, w: 1, h: 1 } });
    expect(result.scores).toEqual([0.4, 0.8]);
    expect(progress).toHaveBeenCalledWith({ file: 'onnx/vision_encoder_quantized.onnx', loaded: 10, total: 100 });
    expect(sent[0]).toMatchObject({ type: 'segment', imageKey: 'node-1@2x1', points: [{ x: 1, y: 0.5, label: 1 }, { x: 0.2, y: 0.2, label: 0 }], box: { x: 0, y: 0, w: 1, h: 1 }, config: { modelBaseUrl: 'https://hf-mirror.com/' } });
    expect(await segmenter.prepare(blob)).toEqual({ device: 'wasm' });
    expect(createWorker).toHaveBeenCalledTimes(1);
    await expect(segmenter.segment(blob, [])).rejects.toThrow(/至少需要/);
  });

  it('surfaces worker errors as SEGMENTATION_FAILED', async () => {
    const { worker } = fakeWorker({ mode: 'error' });
    const segmenter = createSubjectSegmenter({ environment: env, createWorker: () => worker });
    const error = await segmenter.prepare().catch(e => e);
    expect(error).toBeInstanceOf(SegmentationError);
    expect(error.code).toBe('SEGMENTATION_FAILED');
    expect(error.message).toMatch(/下载失败/);
  });

  it('cancels via AbortSignal and ignores the late reply', async () => {
    const { worker } = fakeWorker({ mode: 'hang' });
    const segmenter = createSubjectSegmenter({ environment: env, createWorker: () => worker });
    const controller = new AbortController();
    const pending = segmenter.segment(blob, [{ x: 0.5, y: 0.5 }], { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    const aborted = new AbortController();
    aborted.abort();
    await expect(segmenter.segment(blob, [{ x: 0.5, y: 0.5 }], { signal: aborted.signal })).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('times out, terminates the stuck worker and rebuilds it on the next call', async () => {
    vi.useFakeTimers();
    try {
      const hung = fakeWorker({ mode: 'hang' });
      const healthy = fakeWorker();
      const createWorker = vi.fn().mockReturnValueOnce(hung.worker).mockReturnValueOnce(healthy.worker);
      const segmenter = createSubjectSegmenter({ environment: env, createWorker, loadTimeoutMs: 1000 });
      const pending = segmenter.segment(blob, [{ x: 0.5, y: 0.5 }]);
      const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT', message: expect.stringMatching(/加载主体分割模型超时/) });
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
      expect(hung.worker.terminated).toBe(true);
      vi.useRealTimers();
      expect((await segmenter.segment(blob, [{ x: 0.5, y: 0.5 }])).width).toBe(2);
      expect(createWorker).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers after a worker crash', async () => {
    const crashed = fakeWorker({ mode: 'crash' });
    const healthy = fakeWorker();
    const createWorker = vi.fn().mockReturnValueOnce(crashed.worker).mockReturnValueOnce(healthy.worker);
    const segmenter = createSubjectSegmenter({ environment: env, createWorker });
    await expect(segmenter.segment(blob, [{ x: 0.5, y: 0.5 }])).rejects.toMatchObject({ code: 'WORKER_CRASHED', message: expect.stringMatching(/boom/) });
    expect(crashed.worker.terminated).toBe(true);
    expect((await segmenter.segment(blob, [{ x: 0.5, y: 0.5 }])).height).toBe(1);
  });

  it('dispose rejects in-flight calls and terminates the worker', async () => {
    const { worker } = fakeWorker({ mode: 'hang' });
    const segmenter = createSubjectSegmenter({ environment: env, createWorker: () => worker });
    const pending = segmenter.prepare();
    await Promise.resolve();
    await Promise.resolve();
    segmenter.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    expect(worker.terminated).toBe(true);
  });
});
