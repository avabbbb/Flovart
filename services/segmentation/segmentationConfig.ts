// 主体分割（点选主体）引擎配置。模型来源可配置：中国大陆直连 huggingface.co 不稳定时，
// 构建时设置 VITE_SEGMENTATION_MODEL_BASE_URL（如 https://hf-mirror.com/ 或自托管地址），
// ONNX Runtime 的 wasm 文件同理可用 VITE_SEGMENTATION_WASM_BASE_URL 指向镜像 / 自托管目录。
// Settings 里的「主体分割模型」来源（随配置导出）在 M2 接入，运行时以 SegmenterOptions 覆盖这里的默认值。

export const SEGMENTATION_MODEL_ID = 'Xenova/slimsam-77-uniform';
export const SEGMENTATION_ENGINE_ID = 'slimsam-77-uniform';
export const DEFAULT_SEGMENTATION_MODEL_BASE_URL = 'https://huggingface.co/';

export type SegmentationDevice = 'webgpu' | 'wasm';

export interface SegmentationRuntimeConfig {
  modelId: string;
  /** 模型仓库根地址（transformers.js 的 env.remoteHost），以 `/` 结尾。 */
  modelBaseUrl: string;
  /** onnxruntime-web 的 wasm 文件目录；空 = 用 transformers.js 默认（jsDelivr CDN）。 */
  wasmBaseUrl?: string;
}

// 直接写 `import.meta.env.VITE_*`，让 Vite 在构建时静态替换（worker 里同样生效）。
function envModelBaseUrl(): string | undefined {
  try { return import.meta.env.VITE_SEGMENTATION_MODEL_BASE_URL; } catch { return undefined; }
}

function envWasmBaseUrl(): string | undefined {
  try { return import.meta.env.VITE_SEGMENTATION_WASM_BASE_URL; } catch { return undefined; }
}

/** 规范化来源地址：只接受 http(s)，补齐结尾的 `/`；非法值返回 undefined（调用方退回默认）。 */
export function normalizeBaseUrl(value: string | undefined | null): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.href.endsWith('/') ? url.href : url.href + '/';
  } catch {
    // 同源相对路径（如 /models/、Tauri 打包资源）也允许
    return trimmed.startsWith('/') ? (trimmed.endsWith('/') ? trimmed : trimmed + '/') : undefined;
  }
}

export function resolveSegmentationConfig(overrides: Partial<SegmentationRuntimeConfig> = {}): SegmentationRuntimeConfig {
  const wasmBaseUrl = normalizeBaseUrl(overrides.wasmBaseUrl) || normalizeBaseUrl(envWasmBaseUrl());
  return {
    modelId: overrides.modelId || SEGMENTATION_MODEL_ID,
    modelBaseUrl: normalizeBaseUrl(overrides.modelBaseUrl)
      || normalizeBaseUrl(envModelBaseUrl())
      || DEFAULT_SEGMENTATION_MODEL_BASE_URL,
    ...(wasmBaseUrl ? { wasmBaseUrl } : {}),
  };
}

/**
 * 按设备选模型文件：Xenova/slimsam-77-uniform 的 onnx/ 目录有 fp32 / fp16 / quantized(q8) 三种。
 * WebGPU：图像编码器 fp16 跑 GPU，提示解码器 q8 跑 WASM（每次点击都跑，体积小、CPU 足够快）；
 * WASM：两段都用 q8。体积以 HF 文件列表为准，耗时要实测（docs/quality/<日期>-subject-pick.md）。
 */
export function segmentationLoadOptions(device: SegmentationDevice) {
  return device === 'webgpu'
    ? {
      device: { vision_encoder: 'webgpu', prompt_encoder_mask_decoder: 'wasm' },
      dtype: { vision_encoder: 'fp16', prompt_encoder_mask_decoder: 'q8' },
    }
    : {
      device: { vision_encoder: 'wasm', prompt_encoder_mask_decoder: 'wasm' },
      dtype: { vision_encoder: 'q8', prompt_encoder_mask_decoder: 'q8' },
    };
}

/**
 * onnxruntime-web 的 wasm 运行时文件。transformers.js 4.x 默认一律加载 asyncify 版
 * （ort-wasm-simd-threaded.asyncify.wasm，约 26.9 MB）：WebGPU 执行器需要它，纯 WASM 并不需要。
 * 纯 WASM 设备改用普通版（ort-wasm-simd-threaded.wasm，约 14.3 MB），少下载近一半，
 * 也低于 Cloudflare Pages 单文件 25 MiB 上限，可以放进 VITE_SEGMENTATION_WASM_BASE_URL 自托管。
 * transformers.js 自己在 Safari < 26 且无 WebGPU 时也是这样切到普通版，ORT 的 webgpu 包接受这种覆盖。
 */
export const ORT_WASM_FILE_STEM = 'ort-wasm-simd-threaded';

export function onnxWasmVariant(device: SegmentationDevice): '' | '.asyncify' {
  return device === 'webgpu' ? '.asyncify' : '';
}

/** jsDelivr 上与打包进来的 onnxruntime-web 同版本的 dist 目录；拿不到版本时返回 undefined（交给 transformers.js 默认）。 */
export function defaultOnnxWasmBaseUrl(ortVersion: string | undefined): string | undefined {
  const version = typeof ortVersion === 'string' ? ortVersion.trim() : '';
  if (!version || !/^[0-9A-Za-z.+-]+$/.test(version)) return undefined;
  return `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
}

/** 给 ORT 的 env.wasm.wasmPaths：按设备选文件变体；目录优先用配置的镜像 / 自托管地址。 */
export function onnxWasmPaths(device: SegmentationDevice, baseUrl: string | undefined): { mjs: string; wasm: string } | undefined {
  if (!baseUrl) return undefined;
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const stem = ORT_WASM_FILE_STEM + onnxWasmVariant(device);
  return { mjs: `${base}${stem}.mjs`, wasm: `${base}${stem}.wasm` };
}
