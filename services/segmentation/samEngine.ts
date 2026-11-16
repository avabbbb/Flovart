// SlimSAM 分割引擎（在 Web Worker 里运行）：两段式——embed(image) 每张图算一次（LRU 3 张），
// decode(points, box?) 每次点击都跑。transformers.js 由调用方注入（worker 里懒加载，测试里注入假实现），
// 本模块不静态 import 它，保证不进主 chunk。
import { toSamPrompt, type NormalizedBox, type PickPoint } from '../../components/workflow/subjectMask';
import { defaultOnnxWasmBaseUrl, onnxWasmPaths, segmentationLoadOptions, type SegmentationDevice, type SegmentationRuntimeConfig } from './segmentationConfig';

/** 用到的 transformers.js 子集（类型只描述本模块真正调用的部分）。 */
export interface TransformersLike {
  env: {
    remoteHost: string;
    allowLocalModels: boolean;
    allowRemoteModels?: boolean;
    backends: { onnx: { wasm?: { wasmPaths?: unknown }; versions?: { web?: string } } };
  };
  SamModel: { from_pretrained(id: string, options: Record<string, unknown>): Promise<SamModelLike> };
  AutoProcessor: { from_pretrained(id: string, options: Record<string, unknown>): Promise<SamProcessorLike> };
  RawImage: { fromBlob(blob: Blob): Promise<unknown> };
  Tensor: new (type: string, data: unknown, dims: number[]) => unknown;
}

