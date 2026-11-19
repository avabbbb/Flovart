// 合成 + 导出管线（与解码 / 编码实现解耦：后端与编码器都是接口，单测里用假的）。
// 内存模型：逐帧拉取。每个正在播放的视频片段只开一条解码流（WebCodecs），片段结束立即关掉；
// 音频按小块（默认 2 秒）离线混音后交给编码器——任何时刻都不持有整段解码后的音视频。
import { clipEnd, clipSpeed, clipsAt, effectiveTextStyle, findSource, projectDuration, sourceTimeAt, transformAt, type CutClip, type CutProject, type CutTextStyle } from './timeline';

export type Drawable = CanvasImageSource & { width: number; height: number };
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** 一条视频片段的顺序解码流：frameAt 只能大致单调向前；回退或大跳时实现方自行重开。 */
export interface CutFrameStream {
  frameAt(sourceTime: number): Promise<Drawable | null>;
  close(): void;
}

export interface CutRenderBackend {
  openVideoStream(clip: CutClip, size: { width: number; height: number }, options?: { preferProxy?: boolean }): CutFrameStream | null;
  getImage(sourceId: string): Promise<Drawable | null>;
  /** 把 [from, to) 的所有有声片段混成一块立体声 AudioBuffer（没有声音的区间返回静音块，保证音轨时间连续）。 */
  mixAudio(project: CutProject, from: number, to: number, sampleRate: number): Promise<AudioBuffer>;
}

export interface CutEncoder {
  /** 编码器要画的画布（合成直接画在上面，CanvasSource 读它）。 */
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly sampleRate: number;
  readonly hasAudio: boolean;
  start(): Promise<void>;
  addVideoFrame(timestamp: number, duration: number): Promise<void>;
  addAudio(buffer: AudioBuffer): Promise<void>;
  finalize(): Promise<Blob>;
  cancel(): Promise<void>;
}

export interface CutExportProgress { progress: number; frame: number; frames: number; phase: 'video' | 'finalizing' | 'done' }

export class CutExportCancelled extends Error {
  constructor() { super('Export cancelled'); this.name = 'CutExportCancelled'; }
}

// ── 合成 ────────────────────────────────────────────────────────────────

const FALLBACK_FONTS = 'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif';

export function cssFontFamily(family?: string) {
  if (!family) return FALLBACK_FONTS;
  return `"${family.replace(/"/g, '')}", ${FALLBACK_FONTS}`;
}

function drawMedia(ctx: Ctx2D, image: Drawable, width: number, height: number, clip: CutClip, t: number) {
  const iw = image.width || width;
  const ih = image.height || height;
  const transform = transformAt(clip, t - clip.start);
  if (transform.opacity <= 0) return;
  const scale = Math.min(width / iw, height / ih) * transform.scale;
  const w = iw * scale;
  const h = ih * scale;
  const x = (width - w) / 2 + transform.x * width;
  const y = (height - h) / 2 + transform.y * height;
  if (transform.opacity < 1) {
    ctx.save();
    ctx.globalAlpha = transform.opacity;
    ctx.drawImage(image, x, y, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(image, x, y, w, h);
  }
}

/** 文字块的版面（预览拖动框与绘制共用）。 */
export function textBox(ctx: Ctx2D, text: string, style: CutTextStyle, width: number, height: number) {
  const size = Math.max(8, Math.round(style.size * height));
  ctx.font = `${style.bold === false ? 500 : 700} ${size}px ${cssFontFamily(style.fontFamily)}`;
  const lines = text.split('\n');
  const lineHeight = size * 1.25;
  const blockHeight = lineHeight * lines.length;
  const blockWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
  const cx = Math.min(width - blockWidth / 2, Math.max(blockWidth / 2, (style.x ?? 0.5) * width));
  const cy = Math.min(height - blockHeight / 2, Math.max(blockHeight / 2, style.y * height));
  return { size, lines, lineHeight, blockHeight, blockWidth, cx, cy };
}

export function drawStyledText(ctx: Ctx2D, text: string, style: CutTextStyle, width: number, height: number) {
  const value = text.trim();
  if (!value) return;
  ctx.save();
  const box = textBox(ctx, value, style, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (style.background) {
    const padX = box.size * 0.45;
    const padY = box.size * 0.2;
    ctx.fillStyle = style.backgroundColor || 'rgba(0,0,0,0.55)';
    ctx.fillRect(box.cx - box.blockWidth / 2 - padX, box.cy - box.blockHeight / 2 - padY, box.blockWidth + padX * 2, box.blockHeight + padY * 2);
  }
  const stroke = (style.strokeWidth ?? 0) > 0 && style.strokeColor;
  box.lines.forEach((line, index) => {
    const y = box.cy - box.blockHeight / 2 + box.lineHeight * (index + 0.5);
    if (stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1, box.size * (style.strokeWidth ?? 0));
      ctx.strokeStyle = style.strokeColor!;
      ctx.strokeText(line, box.cx, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, box.cx, y);
  });
  ctx.restore();
}

export function drawText(ctx: Ctx2D, clip: CutClip, width: number, height: number, project?: CutProject) {
  const style = project ? effectiveTextStyle(project, clip) : { size: 0.07, color: '#ffffff', y: 0.82, background: true, ...(clip.textStyle || {}) };
  drawStyledText(ctx, clip.text || '', style, width, height);
}

/**
 * 管理"当前活跃片段 → 解码流"的映射：片段进入时开流，离开时关流。
 * 预览与导出共用。
 */
export class CutStreamPool {
  private streams = new Map<string, CutFrameStream | null>();
  constructor(private backend: CutRenderBackend, private size: { width: number; height: number }, private options: { preferProxy?: boolean } = {}) {}

  get openCount() { return [...this.streams.values()].filter(Boolean).length; }

  /** 只保留 active 里的流，其余关掉。 */
  retain(active: CutClip[]) {
    const keep = new Set(active.filter(clip => clip.kind === 'video').map(clip => clip.id));
    for (const [id, stream] of this.streams) {
      if (!keep.has(id)) { stream?.close(); this.streams.delete(id); }
    }
  }

  stream(clip: CutClip): CutFrameStream | null {
    if (!this.streams.has(clip.id)) this.streams.set(clip.id, this.backend.openVideoStream(clip, this.size, this.options));
    return this.streams.get(clip.id) ?? null;
  }

  closeAll() {
    for (const stream of this.streams.values()) stream?.close();
    this.streams.clear();
  }
}

/** 画出时间线在 t 的一帧。 */
export async function renderCutFrame(ctx: Ctx2D, project: CutProject, t: number, pool: CutStreamPool, backend: CutRenderBackend, size: { width: number; height: number }, options: { hideSubtitles?: boolean; preferProxy?: boolean } = {}) {
  const active = clipsAt(project, t);
  pool.retain(active);
  const muted = new Set(project.tracks.filter(track => track.muted && track.kind !== 'audio').map(track => track.id));
  // 先把所有帧取到再一次性画，避免异步交错导致的半帧闪烁。
  const layers = await Promise.all(active.map(async clip => {
    if (muted.has(clip.trackId)) return null;
    if (clip.kind === 'video') {
      const sourceTime = sourceTimeAt(clip, t);
      const stream = pool.stream(clip);
      return sourceTime === null || !stream ? null : { clip, image: await stream.frameAt(sourceTime) };
    }
    if (clip.kind === 'image' && clip.sourceId) return { clip, image: await backend.getImage(clip.sourceId) };
    if (clip.kind === 'text' || clip.kind === 'subtitle') return { clip, image: null };
    return null;
  }));
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size.width, size.height);
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.clip.kind === 'text' || layer.clip.kind === 'subtitle') {
      if (!options.hideSubtitles || layer.clip.kind !== 'subtitle') drawText(ctx, layer.clip, size.width, size.height, project);
    } else if (layer.image) drawMedia(ctx, layer.image, size.width, size.height, layer.clip, t);
  }
}

