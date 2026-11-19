import { describe, expect, it, vi } from 'vitest';
import {
  audioSegments, CutExportCancelled, exportCutProject, projectHasAudio,
  type CutEncoder, type CutFrameStream, type CutRenderBackend, type Drawable,
} from '../services/cut/render';
import { addClip, addSource, createCutProject, setTrackMuted, type CutProject, type CutSource } from '../services/cut/timeline';
import { detectCutSupport } from '../services/cut/support';

const src = (id: string, kind: CutSource['kind'], duration: number, hasAudio = false): CutSource => ({ id, kind, name: id, duration, hasAudio, origin: { type: 'file', fileName: id } });

function fakeCtx() {
  return {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    save: vi.fn(),
    restore: vi.fn(),
  };
}

class MockEncoder implements CutEncoder {
  readonly ctx = fakeCtx();
  readonly canvas = { width: 320, height: 180, getContext: () => this.ctx } as unknown as OffscreenCanvas;
  readonly sampleRate = 48000;
  frames: Array<{ t: number; d: number }> = [];
  audio: number[] = [];
  started = false;
  cancelled = false;
  constructor(readonly hasAudio: boolean) {}
  async start() { this.started = true; }
  async addVideoFrame(t: number, d: number) { this.frames.push({ t, d }); }
  async addAudio(buffer: AudioBuffer) { this.audio.push(buffer.duration); }
  async finalize() { return new Blob(['mp4'], { type: 'video/mp4' }); }
  async cancel() { this.cancelled = true; }
}

function mockBackend() {
  const opened: string[] = [];
  const closed: string[] = [];
  const frame = { width: 1920, height: 1080 } as Drawable;
  const backend: CutRenderBackend = {
    openVideoStream: clip => {
      opened.push(clip.id);
      const stream: CutFrameStream = { frameAt: async () => frame, close: () => { closed.push(clip.id); } };
      return stream;
    },
    getImage: async () => ({ width: 800, height: 600 }) as Drawable,
    mixAudio: vi.fn(async (_project: CutProject, from: number, to: number) => ({ duration: to - from }) as AudioBuffer),
  };
  return { backend, opened, closed };
}

function project() {
  let p = createCutProject({ fps: 10 });
  p = addSource(addSource(addSource(p, src('v1', 'video', 2, true)), src('v2', 'video', 1)), src('img', 'image', 0));
  p = addClip(p, { kind: 'video', sourceId: 'v1' }).project; // 0–2
  p = addClip(p, { kind: 'video', sourceId: 'v2' }).project; // 2–3
  p = addClip(p, { kind: 'text', start: 0.5, duration: 1, text: 'Hello' }).project;
  return p;
}

describe('cut export pipeline (mocked encoder)', () => {
  it('encodes one frame per fps tick with correct timestamps', async () => {
    const encoder = new MockEncoder(false);
    const { backend } = mockBackend();
    const progress: number[] = [];
    const blob = await exportCutProject(project(), { backend, encoder, onProgress: item => progress.push(item.progress) });
    expect(blob.type).toBe('video/mp4');
    expect(encoder.started).toBe(true);
    expect(encoder.frames).toHaveLength(30);
    expect(encoder.frames[0]).toEqual({ t: 0, d: 0.1 });
    expect(encoder.frames[29].t).toBeCloseTo(2.9);
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('opens one decode stream per video clip and closes it when the clip ends', async () => {
    const { backend, opened, closed } = mockBackend();
    await exportCutProject(project(), { backend, encoder: new MockEncoder(false) });
    expect(opened).toHaveLength(2);
    expect(closed).toEqual(opened);
  });

  it('draws text overlays only while the text clip is active', async () => {
    const encoder = new MockEncoder(false);
    const { backend } = mockBackend();
    await exportCutProject(project(), { backend, encoder });
    // text clip 0.5–1.5s at 10fps = 10 frames
    expect(encoder.ctx.fillText).toHaveBeenCalledTimes(10);
    expect(encoder.ctx.fillText.mock.calls[0][0]).toBe('Hello');
  });

  it('feeds audio in contiguous chunks covering the whole duration', async () => {
    const encoder = new MockEncoder(true);
    const { backend } = mockBackend();
    await exportCutProject(project(), { backend, encoder, audioChunk: 1 });
    expect(encoder.audio.reduce((sum, value) => sum + value, 0)).toBeCloseTo(3);
    expect(backend.mixAudio).toHaveBeenCalledTimes(3);
  });

  it('cancels mid-way, tells the encoder and releases streams', async () => {
    const encoder = new MockEncoder(false);
    const { backend, opened, closed } = mockBackend();
    const abort = new AbortController();
    const run = exportCutProject(project(), {
      backend,
      encoder,
      signal: abort.signal,
      onProgress: item => { if (item.frame === 5) abort.abort(); },
    });
    await expect(run).rejects.toBeInstanceOf(CutExportCancelled);
    expect(encoder.cancelled).toBe(true);
    expect(encoder.frames.length).toBe(5);
    expect(closed).toEqual(opened);
  });

  it('refuses an empty timeline', async () => {
    await expect(exportCutProject(createCutProject(), { backend: mockBackend().backend, encoder: new MockEncoder(false) })).rejects.toThrow(/empty/);
  });

  it('works out which clips are audible', () => {
    const p = project();
    expect(projectHasAudio(p)).toBe(true); // v1 has audio
    expect(audioSegments(p, 1.5, 2.5).map(segment => [segment.offset, segment.sourceStart, segment.sourceEnd])).toEqual([[0, 1.5, 2]]);
    expect(projectHasAudio(setTrackMuted(p, 'v1', true))).toBe(false);
  });
});

describe('WebCodecs support detection', () => {
  it('reports missing APIs instead of throwing', () => {
    expect(detectCutSupport({})).toEqual({ supported: false, missing: expect.arrayContaining(['VideoEncoder', 'AudioDecoder']) });
    const fn = () => undefined;
    expect(detectCutSupport({ VideoDecoder: fn, VideoEncoder: fn, AudioDecoder: fn, AudioEncoder: fn, VideoFrame: fn, OffscreenCanvas: fn, OfflineAudioContext: fn }).supported).toBe(true);
  });
});
