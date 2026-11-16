// 点选主体的主线程客户端：懒创建分割 worker，提供 isAvailable / prepare / segment / dispose。
// 本文件不 import transformers.js；UI（M2 弹层）应再用 `await import('.../subjectSegmenter')` 懒加载本模块。
// 失败一律抛 SegmentationError（带 code），UI 据此退回「框选」，不静默降级。
import { normalizePickPoints, type NormalizedBox, type PickPoint } from '../../components/workflow/subjectMask';
import { SEGMENTATION_ENGINE_ID, type SegmentationDevice, type SegmentationRuntimeConfig } from './segmentationConfig';
import type { SamProgress, SegmentResult } from './samEngine';
import type { SamWorkerRequest, SamWorkerResponse } from './samWorker';

export type SegmentationErrorCode = 'CAPABILITY_UNAVAILABLE' | 'TIMEOUT' | 'ABORTED' | 'WORKER_CRASHED' | 'SEGMENTATION_FAILED';

export class SegmentationError extends Error {
  constructor(public readonly code: SegmentationErrorCode, message: string) {
    super(message);
    this.name = 'SegmentationError';
  }
}

export interface SegmenterAvailability { available: boolean; reason?: string; preferredDevice?: SegmentationDevice }

export interface WorkerLike {
  postMessage(message: SamWorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<SamWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent | Event) => void) | null;
}

export interface SubjectSegmenterOptions {
  /** 覆盖模型来源等（Settings / 配置导出在 M2 接入）。 */
  config?: Partial<SegmentationRuntimeConfig>;
  /** 测试注入；默认用 Vite 的 module worker。 */
  createWorker?: () => WorkerLike;
  /** 首次加载（含模型下载）的超时，默认 180s。 */
  loadTimeoutMs?: number;
  /** 模型就绪后单次分割的超时，默认 30s。 */
  segmentTimeoutMs?: number;
  /** 测试注入的环境探测。 */
  environment?: { hasWorker: boolean; hasWebAssembly: boolean; hasWebGpu: boolean };
}

export interface SegmentCallOptions {
  /** 框提示（0-1 归一化）；已有框时作为 SAM 的 box 提示。 */
  box?: NormalizedBox | null;
  /** 同一张图的稳定标识（如 storageKey + 尺寸），用于复用 embedding；不给则每次重算。 */
  imageKey?: string;
  signal?: AbortSignal;
  onProgress?: (progress: SamProgress) => void;
}

export interface SubjectSegmenter {
  readonly engineId: string;
  isAvailable(): Promise<boolean>;
  checkAvailability(): Promise<SegmenterAvailability>;
  prepare(image?: Blob, options?: Omit<SegmentCallOptions, 'box'>): Promise<{ device: SegmentationDevice }>;
  segment(image: Blob, points: ReadonlyArray<{ x: number; y: number; label?: number }>, options?: SegmentCallOptions): Promise<SegmentResult>;
  dispose(): void;
}

function defaultEnvironment() {
  return {
    hasWorker: typeof Worker !== 'undefined',
    hasWebAssembly: typeof WebAssembly !== 'undefined' && typeof WebAssembly.instantiate === 'function',
    hasWebGpu: typeof navigator !== 'undefined' && !!(navigator as { gpu?: unknown }).gpu,
  };
}

function defaultCreateWorker(): WorkerLike {
  return new Worker(new URL('./samWorker.ts', import.meta.url), { type: 'module', name: 'flovart-subject-segmenter' }) as unknown as WorkerLike;
}

type Pending = {
  resolve: (value: SamWorkerResponse) => void;
  reject: (error: SegmentationError) => void;
  onProgress?: (progress: SamProgress) => void;
  cleanup: () => void;
};

