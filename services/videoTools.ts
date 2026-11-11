// 视频工具：基于 ffmpeg.wasm 的纯前端视频处理
// trim: 裁取子片段 (stream copy, 极快)
// avSplit: 音视频分离
// merge: 多片段拼接

import { getFFmpeg, resetFFmpeg } from './ffmpegClient';
import { fetchFile } from '@ffmpeg/util';
import { nanoid } from 'nanoid';
import { fitDimensionsToPixelRange } from './referenceTranscode';

export interface VideoTrimResult {
  blob: Blob;
  durationSec: number;
}

export interface VideoTrimOptions {
  /** 默认重编码，保证切点落在目标帧；stream copy 只能切关键帧。 */
  accurate?: boolean;
}

export interface VideoMetadata {
  duration: number;
  fps: number;
  /** HTMLVideoElement 不暴露帧率；用 requestVideoFrameCallback 估算，失败时回退 30。 */
  fpsEstimated: boolean;
}

export interface VideoAvSplitResult {
  videoBlob: Blob;
  audioBlob: Blob;
}

// ffmpeg.wasm 是进程级单例，且所有任务共享同一个虚拟文件系统：
// 并发执行会互相覆盖固定文件名（input.mp4/output.mp4 …）并争抢实例。
// 所有 ffmpeg 操作（含 audioTools 经 workflowAudioOperations 的调用）必须
// 经由该模块级串行队列执行，同一时刻只有一个任务占用 ffmpeg 实例。
let ffmpegQueueTail: Promise<unknown> = Promise.resolve();

// 单个任务的墙钟上限：wasm 卡死/OOM 时 exec 永不返回，没有上限就会永久锁死后续全部音视频操作。
const FFMPEG_TASK_TIMEOUT_MS = 600_000;

