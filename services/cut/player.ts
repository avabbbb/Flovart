// 预览播放器：视频按 rAF 拉帧（解码流顺序前进，暂停 / 拖动时随机访问），
// 音频按 1 秒小块离线混音后排进实时 AudioContext。dispose() 关掉所有流与 AudioContext。
import { CutStreamPool, renderCutFrame, projectHasAudio, type CutRenderBackend, type Ctx2D } from './render';
import { projectDuration, type CutProject } from './timeline';

const AUDIO_CHUNK = 1;
const AUDIO_LOOKAHEAD = 1.5;

export interface CutPlayerOptions {
  backend: CutRenderBackend;
  canvas: HTMLCanvasElement;
  getProject: () => CutProject;
  onTime?: (t: number) => void;
  onPlayingChange?: (playing: boolean) => void;
}

export class CutPlayer {
  private ctx: Ctx2D;
  private pool: CutStreamPool;
  private time = 0;
  private playing = false;
  private raf = 0;
  private wallStart = 0;
  private timeStart = 0;
  private rendering = false;
  private pendingRender: number | null = null;
  private audio: AudioContext | null = null;
  private audioNodes = new Set<AudioBufferSourceNode>();
  private audioCursor = 0;
  private audioBase = 0;
  private audioBusy = false;
  private generation = 0;
  private disposed = false;

  constructor(private options: CutPlayerOptions) {
    const ctx = options.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available.');
    this.ctx = ctx;
    this.pool = new CutStreamPool(options.backend, { width: options.canvas.width, height: options.canvas.height }, { preferProxy: true });
  }

  get currentTime() { return this.time; }
  get isPlaying() { return this.playing; }

  /** 画一帧（合并并发请求，只画最新的时刻）。 */
  render(t = this.time) {
    this.pendingRender = t;
    if (this.rendering) return;
    void this.drain();
  }

  private async drain() {
    this.rendering = true;
    try {
      while (this.pendingRender !== null && !this.disposed) {
        const t = this.pendingRender;
        this.pendingRender = null;
        await renderCutFrame(this.ctx, this.options.getProject(), t, this.pool, this.options.backend, { width: this.options.canvas.width, height: this.options.canvas.height });
      }
    } catch (error) {
      console.warn('[cut] preview render failed', error);
    } finally {
      this.rendering = false;
    }
  }

  seek(t: number) {
    const duration = projectDuration(this.options.getProject());
    this.time = Math.max(0, Math.min(t, duration));
    if (this.playing) this.restartClock();
    this.options.onTime?.(this.time);
    this.render(this.time);
  }

  play() {
    if (this.playing || this.disposed) return;
    const duration = projectDuration(this.options.getProject());
    if (duration <= 0) return;
    if (this.time >= duration - 1e-3) this.time = 0;
    this.playing = true;
    this.options.onPlayingChange?.(true);
    this.restartClock();
    const loop = () => {
      if (!this.playing) return;
      const now = this.timeStart + (performance.now() - this.wallStart) / 1000;
      const end = projectDuration(this.options.getProject());
      if (now >= end) {
        this.time = end;
        this.options.onTime?.(end);
        this.pause();
        return;
      }
      this.time = now;
      this.options.onTime?.(now);
      if (!this.rendering) this.render(now);
      void this.pumpAudio();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopAudio();
    this.options.onPlayingChange?.(false);
    this.render(this.time);
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  private restartClock() {
    this.wallStart = performance.now();
    this.timeStart = this.time;
    this.stopAudio();
    const project = this.options.getProject();
    if (!projectHasAudio(project)) return;
    try {
      this.audio ??= new AudioContext({ latencyHint: 'playback' });
      void this.audio.resume();
      this.audioCursor = this.time;
      this.audioBase = this.audio.currentTime + 0.05 - this.time;
      void this.pumpAudio();
    } catch (error) {
      console.warn('[cut] audio preview unavailable', error);
    }
  }

  private async pumpAudio() {
    const audio = this.audio;
    if (!audio || this.audioBusy || !this.playing) return;
    const project = this.options.getProject();
    const end = projectDuration(project);
    const generation = this.generation;
    this.audioBusy = true;
    try {
      while (this.playing && generation === this.generation && this.audioCursor < Math.min(end, this.time + AUDIO_LOOKAHEAD)) {
        const from = this.audioCursor;
        const to = Math.min(end, from + AUDIO_CHUNK);
        const buffer = await this.options.backend.mixAudio(project, from, to, audio.sampleRate);
        if (!this.playing || generation !== this.generation) break;
        const node = audio.createBufferSource();
        node.buffer = buffer;
        node.connect(audio.destination);
        const when = this.audioBase + from;
        const lateBy = Math.max(0, audio.currentTime - when);
        if (lateBy < buffer.duration) node.start(Math.max(audio.currentTime, when), lateBy);
        node.onended = () => this.audioNodes.delete(node);
        this.audioNodes.add(node);
        this.audioCursor = to;
      }
    } catch (error) {
      console.warn('[cut] audio chunk failed', error);
    } finally {
      this.audioBusy = false;
    }
  }

  private stopAudio() {
    this.generation += 1;
    for (const node of this.audioNodes) { try { node.stop(); } catch { /* already stopped */ } node.disconnect(); }
    this.audioNodes.clear();
  }

  /** 时间线变化后（剪切 / 移动等）丢掉旧流，重画当前帧。 */
  invalidate() {
    this.pool.closeAll();
    if (this.playing) this.restartClock();
    this.render(this.time);
  }

  dispose() {
    this.disposed = true;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopAudio();
    this.pool.closeAll();
    void this.audio?.close().catch(() => undefined);
    this.audio = null;
  }
}
