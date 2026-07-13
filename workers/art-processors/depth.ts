import type { RawImage } from '@huggingface/transformers';

let depthPipeline: ((input: Blob | string) => Promise<{ depth: RawImage }>) | null = null;
let pipelineLoading: Promise<typeof depthPipeline> | null = null;

async function getDepthPipeline(): Promise<NonNullable<typeof depthPipeline>> {
  if (depthPipeline) return depthPipeline;
  if (pipelineLoading) return pipelineLoading as Promise<NonNullable<typeof depthPipeline>>;
  pipelineLoading = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    // Allow remote downloads; cache in browser IndexedDB by default.
    env.allowLocalModels = false;
    const device = (typeof navigator !== 'undefined' && (navigator as Navigator & { gpu?: unknown }).gpu) ? 'webgpu' : 'wasm';
    const p = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small-ONNX', {
      device,
      dtype: 'fp32',
    } as Record<string, unknown>);
    depthPipeline = p as unknown as typeof depthPipeline;
    return depthPipeline!;
  })();
  return pipelineLoading as Promise<NonNullable<typeof depthPipeline>>;
}

export interface DepthOptions {
  /** invert: white=near instead of white=far. default false */
  invert?: boolean;
}

/** Compute a depth map RGBA (grayscale encoded in RGB channels, A=255). */
export async function depthFromImage(
  blob: Blob,
  onProgress?: (phase: string, value?: number) => void,
  _opts: DepthOptions = {},
): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  void _opts;
  onProgress?.('loading-model', 0);
  const estimator = await getDepthPipeline();
  onProgress?.('loading-model', 1);
  onProgress?.('infer', 0);
  const out = await estimator(blob);
  onProgress?.('infer', 1);
  const depth = out.depth;
  const w = depth.width;
  const h = depth.height;
  const src = depth.data as Uint8Array;
  const rgba = new Uint8ClampedArray(w * h * 4);
  // depth.data is single-channel grayscale (0-255). Encode in RGB; A=255.
  for (let i = 0; i < w * h; i++) {
    const v = src[i];
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, width: w, height: h };
}

export async function isDepthSupported(): Promise<boolean> {
  try {
    await getDepthPipeline();
    return true;
  } catch {
    return false;
  }
}