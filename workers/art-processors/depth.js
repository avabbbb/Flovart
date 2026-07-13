let depthPipeline = null;
let pipelineLoading = null;
async function getDepthPipeline() {
    if (depthPipeline)
        return depthPipeline;
    if (pipelineLoading)
        return pipelineLoading;
    pipelineLoading = (async () => {
        const { pipeline, env } = await import('@huggingface/transformers');
        // Allow remote downloads; cache in browser IndexedDB by default.
        env.allowLocalModels = false;
        const device = (typeof navigator !== 'undefined' && navigator.gpu) ? 'webgpu' : 'wasm';
        const p = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small-ONNX', {
            device,
            dtype: 'fp32',
        });
        depthPipeline = p;
        return depthPipeline;
    })();
    return pipelineLoading;
}
/** Compute a depth map RGBA (grayscale encoded in RGB channels, A=255). */
export async function depthFromImage(blob, onProgress, _opts = {}) {
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
    const src = depth.data;
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
export async function isDepthSupported() {
    try {
        await getDepthPipeline();
        return true;
    }
    catch {
        return false;
    }
}
