// 音频工具：基于 ffmpeg.wasm 的纯前端音频处理
// trim: 截取音频片段 (stream copy, 极快)
// speed: 变速 (atempo 滤镜, 0.5x~2.0x)

import { getFFmpeg } from './ffmpegClient';
import { fetchFile } from '@ffmpeg/util';

export interface AudioTrimResult {
  blob: Blob;
  durationSec: number;
}

function guessAudioFormat(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'wav') return 'wav';
  if (ext === 'aac') return 'aac';
  if (ext === 'flac') return 'flac';
  if (ext === 'ogg') return 'ogg';
  if (ext === 'm4a') return 'm4a';
  return 'mp3';
}

function audioMime(format: string): string {
  if (format === 'wav') return 'audio/wav';
  if (format === 'aac') return 'audio/aac';
  if (format === 'flac') return 'audio/flac';
  if (format === 'ogg') return 'audio/ogg';
  if (format === 'm4a') return 'audio/mp4';
  return 'audio/mpeg';
}

export async function trimAudio(blob: Blob, startSec: number, endSec: number, originalName = 'audio.mp3'): Promise<AudioTrimResult> {
  const ffmpeg = await getFFmpeg();
  const format = guessAudioFormat(originalName);
  const inputName = `input.${format}`;
  const outputName = `output.${format}`;

  await ffmpeg.writeFile(inputName, await fetchFile(blob));
  await ffmpeg.exec([
    '-i', inputName,
    '-ss', String(startSec),
    '-to', String(endSec),
    '-c', 'copy',
    outputName,
  ]);

  const data = await ffmpeg.readFile(outputName);
  const trimmedBlob = new Blob([data], { type: blob.type || audioMime(format) });
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);
  return { blob: trimmedBlob, durationSec: endSec - startSec };
}

export async function changeAudioSpeed(blob: Blob, speed: number, originalName = 'audio.mp3'): Promise<Blob> {
  const ffmpeg = await getFFmpeg();
  const format = guessAudioFormat(originalName);
  const inputName = `input.${format}`;
  // atempo 滤镜支持 0.5~2.0，超出范围需链式
  const outputName = `output.mp3`;

  await ffmpeg.writeFile(inputName, await fetchFile(blob));

  // 链式 atempo: 4x = atempo=2.0,atempo=2.0; 0.25x = atempo=0.5,atempo=0.5
  const atempoChain = buildAtempoChain(speed);
  await ffmpeg.exec([
    '-i', inputName,
    '-filter:a', atempoChain,
    '-vn',
    '-acodec', 'libmp3lame',
    '-q:a', '2',
    outputName,
  ]);

  const data = await ffmpeg.readFile(outputName);
  const resultBlob = new Blob([data], { type: 'audio/mp3' });
  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);
  return resultBlob;
}

function buildAtempoChain(speed: number): string {
  const factors: number[] = [];
  let remaining = speed;
  while (remaining > 2.0) {
    factors.push(2.0);
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(Math.round(remaining * 100) / 100);
  return factors.map(f => `atempo=${f}`).join(',');
}

// 获取音频时长 (秒)
export async function getAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      URL.revokeObjectURL(url);
      resolve(duration || 0);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    audio.src = url;
  });
}
