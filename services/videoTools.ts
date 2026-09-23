// 视频工具：基于 ffmpeg.wasm 的纯前端视频处理
// trim: 裁取子片段 (stream copy, 极快)
// avSplit: 音视频分离
// merge: 多片段拼接

import { getFFmpeg } from './ffmpegClient';
import { fetchFile } from '@ffmpeg/util';
import { nanoid } from 'nanoid';

export interface VideoTrimResult {
  blob: Blob;
  durationSec: number;
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

export function enqueueFFmpegTask<T>(task: () => Promise<T>): Promise<T> {
  const run = ffmpegQueueTail.then(task, task);
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

export async function trimVideo(blob: Blob, startSec: number, endSec: number, originalName = 'video.mp4'): Promise<VideoTrimResult> {
  return enqueueFFmpegTask(() => trimVideoOnFFmpeg(blob, startSec, endSec, originalName));
}

async function trimVideoOnFFmpeg(blob: Blob, startSec: number, endSec: number, originalName: string): Promise<VideoTrimResult> {
  const ffmpeg = await getFFmpeg();
  const format = guessFormat(originalName);
  const prefix = uniqueFFmpegPrefix('trim');
  const inputName = `${prefix}input.${format}`;
  const outputName = `${prefix}output.${format}`;

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(blob));
    // stream copy — 无需重编码，极快
    const code = await ffmpeg.exec([
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
    // 提取纯视频轨 (静音)
    const videoCode = await ffmpeg.exec(['-i', inputName, '-an', '-c:v', 'copy', videoOutput]);
    assertFFmpegExitCode(videoCode);
    // 提取纯音频轨
    const audioCode = await ffmpeg.exec(['-i', inputName, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', audioOutput]);
    assertFFmpegExitCode(audioCode);

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