async function runWithDeadline<T>(task: () => Promise<T>): Promise<T> {
  let rejectDeadline: (reason: Error) => void = () => undefined;
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => {
    // 卡死的实例不可复用：终止后下一个任务会重新加载。
    resetFFmpeg();
    rejectDeadline(new Error('ffmpeg 任务超过 10 分钟未完成，已终止。'));
  }, FFMPEG_TASK_TIMEOUT_MS);
  try {
    return await Promise.race([task(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function enqueueFFmpegTask<T>(task: () => Promise<T>): Promise<T> {
  const run = ffmpegQueueTail.then(() => runWithDeadline(task), () => runWithDeadline(task));
  ffmpegQueueTail = run.then(() => undefined, () => undefined);
  return run;
}

// 每次操作的虚拟文件名都带唯一前缀，彻底避免不同任务撞名。
function uniqueFFmpegPrefix(tag: string): string {
  return `${nanoid(8)}-${tag}-`;
}

function assertFFmpegExitCode(code: number): void {
  if (code !== 0) throw new Error(`ffmpeg 执行失败（exit ${code}）`);
}

async function deleteFFmpegFiles(ffmpeg: Awaited<ReturnType<typeof getFFmpeg>>, names: readonly string[]): Promise<void> {
  for (const name of names) {
    // 清理失败（文件不存在等）不应掩盖操作本身的错误。
    await ffmpeg.deleteFile(name).catch(() => undefined);
  }
}

function guessFormat(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'webm') return 'webm';
  if (ext === 'mov') return 'mov';
  if (ext === 'avi') return 'avi';
  if (ext === 'mkv') return 'mkv';
  return 'mp4';
}

export async function trimVideo(blob: Blob, startSec: number, endSec: number, originalName = 'video.mp4', options: VideoTrimOptions = {}): Promise<VideoTrimResult> {
  return enqueueFFmpegTask(() => trimVideoOnFFmpeg(blob, startSec, endSec, originalName, options));
}

async function trimVideoOnFFmpeg(blob: Blob, startSec: number, endSec: number, originalName: string, options: VideoTrimOptions): Promise<VideoTrimResult> {
  const ffmpeg = await getFFmpeg();
  const format = guessFormat(originalName);
  const prefix = uniqueFFmpegPrefix('trim');
  const inputName = `${prefix}input.${format}`;
  const outputName = `${prefix}output.${format}`;
  const accurate = options.accurate !== false;

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(blob));
    const code = await ffmpeg.exec(accurate ? [
      // -ss 放在 -i 前先快速定位，再重编码到准确的帧；stream copy 只能切关键帧，会让
      // 时间码和实际画面错位，用户拖动到具体帧后无法得到该帧。
      '-ss', String(startSec),
      '-i', inputName,
      '-t', String(Math.max(0.001, endSec - startSec)),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-movflags', '+faststart',
      outputName,
    ] : [
      '-i', inputName,
      '-ss', String(startSec),
      '-to', String(endSec),
      '-c', 'copy',
      outputName,
    ]);
    assertFFmpegExitCode(code);

    const data = await ffmpeg.readFile(outputName);
    return { blob: new Blob([data], { type: blob.type || `video/${format}` }), durationSec: endSec - startSec };
  } finally {
    await deleteFFmpegFiles(ffmpeg, [inputName, outputName]);
  }
}

/**
 * 读取时长并估算帧率。HTMLVideoElement 没有 fps 字段；播放一小段并测量相邻
 * requestVideoFrameCallback 的 mediaTime 间隔。失败或浏览器不支持时回退 30fps。
 */
export async function probeVideoMetadata(url: string): Promise<VideoMetadata> {
  const { promise, resolve } = Promise.withResolvers<VideoMetadata>();
  let settled = false;
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  const done = (duration: number, fps: number, fpsEstimated: boolean) => {
    if (settled) return;
    settled = true;
    video.pause();
    video.removeAttribute('src');
    video.load();
    resolve({ duration: Number.isFinite(duration) ? duration : 0, fps, fpsEstimated });
  };
  const fallback = () => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    done(duration, 30, true);
  };
  const timer = window.setTimeout(fallback, 1400);
  video.onerror = () => { window.clearTimeout(timer); fallback(); };
  video.onloadedmetadata = () => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const callback = (video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
    }).requestVideoFrameCallback;
    if (!callback || typeof callback !== 'function') {
      window.clearTimeout(timer);
      done(duration, 30, true);
      return;
    }
    let last = -1;
    const deltas: number[] = [];
    const finish = () => {
      window.clearTimeout(timer);
      if (deltas.length) {
        const sorted = [...deltas].sort((left, right) => left - right);
        const median = sorted[Math.floor(sorted.length / 2)] || 0;
        const raw = median > 0 ? 1 / median : 30;
        const common = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
        const matched = common.find(value => Math.abs(value - raw) < 0.75) || Math.round(raw);
        done(duration, Math.max(1, Math.min(120, matched || 30)), false);
      } else {
        done(duration, 30, true);
      }
    };
    const collect = (_now: number, metadata: { mediaTime: number }) => {
      if (last >= 0) deltas.push(metadata.mediaTime - last);
      last = metadata.mediaTime;
      if (deltas.length >= 8) { finish(); return; }
      callback.call(video, collect);
    };
    callback.call(video, collect);
    void video.play().catch(() => {
      window.clearTimeout(timer);
      done(duration, 30, true);
    });
  };
  return promise;
}

export interface VideoScaleResult {
  blob: Blob;
  width: number;
  height: number;
}


export async function scaleVideoToPixelRange(
  blob: Blob,
  width: number,
  height: number,
  range: { min?: number; max?: number },
  originalName = 'video.mp4',
): Promise<VideoScaleResult> {
  return enqueueFFmpegTask(() => scaleVideoOnFFmpeg(blob, fitDimensionsToPixelRange(width, height, range), originalName));
}

