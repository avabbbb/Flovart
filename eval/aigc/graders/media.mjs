// Local media probing for the objective track: ffprobe for container facts,
// ffmpeg for a tiny grayscale frame stream (dynamic degree). Nothing here
// touches the network; remote URIs are reported as unresolved, never fetched.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FFPROBE = process.env.IRIS_FFPROBE || 'ffprobe';
export const FFMPEG = process.env.IRIS_FFMPEG || 'ffmpeg';

export function toolAvailable(bin = FFPROBE) {
  const result = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

/**
 * Resolve an asset / output URI to a local path.
 * fixture:<name> → <fixturesDir>/<name>; file:// → path; relative → mediaRoot; http(s)/artifact → null.
 */
export function resolveMediaUri(uri, { mediaRoot = process.cwd(), fixturesDir } = {}) {
  if (typeof uri !== 'string' || !uri) return null;
  if (uri.startsWith('fixture:')) return fixturesDir ? join(fixturesDir, uri.slice('fixture:'.length)) : null;
  if (uri.startsWith('file://')) return fileURLToPath(uri);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return null;
  return isAbsolute(uri) ? uri : resolve(mediaRoot, uri);
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const num = value => (value === undefined || value === null || value === 'N/A' ? null : Number(value));

/** ffprobe a file. Returns { ok, error?, sizeBytes, durationSec, video, audio, streams }. */
export function probe(path) {
  if (!path || !existsSync(path)) return { ok: false, error: 'file not found' };
  const sizeBytes = statSync(path).size;
  if (!sizeBytes) return { ok: false, error: 'empty file', sizeBytes };
  const result = spawnSync(FFPROBE, ['-v', 'error', '-show_entries',
    'format=duration,format_name:stream=index,codec_type,codec_name,width,height,duration,sample_rate,channels,nb_frames,avg_frame_rate',
    '-of', 'json', path], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) return { ok: false, error: `ffprobe unavailable: ${result.error.message}`, sizeBytes };
  // Keep only the file name in messages: results must not leak local directory layout.
  if (result.status !== 0) return { ok: false, error: (result.stderr || 'ffprobe failed').split(path).join(basename(path)).replace(/\[[^\]]*@ 0x[0-9a-f]+\]\s*/g, '').trim().slice(0, 300), sizeBytes };
  let json;
  try { json = JSON.parse(result.stdout); } catch { return { ok: false, error: 'ffprobe output is not JSON', sizeBytes }; }
  const streams = (json.streams ?? []).map(stream => ({
    type: stream.codec_type,
    codec: stream.codec_name,
    width: num(stream.width),
    height: num(stream.height),
    durationSec: num(stream.duration),
    sampleRate: num(stream.sample_rate),
    channels: num(stream.channels),
  }));
  if (!streams.length) return { ok: false, error: 'no streams', sizeBytes };
  // Still images report a video stream with codec png / mjpeg etc. and no meaningful duration.
  const video = streams.find(stream => stream.type === 'video') ?? null;
  const audio = streams.find(stream => stream.type === 'audio') ?? null;
  return { ok: true, sizeBytes, durationSec: num(json.format?.duration), format: json.format?.format_name ?? null, video, audio, streams };
}

/**
 * Decode a video to a tiny grayscale stream (fps × 32×18) and return the mean absolute
 * difference between consecutive frames, normalised to 0..1. Deterministic for a given file.
 */
export function frameDifferences(path, { fps = 4, width = 32, height = 18, maxFrames = 240 } = {}) {
  const result = spawnSync(FFMPEG, ['-v', 'error', '-i', path, '-vf', `fps=${fps},scale=${width}:${height}:flags=area,format=gray`,
    '-frames:v', String(maxFrames), '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
  if (result.error) return { ok: false, error: `ffmpeg unavailable: ${result.error.message}` };
  if (result.status !== 0) return { ok: false, error: String(result.stderr || 'ffmpeg failed').split(path).join(basename(path)).trim().slice(0, 300) };
  const size = width * height;
  const data = result.stdout;
  const frames = Math.floor(data.length / size);
  if (frames < 2) return { ok: false, error: `only ${frames} frame(s) decoded` };
  const diffs = [];
  for (let index = 1; index < frames; index += 1) {
    let sum = 0;
    const a = (index - 1) * size;
    const b = index * size;
    for (let pixel = 0; pixel < size; pixel += 1) sum += Math.abs(data[a + pixel] - data[b + pixel]);
    diffs.push(sum / size / 255);
  }
  return { ok: true, frames, diffs };
}
