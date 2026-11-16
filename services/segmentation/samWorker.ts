// 点选主体的分割 Web Worker：主线程通过 subjectSegmenter 用 `new Worker(new URL(...), { type: 'module' })` 拉起。
// @huggingface/transformers 只在这里、第一次需要时动态 import（vite.config 已把它排除出依赖预打包）。
import { createSamEngine, type SamEngine, type SamProgress, type SegmentResult, type TransformersLike } from './samEngine';
import { resolveSegmentationConfig, type SegmentationDevice, type SegmentationRuntimeConfig } from './segmentationConfig';
import type { NormalizedBox, PickPoint } from '../../components/workflow/subjectMask';

export type SamWorkerRequest =
  | { id: number; type: 'prepare'; config?: Partial<SegmentationRuntimeConfig>; image?: Blob; imageKey?: string }
  | { id: number; type: 'segment'; config?: Partial<SegmentationRuntimeConfig>; image: Blob; imageKey?: string; points: PickPoint[]; box?: NormalizedBox | null }
  | { id: number; type: 'dispose' };

export type SamWorkerResponse =
  | { id: number; type: 'progress'; progress: SamProgress }
  | { id: number; type: 'prepared'; device: SegmentationDevice }
  | { id: number; type: 'result'; result: SegmentResult }
  | { id: number; type: 'disposed' }
  | { id: number; type: 'error'; message: string };

interface WorkerScope {
  postMessage(message: SamWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<SamWorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;
let engine: SamEngine | null = null;
let engineConfigKey = '';
let progressTarget = 0;

function engineFor(overrides: Partial<SegmentationRuntimeConfig> | undefined): SamEngine {
  const config = resolveSegmentationConfig(overrides);
  const key = JSON.stringify(config);
  if (!engine || key !== engineConfigKey) {
    void engine?.dispose();
    engineConfigKey = key;
    engine = createSamEngine(
      () => import('@huggingface/transformers') as unknown as Promise<TransformersLike>,
      config,
      { onProgress: progress => scope.postMessage({ id: progressTarget, type: 'progress', progress: { file: progress.file, loaded: progress.loaded, total: progress.total, status: progress.status } }) },
    );
  }
  return engine;
}

scope.onmessage = async (event) => {
  const request = event.data;
  try {
    if (request.type === 'dispose') {
      await engine?.dispose();
      engine = null;
      scope.postMessage({ id: request.id, type: 'disposed' });
      return;
    }
    progressTarget = request.id;
    if (request.type === 'prepare') {
      const { device } = await engineFor(request.config).prepare(request.image, request.imageKey);
      scope.postMessage({ id: request.id, type: 'prepared', device });
      return;
    }
    const result = await engineFor(request.config).segment(request.image, request.points, { box: request.box, imageKey: request.imageKey });
    scope.postMessage({ id: request.id, type: 'result', result }, result.masks.map(mask => mask.buffer as ArrayBuffer));
  } catch (error) {
    scope.postMessage({ id: request.id, type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
