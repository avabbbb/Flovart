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

const VERSION = '0.12.6';
const HTTPS = 'https:';
// 依次尝试的 CDN：npmmirror 国内最快且按 Origin 回 CORS；jsdelivr / unpkg 作为海外回退。
// core wasm 约 31MB，超过 Cloudflare Pages 单文件 25 MiB 上限，无法随站点自托管。
function coreBases(pkg: 'core' | 'core-mt'): string[] {
  return [
    HTTPS + '//registry.npmmirror.com/@ffmpeg/' + pkg + '/' + VERSION + '/files/dist/esm',
    HTTPS + '//cdn.jsdelivr.net/npm/@ffmpeg/' + pkg + '@' + VERSION + '/dist/esm',
    HTTPS + '//unpkg.com/@ffmpeg/' + pkg + '@' + VERSION + '/dist/esm',
  ];
}

const ACCEPTED_JS_TYPES = new Set(['text/javascript', 'application/javascript', 'application/x-javascript']);

// CDN 挂起或 wasm 初始化卡住时必须失败：loadingPromise 永不落定会让整条 FFmpeg 串行队列随之卡死。
const CORE_FETCH_TIMEOUT_MS = 90_000;
const CORE_INIT_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let rejectDeadline: (reason: Error) => void = () => undefined;
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => rejectDeadline(new Error(message)), ms);
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function readBody(res: Response, onProgress?: (loaded: number, total: number) => void): Promise<Blob> {
  if (!onProgress || !res.body) return res.blob();
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  return new Blob(chunks as BlobPart[]);
}

async function safeToBlobURL(url: string, expectedType: string, onProgress?: (loaded: number, total: number) => void): Promise<string> {
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
    blob = await readBody(res, onProgress);
  } catch (error) {
    if (signal.aborted) throw new Error(`加载 ffmpeg core 超时（${CORE_FETCH_TIMEOUT_MS / 1000}s）：${url}`);
    throw error;
  }
  if (blob.size < 1024) {
    throw new Error(`ffmpeg core 文件过小（${blob.size} bytes），可能下载不完整：${url}`);
  }
  return URL.createObjectURL(new Blob([blob], { type: expectedType }));
}

export interface FFmpegLoadOptions {
  // 首次加载时 ffmpeg core（wasm）下载进度，0–1；实例已就绪时不回调。
  onDownloadProgress?: (ratio: number) => void;
}

// Content-Length 缺失（或被 gzip 改写）时按约 32 MiB 估算 wasm 体积。
const WASM_BYTES_ESTIMATE = 33_554_432;

let ffmpegInstance: FFmpeg | null = null;
let loadingPromise: Promise<FFmpeg> | null = null;
// 并发等待同一次加载的调用方都能收到下载进度。
const downloadListeners = new Set<(ratio: number) => void>();

function emitDownloadProgress(loaded: number, total: number) {
  const ratio = Math.min(1, loaded / (total > 0 ? total : WASM_BYTES_ESTIMATE));
  downloadListeners.forEach(listener => listener(ratio));
}

export async function getFFmpeg({ onDownloadProgress }: FFmpegLoadOptions = {}): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (onDownloadProgress) downloadListeners.add(onDownloadProgress);
  try {
    loadingPromise ??= loadFFmpeg().finally(() => { loadingPromise = null; });
    return await loadingPromise;
  } finally {
    if (onDownloadProgress) downloadListeners.delete(onDownloadProgress);
  }
}

async function loadFFmpeg(): Promise<FFmpeg> {
    // 懒加载：~31MB 运行时只在首次使用视频工具时下载，不能进首屏 bundle。
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const ffmpeg = new FFmpeg();
    const multiThread = isMultiThreadAvailable();
    const { coreURL, wasmURL, workerURL } = await fetchCoreFiles(multiThread);
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
}

async function fetchCoreFiles(multiThread: boolean): Promise<{ coreURL: string; wasmURL: string; workerURL?: string }> {
  const errors: string[] = [];
  for (const base of coreBases(multiThread ? 'core-mt' : 'core')) {
    // 三个文件互不依赖，并行下载；任一失败就整组换下一个 CDN，避免混用不同来源的 core 与 wasm。
    const results = await Promise.allSettled([
      safeToBlobURL(base + '/ffmpeg-core.js', 'text/javascript'),
      safeToBlobURL(base + '/ffmpeg-core.wasm', 'application/wasm', emitDownloadProgress),
      multiThread ? safeToBlobURL(base + '/ffmpeg-core.worker.js', 'text/javascript') : Promise.resolve(undefined),
    ]);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (!failure) {
      const [coreURL, wasmURL, workerURL] = results.map(result => (result as PromiseFulfilledResult<string | undefined>).value);
      return { coreURL: coreURL!, wasmURL: wasmURL!, workerURL };
    }
    results.forEach(result => { if (result.status === 'fulfilled' && result.value) URL.revokeObjectURL(result.value); });
    errors.push(failure.reason instanceof Error ? failure.reason.message : String(failure.reason));
  }
  throw new Error('加载 ffmpeg core 失败，所有 CDN 均不可用：' + errors.join('；'));
}

// 终止当前实例（例如任务卡死后）；下一次 getFFmpeg 会重新加载干净的实例。
export function resetFFmpeg(): void {
  ffmpegInstance?.terminate();
  ffmpegInstance = null;
}

export function isFFmpegSupported(): boolean {
  return typeof WebAssembly !== 'undefined';
}

// core-mt 在浏览器里不稳定：线上站开启 COOP/COEP 后会走多线程，分离音视频时直接崩掉整个渲染进程
// （Crashpad_NotConnectedToHandler），无法被 try/catch 兜住。默认单线程；确需多线程时用
// localStorage `flovart.ffmpeg.mt` = '1' 显式开启。
export function isMultiThreadAvailable(): boolean {
  if (typeof SharedArrayBuffer === 'undefined' || window.crossOriginIsolated !== true) return false;
  try {
    return localStorage.getItem('flovart.ffmpeg.mt') === '1';
  } catch {
    return false;
  }
}
