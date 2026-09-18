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

let ffmpegInstance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');
    const ffmpeg = new FFmpeg();

    if (isMultiThreadAvailable()) {
      const coreURL = await toBlobURL(`${MULTI_THREAD_BASE}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${MULTI_THREAD_BASE}/ffmpeg-core.wasm`, 'application/wasm');
      const workerURL = await toBlobURL(`${MULTI_THREAD_BASE}/ffmpeg-core.worker.js`, 'text/javascript');
      await ffmpeg.load({ coreURL, wasmURL, workerURL });
    } else {
      const coreURL = await toBlobURL(`${SINGLE_THREAD_BASE}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${SINGLE_THREAD_BASE}/ffmpeg-core.wasm`, 'application/wasm');
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