interface TensorLike { data: ArrayLike<number> | ArrayLike<bigint>; dims: number[] }
interface SamModelLike {
  get_image_embeddings(inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
  (inputs: Record<string, unknown>): Promise<{ pred_masks: unknown; iou_scores: TensorLike }>;
  dispose?: () => Promise<unknown> | unknown;
}
interface SamProcessorLike {
  (image: unknown): Promise<{ original_sizes: [number, number][]; reshaped_input_sizes: [number, number][] } & Record<string, unknown>>;
  post_process_masks(masks: unknown, original: [number, number][], reshaped: [number, number][]): Promise<TensorLike[]>;
}

export interface SamProgress { file?: string; loaded?: number; total?: number; status?: string }

export interface SegmentResult {
  /** 每个候选一张二值蒙版（原图分辨率，行优先，非 0 = 主体）。 */
  masks: Uint8Array[];
  /** 每个候选的 IoU 预测分数。 */
  scores: number[];
  width: number;
  height: number;
}

interface EmbeddingEntry {
  embeddings: Record<string, unknown>;
  originalSizes: [number, number][];
  reshapedSizes: [number, number][];
}

export const EMBEDDING_CACHE_LIMIT = 3;

/** WebGPU 可用性（worker / 主线程都能调）：有 navigator.gpu 且能拿到 adapter。 */
export async function detectWebGpu(nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined): Promise<boolean> {
  const gpu = (nav as { gpu?: { requestAdapter?: () => Promise<unknown> } } | undefined)?.gpu;
  if (!gpu?.requestAdapter) return false;
  try { return !!(await gpu.requestAdapter()); } catch { return false; }
}

export function createSamEngine(
  loadLibrary: () => Promise<TransformersLike>,
  config: SegmentationRuntimeConfig,
  options: { detectDevice?: () => Promise<boolean>; onProgress?: (progress: SamProgress) => void } = {},
) {
  let loading: Promise<{ lib: TransformersLike; model: SamModelLike; processor: SamProcessorLike; device: SegmentationDevice }> | null = null;
  const cache = new Map<string, EmbeddingEntry>();
  let anonymousCounter = 0;

  const load = () => {
    if (!loading) {
      loading = (async () => {
        const lib = await loadLibrary();
        lib.env.remoteHost = config.modelBaseUrl;
        lib.env.allowLocalModels = false;
        const progress_callback = (info: SamProgress) => options.onProgress?.(info);
        const preferGpu = await (options.detectDevice || detectWebGpu)();
        const devices: SegmentationDevice[] = preferGpu ? ['webgpu', 'wasm'] : ['wasm'];
        // 在创建任何 ORT 会话之前定下 wasm 文件：没有 WebGPU 时用普通版（约 14.3 MB），不再拉 26.9 MB 的 asyncify 版。
        // 有 WebGPU 时用 asyncify 版；WebGPU 失败退回 WASM 时 asyncify 版同样能跑 WASM 执行器，不用重新下载。
        const wasm = lib.env.backends.onnx.wasm;
        if (wasm) {
          const paths = onnxWasmPaths(devices[0], config.wasmBaseUrl || defaultOnnxWasmBaseUrl(lib.env.backends.onnx.versions?.web));
          if (paths) wasm.wasmPaths = paths;
        }
        const processor = await lib.AutoProcessor.from_pretrained(config.modelId, { progress_callback });
        let lastError: unknown;
        for (const device of devices) {
          try {
            const model = await lib.SamModel.from_pretrained(config.modelId, { ...segmentationLoadOptions(device), progress_callback });
            return { lib, model, processor, device };
          } catch (error) {
            lastError = error; // WebGPU 失败时退回 WASM
          }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
      })();
      loading.catch(() => { loading = null; }); // 下载失败后允许重试
    }
    return loading;
  };

  const embed = async (image: Blob, imageKey?: string): Promise<{ key: string; entry: EmbeddingEntry }> => {
    const key = imageKey || `anonymous:${anonymousCounter += 1}`;
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached); // 刷新 LRU 顺序
      return { key, entry: cached };
    }
    const { lib, model, processor } = await load();
    const rawImage = await lib.RawImage.fromBlob(image);
    const inputs = await processor(rawImage);
    const embeddings = await model.get_image_embeddings(inputs);
    const entry: EmbeddingEntry = { embeddings, originalSizes: inputs.original_sizes, reshapedSizes: inputs.reshaped_input_sizes };
    if (imageKey) {
      cache.set(key, entry);
      while (cache.size > EMBEDDING_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    }
    return { key, entry };
  };

  return {
    /** 预热：加载模型并（给了图时）提前算 embedding。返回实际使用的设备。 */
    async prepare(image?: Blob, imageKey?: string): Promise<{ device: SegmentationDevice }> {
      const { device } = await load();
      if (image) await embed(image, imageKey);
      return { device };
    },

    async segment(image: Blob, points: PickPoint[], extra: { box?: NormalizedBox | null; imageKey?: string } = {}): Promise<SegmentResult> {
      const { lib, model, processor } = await load();
      const { entry } = await embed(image, extra.imageKey);
      const reshaped = entry.reshapedSizes[0];
      const prompt = toSamPrompt(points, reshaped, extra.box);
      if (!prompt.count && !prompt.box) throw new Error('至少需要一个点或一个框');
      const inputs: Record<string, unknown> = { ...entry.embeddings };
      if (prompt.count) {
        inputs.input_points = new lib.Tensor('float32', Float32Array.from(prompt.points), [1, 1, prompt.count, 2]);
        inputs.input_labels = new lib.Tensor('int64', BigInt64Array.from(prompt.labels.map(label => BigInt(label))), [1, 1, prompt.count]);
      }
      if (prompt.box) inputs.input_boxes = new lib.Tensor('float32', Float32Array.from(prompt.box), [1, 1, 4]);
      const outputs = await model(inputs);
      const [masks] = await processor.post_process_masks(outputs.pred_masks, entry.originalSizes, entry.reshapedSizes);
      const [height, width] = entry.originalSizes[0];
      const count = masks.dims[1] ?? 1;
      const size = width * height;
      const data = masks.data as ArrayLike<number>;
      const result: Uint8Array[] = [];
      for (let index = 0; index < count; index += 1) {
        const mask = new Uint8Array(size);
        for (let i = 0; i < size; i += 1) mask[i] = data[index * size + i] ? 1 : 0;
        result.push(mask);
      }
      const scores = Array.from(outputs.iou_scores.data as ArrayLike<number>, Number).slice(0, count);
      return { masks: result, scores, width, height };
    },

    async dispose() {
      cache.clear();
      const current = loading;
      loading = null;
      if (current) {
        try { await (await current).model.dispose?.(); } catch { /* 释放失败不影响后续重建 */ }
      }
    },
  };
}

export type SamEngine = ReturnType<typeof createSamEngine>;
