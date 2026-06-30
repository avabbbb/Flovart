// ffmpeg.wasm 懒加载客户端
// 仅在用户首次使用视频工具时加载 ~31MB core
// 多线程需 SharedArrayBuffer (COOP/COEP headers)，否则降级单线程

import type { FFmpeg } from '@ffmpeg/ffmpeg';

let ffmpegInstance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');
    const ffmpeg = new FFmpeg();

    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    const isMultiThread = typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated;

    if (isMultiThread) {
      const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
      const workerURL = await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript');
      await ffmpeg.load({ coreURL, wasmURL, workerURL });
    } else {
      const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
      const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
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