/** 时间线上是否有任何会出声的片段（决定导出是否带音轨）。 */
export function projectHasAudio(project: CutProject): boolean {
  const muted = new Set(project.tracks.filter(track => track.muted).map(track => track.id));
  return project.clips.some(clip => {
    if (muted.has(clip.trackId) || clip.volume <= 0) return false;
    if (clip.kind === 'audio') return true;
    return clip.kind === 'video' && !!findSource(project, clip.sourceId)?.hasAudio;
  });
}

/** 与 [from, to) 有交集的有声片段 + 各自在块内的偏移。 */
export function audioSegments(project: CutProject, from: number, to: number) {
  const muted = new Set(project.tracks.filter(track => track.muted).map(track => track.id));
  return project.clips.flatMap(clip => {
    if (muted.has(clip.trackId) || clip.volume <= 0) return [];
    const audible = clip.kind === 'audio' || (clip.kind === 'video' && findSource(project, clip.sourceId)?.hasAudio);
    if (!audible) return [];
    const start = Math.max(from, clip.start);
    const end = Math.min(to, clipEnd(clip));
    if (end <= start) return [];
    const speed = clipSpeed(clip);
    return [{ clip, speed, offset: start - from, sourceStart: clip.in + (start - clip.start) * speed, sourceEnd: clip.in + (end - clip.start) * speed }];
  });
}

// ── 导出 ────────────────────────────────────────────────────────────────

export interface CutExportOptions {
  backend: CutRenderBackend;
  encoder: CutEncoder;
  signal?: AbortSignal;
  onProgress?: (progress: CutExportProgress) => void;
  /** 音频块长度（秒）。 */
  audioChunk?: number;
}

export async function exportCutProject(project: CutProject, options: CutExportOptions): Promise<Blob> {
  const { backend, encoder, signal, onProgress } = options;
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('The timeline is empty.');
  const fps = project.fps;
  const frames = Math.max(1, Math.round(duration * fps));
  const size = { width: encoder.canvas.width, height: encoder.canvas.height };
  const ctx = encoder.canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('2D canvas is not available.');
  const pool = new CutStreamPool(backend, size);
  const chunk = options.audioChunk ?? 2;
  let audioCursor = 0;
  const checkCancel = () => { if (signal?.aborted) throw new CutExportCancelled(); };
  try {
    checkCancel();
    await encoder.start();
    for (let frame = 0; frame < frames; frame += 1) {
      checkCancel();
      const t = frame / fps;
      await renderCutFrame(ctx, project, t, pool, backend, size);
      await encoder.addVideoFrame(t, 1 / fps);
      // 音频跟着视频进度推进，交错写入，muxer 不必缓存整条音轨。
      while (encoder.hasAudio && audioCursor < Math.min(duration, t + 1 / fps)) {
        checkCancel();
        const to = Math.min(duration, audioCursor + chunk);
        const buffer = await backend.mixAudio(project, audioCursor, to, encoder.sampleRate);
        await encoder.addAudio(buffer);
        audioCursor = to;
      }
      onProgress?.({ progress: (frame + 1) / frames * 0.98, frame: frame + 1, frames, phase: 'video' });
    }
    checkCancel();
    onProgress?.({ progress: 0.99, frame: frames, frames, phase: 'finalizing' });
    const blob = await encoder.finalize();
    onProgress?.({ progress: 1, frame: frames, frames, phase: 'done' });
    return blob;
  } catch (error) {
    await encoder.cancel().catch(() => undefined);
    throw error;
  } finally {
    pool.closeAll();
  }
}
