// 视频工具：基于 ffmpeg.wasm 的纯前端视频处理
// trim: 裁取子片段 (stream copy, 极快)
// avSplit: 音视频分离
// merge: 多片段拼接

import { getFFmpeg } from './ffmpegClient';
import { fetchFile } from '@ffmpeg/util';

export interface VideoTrimResult {
  blob: Blob;
  durationSec: number;
}

export interface VideoAvSplitResult {
  videoBlob: Blob;
  audioBlob: Blob;
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
  const ffmpeg = await getFFmpeg();
  const format = guessFormat(originalName);
  const inputName = `input.${format}`;
  const outputName = `output.${format}`;

  await ffmpeg.writeFile(inputName, await fetchFile(blob));
  // stream copy — 无需重编码，极快
  await ffmpeg.exec([
    '-i', inputName,
    '-ss', String(startSec),
    '-to', String(endSec),
    '-c', 'copy',
    outputName,
  ]);

  const data = await ffmpeg.readFile(outputName);
  const trimmedBlob = new Blob([data], { type: blob.type || `video/${format}` });
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);
  return { blob: trimmedBlob, durationSec: endSec - startSec };
}

export async function splitAudioVideo(blob: Blob, originalName = 'video.mp4'): Promise<VideoAvSplitResult> {
  const ffmpeg = await getFFmpeg();
  const format = guessFormat(originalName);
  const inputName = `input.${format}`;
  const videoOutput = `video_only.${format}`;
  const audioOutput = 'audio_only.mp3';

  await ffmpeg.writeFile(inputName, await fetchFile(blob));
  // 提取纯视频轨 (静音)
  await ffmpeg.exec(['-i', inputName, '-an', '-c:v', 'copy', videoOutput]);
  // 提取纯音频轨
  await ffmpeg.exec(['-i', inputName, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', audioOutput]);

  const videoData = await ffmpeg.readFile(videoOutput);
  const audioData = await ffmpeg.readFile(audioOutput);
  const videoBlob = new Blob([videoData], { type: `video/${format}` });
  const audioBlob = new Blob([audioData], { type: 'audio/mp3' });

  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(videoOutput);
  await ffmpeg.deleteFile(audioOutput);

  return { videoBlob, audioBlob };
}

export async function mergeVideos(blobs: Blob[], originalNames: string[], audioBlob?: Blob): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  if (blobs.length < 2) throw new Error('至少需要 2 个视频片段才能拼接');

  // 写入所有输入文件
  for (let i = 0; i < blobs.length; i++) {
    const format = guessFormat(originalNames[i] || `clip${i}.mp4`);
    await ffmpeg.writeFile(`input${i}.${format}`, await fetchFile(blobs[i]));
  }

  // 创建 concat list 文件
  const listContent = blobs.map((_, i) => {
    const format = guessFormat(originalNames[i] || `clip${i}.mp4`);
    return `file 'input${i}.${format}'`;
  }).join('\n');
  await ffmpeg.writeFile('concat_list.txt', new TextEncoder().encode(listContent));

  const outputName = 'merged.mp4';
  const args = ['-f', 'concat', '-safe', '0', '-i', 'concat_list.txt', '-c', 'copy', outputName];

  // 如果有叠加音频轨
  if (audioBlob) {
    await ffmpeg.writeFile('audio_track.mp3', await fetchFile(audioBlob));
    args.splice(-1, 0, '-i', 'audio_track.mp3', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest');
  }

  await ffmpeg.exec(args);
  const data = await ffmpeg.readFile(outputName);
  const mergedBlob = new Blob([data], { type: 'video/mp4' });

  // 清理
  for (let i = 0; i < blobs.length; i++) {
    const format = guessFormat(originalNames[i] || `clip${i}.mp4`);
    await ffmpeg.deleteFile(`input${i}.${format}`);
  }
  await ffmpeg.deleteFile('concat_list.txt');
  await ffmpeg.deleteFile(outputName);
  if (audioBlob) await ffmpeg.deleteFile('audio_track.mp3');

  return mergedBlob;
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