async function scaleVideoOnFFmpeg(blob: Blob, size: { width: number; height: number }, originalName: string): Promise<VideoScaleResult> {
  const ffmpeg = await getFFmpeg();
  const prefix = uniqueFFmpegPrefix('scale');
  const inputName = prefix + 'input.' + guessFormat(originalName);
  const outputName = prefix + 'output.mp4';
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(blob));
    const code = await ffmpeg.exec([
      '-i', inputName,
      '-vf', 'scale=' + size.width + ':' + size.height + ':flags=lanczos',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      outputName,
    ]);
    assertFFmpegExitCode(code);
    const data = await ffmpeg.readFile(outputName);
    return { blob: new Blob([data], { type: 'video/mp4' }), width: size.width, height: size.height };
  } finally {
    await deleteFFmpegFiles(ffmpeg, [inputName, outputName]);
  }
}

// 浏览器原生解不了的编码（H.265/HEVC、ProRes 等）在入库前转为 H.264 MP4。
// 只取第一条视频轨 + 可选第一条音轨；宽高取偶数以满足 yuv420p。
export interface VideoTranscodeOptions {
  // 首次使用时 ffmpeg core 的下载进度（0–1）；已加载时不回调。
  onDownloadProgress?: (ratio: number) => void;
  // 转码进度（0–1）。
  onProgress?: (ratio: number) => void;
  // 取消：终止 ffmpeg 实例并以 AbortError 拒绝；下一个任务重新加载干净实例。
  signal?: AbortSignal;
  // 输出长边上限（只缩不放），默认 1920。
  maxEdge?: number;
  // 仅作画布预览：去音轨、帧率上限 24、CRF 28，换取数倍转码速度。
  previewOnly?: boolean;
}

// 入库转码只为让浏览器能解码预览、作参考素材：ultrafast + 长边限 1920（≈1080p），比 veryfast 原分辨率快数倍。
const H264_MAX_EDGE = 1920;
const PREVIEW_MAX_FPS = '24';

export async function transcodeVideoToH264(blob: Blob, originalName = 'video.mp4', options: VideoTranscodeOptions = {}): Promise<Blob> {
  options.signal?.throwIfAborted();
  return enqueueFFmpegTask(() => transcodeVideoToH264OnFFmpeg(blob, originalName, options));
}

async function transcodeVideoToH264OnFFmpeg(blob: Blob, originalName: string, { onDownloadProgress, onProgress, signal, maxEdge = H264_MAX_EDGE, previewOnly = false }: VideoTranscodeOptions): Promise<Blob> {
  // 排队期间可能已被取消。
  signal?.throwIfAborted();
  const ffmpeg = await getFFmpeg({ onDownloadProgress });
  signal?.throwIfAborted();
  const prefix = uniqueFFmpegPrefix('h264');
  const inputName = prefix + 'input.' + guessFormat(originalName);
  const outputName = prefix + 'output.mp4';
  const handleProgress = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) onProgress?.(Math.min(1, Math.max(0, progress)));
  };
  // 取消即终止实例：进行中的 exec 以 terminated 拒绝。
  const abort = () => resetFFmpeg();
  signal?.addEventListener('abort', abort, { once: true });
  ffmpeg.on?.('progress', handleProgress);
  try {
    await ffmpeg.writeFile(inputName, await fetchFile(blob));
    const code = await ffmpeg.exec([
      '-i', inputName,
      '-map', '0:v:0', ...(previewOnly ? ['-an'] : ['-map', '0:a:0?']),
      // 只缩不放：小于 maxEdge 的保持原尺寸；宽高取偶数满足 yuv420p。
      '-vf', "scale='min(iw," + maxEdge + ")':'min(ih," + maxEdge + ")':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', previewOnly ? '28' : '23', '-pix_fmt', 'yuv420p',
      // 预览只降不升帧率（-fpsmax，低于 24fps 的源保持原样）；完整转码保留音轨。
      ...(previewOnly ? ['-fpsmax', PREVIEW_MAX_FPS] : ['-c:a', 'aac', '-b:a', '160k']),
      '-movflags', '+faststart',
      outputName,
    ]);
    signal?.throwIfAborted();
    assertFFmpegExitCode(code);
    const data = await ffmpeg.readFile(outputName);
    return new Blob([data], { type: 'video/mp4' });
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    ffmpeg.off?.('progress', handleProgress);
    await deleteFFmpegFiles(ffmpeg, [inputName, outputName]);
  }
}

