// ffmpeg.wasm 懒加载客户端
// 仅在用户首次使用视频工具时加载 ~31MB core
// 多线程需 SharedArrayBuffer (COOP/COEP headers)，否则降级单线程
//
// 两个必须同时满足的约束，写错任何一个都会让全部视频/音频工具失败：
//
// 1. 必须用 core 的 **esm** 构建，不能用 umd。
//    @ffmpeg/ffmpeg 的 classes.js 固定以 `new Worker(url, { type: 'module' })`
//    创建模块 worker，模块 worker 里没有 importScripts，于是 worker.js 必然走
//    `(await import(coreURL)).default` 这条分支。umd 构建没有 export default，
//    取到 undefined 就抛 ERROR_IMPORT_FAILURE（"failed to import ffmpeg-core.js"）。
//    worker.js 只在“未显式传 coreURL”时才把 /umd/ 改写成 /esm/，我们传的是
//    blob URL，所以这条兜底不会生效。
//
// 2. 多线程与单线程是两个不同的包：ffmpeg-core.worker.js 只存在于
//    @ffmpeg/core-mt，@ffmpeg/core 的 umd 与 esm 目录都没有这个文件，指向它必然 404。
//
// 两者的 baseURL 都必须落在 /dist/esm 上。

import type { FFmpeg } from '@ffmpeg/ffmpeg';

const SINGLE_THREAD_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
const MULTI_THREAD_BASE = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm';

// TODO: 后续应本地打包 assets + SRI 校验，避免从 unpkg CDN 动态加载 ~31MB core
const ACCEPTED_JS_TYPES = new Set(['text/javascript', 'application/javascript', 'application/x-javascript']);

async function safeToBlobURL(url: string, expectedType: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载 ffmpeg core 失败 (HTTP ${res.status})：${url}`);
  const contentType = (res.headers.get('Content-Type') || '').toLowerCase().split(';')[0].trim();
  if (contentType) {
    if (expectedType === 'text/javascript') {
      if (!ACCEPTED_JS_TYPES.has(contentType)) {
        throw new Error(`ffmpeg core Content-Type 校验失败：期望 JavaScript，实际 ${contentType}`);
      }
    } else if (expectedType === 'application/wasm') {
      if (contentType !== 'application/wasm') {
        throw new Error(`ffmpeg core Content-Type 校验失败：期望 application/wasm，实际 ${contentType}`);
      }
    }
  }
  const blob = await res.blob();
  if (blob.size < 1024) {
    throw new Error(`ffmpeg core 文件过小（${blob.size} bytes），可能下载不完整：${url}`);
  }
  return URL.createObjectURL(new Blob([blob], { type: expectedType }));
}

let ffmpegInstance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();

    if (isMultiThreadAvailable()) {
      const coreURL = await safeToBlobURL(`${MULTI_THREAD_BASE}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await safeToBlobURL(`${MULTI_THREAD_BASE}/ffmpeg-core.wasm`, 'application/wasm');
      const workerURL = await safeToBlobURL(`${MULTI_THREAD_BASE}/ffmpeg-core.worker.js`, 'text/javascript');
      await ffmpeg.load({ coreURL, wasmURL, workerURL });
    } else {
      const coreURL = await safeToBlobURL(`${SINGLE_THREAD_BASE}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await safeToBlobURL(`${SINGLE_THREAD_BASE}/ffmpeg-core.wasm`, 'application/wasm');
      await ffmpeg.load({ coreURL, wasmURL });
    }

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

export function isFFmpegSupported(): boolean {
  return typeof WebAssembly !== 'undefined';
}

export function isMultiThreadAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated === true;
}
