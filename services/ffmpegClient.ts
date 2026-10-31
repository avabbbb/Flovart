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

// CDN 挂起或 wasm 初始化卡住时必须失败：loadingPromise 永不落定会让整条 FFmpeg 串行队列随之卡死。
const CORE_FETCH_TIMEOUT_MS = 180_000;
const CORE_INIT_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let rejectDeadline: (reason: Error) => void = () => undefined;
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => rejectDeadline(new Error(message)), ms);
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function safeToBlobURL(url: string, expectedType: string): Promise<string> {
  const signal = AbortSignal.timeout(CORE_FETCH_TIMEOUT_MS);
  let blob: Blob;
  try {
    const res = await fetch(url, { signal });
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
    blob = await res.blob();
  } catch (error) {
    if (signal.aborted) throw new Error(`加载 ffmpeg core 超时（${CORE_FETCH_TIMEOUT_MS / 1000}s）：${url}`);
    throw error;
  }
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
    // 懒加载：~31MB 运行时只在首次使用视频工具时下载，不能进首屏 bundle。
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();
    const multiThread = isMultiThreadAvailable();
    const base = multiThread ? MULTI_THREAD_BASE : SINGLE_THREAD_BASE;
    // 三个文件互不依赖，并行下载。
    const [coreURL, wasmURL, workerURL] = await Promise.all([
      safeToBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      safeToBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      multiThread ? safeToBlobURL(`${base}/ffmpeg-core.worker.js`, 'text/javascript') : Promise.resolve(undefined),
    ]);
    try {
      await withTimeout(
        ffmpeg.load(workerURL ? { coreURL, wasmURL, workerURL } : { coreURL, wasmURL }),
        CORE_INIT_TIMEOUT_MS,
        `ffmpeg core 初始化超时（${CORE_INIT_TIMEOUT_MS / 1000}s）`,
      );
    } catch (error) {
      ffmpeg.terminate();
      throw error;
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

// 终止当前实例（例如任务卡死后）；下一次 getFFmpeg 会重新加载干净的实例。
export function resetFFmpeg(): void {
  ffmpegInstance?.terminate();
  ffmpegInstance = null;
}

export function isFFmpegSupported(): boolean {
  return typeof WebAssembly !== 'undefined';
}

export function isMultiThreadAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated === true;
}