export async function splitAudioVideo(blob: Blob, originalName = 'video.mp4'): Promise<VideoAvSplitResult> {
  return enqueueFFmpegTask(() => splitAudioVideoOnFFmpeg(blob, originalName));
}

async function splitAudioVideoOnFFmpeg(blob: Blob, originalName: string): Promise<VideoAvSplitResult> {
  const ffmpeg = await getFFmpeg();
  const format = guessFormat(originalName);
  const prefix = uniqueFFmpegPrefix('avsplit');
  const inputName = `${prefix}input.${format}`;
  const videoOutput = `${prefix}video_only.${format}`;
  const audioOutput = `${prefix}audio_only.mp3`;

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(blob));
    // 先提取音轨：无音轨的视频会在这里失败，直接给出明确原因，避免白做视频轨。
    const audioCode = await ffmpeg.exec(['-i', inputName, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', audioOutput]);
    if (audioCode !== 0) throw new Error('未能提取音轨：源视频可能没有音频，无需分离');
    // 提取纯视频轨 (静音)
    const videoCode = await ffmpeg.exec(['-i', inputName, '-an', '-c:v', 'copy', videoOutput]);
    assertFFmpegExitCode(videoCode);

    const videoData = await ffmpeg.readFile(videoOutput);
    const audioData = await ffmpeg.readFile(audioOutput);
    return {
      videoBlob: new Blob([videoData], { type: `video/${format}` }),
      audioBlob: new Blob([audioData], { type: 'audio/mpeg' }),
    };
  } finally {
    await deleteFFmpegFiles(ffmpeg, [inputName, videoOutput, audioOutput]);
  }
}

export async function mergeVideos(blobs: Blob[], originalNames: string[], audioBlob?: Blob): Promise<Blob> {
  return enqueueFFmpegTask(() => mergeVideosOnFFmpeg(blobs, originalNames, audioBlob));
}

async function mergeVideosOnFFmpeg(blobs: Blob[], originalNames: string[], audioBlob?: Blob): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  if (blobs.length < 2) throw new Error('至少需要 2 个视频片段才能拼接');

  const prefix = uniqueFFmpegPrefix('merge');
  const inputNames = blobs.map((_, i) => `${prefix}input${i}.${guessFormat(originalNames[i] || `clip${i}.mp4`)}`);
  const listName = `${prefix}concat_list.txt`;
  const audioTrackName = `${prefix}audio_track.mp3`;
  const outputName = `${prefix}merged.mp4`;
  const written: string[] = [...inputNames, listName];

  try {
    // 写入所有输入文件
    for (let i = 0; i < blobs.length; i++) {
      await ffmpeg.writeFile(inputNames[i], await fetchFile(blobs[i]));
    }

    // 创建 concat list 文件
    const listContent = inputNames.map(name => `file '${name}'`).join('\n');
    await ffmpeg.writeFile(listName, new TextEncoder().encode(listContent));

    // 叠加音频轨时不能保留全局 -c copy：它会错位作用到第二个输入上，
    // 必须显式映射流并分别指定视频/音频编码。
    let args: string[];
    if (audioBlob) {
      written.push(audioTrackName);
      await ffmpeg.writeFile(audioTrackName, await fetchFile(audioBlob));
      args = [
        '-f', 'concat', '-safe', '0', '-i', listName,
        '-i', audioTrackName,
        '-map', '0:v', '-map', '1:a',
        '-c:v', 'copy', '-c:a', 'aac',
        '-shortest',
        outputName,
      ];
    } else {
      args = ['-f', 'concat', '-safe', '0', '-i', listName, '-c', 'copy', outputName];
    }

    const code = await ffmpeg.exec(args);
    assertFFmpegExitCode(code);
    const data = await ffmpeg.readFile(outputName);
    return new Blob([data], { type: 'video/mp4' });
  } finally {
    await deleteFFmpegFiles(ffmpeg, [...written, outputName]);
  }
}

// 获取视频时长 (秒)
export async function getVideoDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(url);
      resolve(duration || 0);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    video.src = url;
  });
}