export function createSubjectSegmenter(options: SubjectSegmenterOptions = {}): SubjectSegmenter {
  const loadTimeoutMs = options.loadTimeoutMs ?? 180_000;
  const segmentTimeoutMs = options.segmentTimeoutMs ?? 30_000;
  let worker: WorkerLike | null = null;
  let nextId = 1;
  let loaded = false;
  const pending = new Map<number, Pending>();

  const failAll = (error: SegmentationError) => {
    for (const [id, item] of pending) { pending.delete(id); item.cleanup(); item.reject(error); }
  };

  const teardown = () => {
    worker?.terminate();
    worker = null;
    loaded = false;
  };

  const ensureWorker = (): WorkerLike => {
    if (worker) return worker;
    let created: WorkerLike;
    try {
      created = (options.createWorker || defaultCreateWorker)();
    } catch (error) {
      throw new SegmentationError('CAPABILITY_UNAVAILABLE', `无法启动主体分割：${error instanceof Error ? error.message : String(error)}`);
    }
    created.onmessage = (event) => {
      const message = event.data;
      const item = pending.get(message.id);
      if (!item) return; // 已取消 / 超时的请求晚到，丢弃
      if (message.type === 'progress') { item.onProgress?.(message.progress); return; }
      pending.delete(message.id);
      item.cleanup();
      if (message.type === 'error') item.reject(new SegmentationError('SEGMENTATION_FAILED', `主体分割失败：${message.message}`));
      else item.resolve(message);
    };
    created.onerror = (event) => {
      const detail = (event as ErrorEvent).message;
      // worker 崩溃：丢弃它，下次调用自动重建
      teardown();
      failAll(new SegmentationError('WORKER_CRASHED', `主体分割进程意外退出${detail ? `：${detail}` : ''}，请重试`));
    };
    worker = created;
    return created;
  };

  type OutgoingRequest = SamWorkerRequest extends infer R ? R extends { type: 'prepare' | 'segment' } ? Omit<R, 'id'> : never : never;
  const request = (message: OutgoingRequest, call: SegmentCallOptions, timeoutMs: number) =>
    new Promise<SamWorkerResponse>((resolve, reject) => {
      if (call.signal?.aborted) { reject(new SegmentationError('ABORTED', '已取消主体分割')); return; }
      const target = ensureWorker();
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        cleanup();
        // 超时后 worker 可能还卡在推理里：终止并在下次重建，避免后续请求排队在它后面
        teardown();
        failAll(new SegmentationError('TIMEOUT', '主体分割超时，请重试或改用框选'));
        reject(new SegmentationError('TIMEOUT', loaded ? '主体分割超时，请重试或改用框选' : '加载主体分割模型超时（检查网络或模型来源设置），可先改用框选'));
      }, timeoutMs);
      const onAbort = () => {
        pending.delete(id);
        cleanup();
        reject(new SegmentationError('ABORTED', '已取消主体分割'));
      };
      const cleanup = () => { clearTimeout(timer); call.signal?.removeEventListener('abort', onAbort); };
      call.signal?.addEventListener('abort', onAbort, { once: true });
      pending.set(id, { resolve, reject, onProgress: call.onProgress, cleanup });
      target.postMessage({ ...message, id, config: options.config } as SamWorkerRequest);
    });

  const checkAvailability = async (): Promise<SegmenterAvailability> => {
    const environment = options.environment || defaultEnvironment();
    if (!environment.hasWorker) return { available: false, reason: '当前环境不支持 Web Worker，无法在本地点选主体' };
    if (!environment.hasWebAssembly) return { available: false, reason: '当前浏览器不支持 WebAssembly，无法在本地点选主体' };
    return { available: true, preferredDevice: environment.hasWebGpu ? 'webgpu' : 'wasm' };
  };

  const assertAvailable = async () => {
    const availability = await checkAvailability();
    if (!availability.available) throw new SegmentationError('CAPABILITY_UNAVAILABLE', availability.reason || '本地主体分割不可用');
  };

  return {
    engineId: SEGMENTATION_ENGINE_ID,
    checkAvailability,
    async isAvailable() { return (await checkAvailability()).available; },

    async prepare(image, call = {}) {
      await assertAvailable();
      const response = await request({ type: 'prepare', image, imageKey: call.imageKey }, call, loadTimeoutMs);
      if (response.type !== 'prepared') throw new SegmentationError('SEGMENTATION_FAILED', '主体分割返回了意外结果');
      loaded = true;
      return { device: response.device };
    },

    async segment(image, points, call = {}) {
      await assertAvailable();
      const normalized: PickPoint[] = normalizePickPoints(points);
      if (!normalized.length && !call.box) throw new SegmentationError('SEGMENTATION_FAILED', '至少需要一个点或一个框');
      const response = await request(
        { type: 'segment', image, imageKey: call.imageKey, points: normalized, box: call.box || null },
        call,
        loaded ? segmentTimeoutMs : loadTimeoutMs,
      );
      if (response.type !== 'result') throw new SegmentationError('SEGMENTATION_FAILED', '主体分割返回了意外结果');
      loaded = true;
      const { masks, scores, width, height } = response.result;
      if (!masks.length || masks.some(mask => mask.length !== width * height)) {
        throw new SegmentationError('SEGMENTATION_FAILED', '主体分割返回的蒙版尺寸不正确');
      }
      return response.result;
    },

    dispose() {
      failAll(new SegmentationError('ABORTED', '主体分割已释放'));
      teardown();
    },
  };
}

let shared: SubjectSegmenter | null = null;

/** 全局共享实例（弹层之间复用同一个 worker 与 embedding 缓存）。 */
export function getSubjectSegmenter(): SubjectSegmenter {
  if (!shared) shared = createSubjectSegmenter();
  return shared;
}
