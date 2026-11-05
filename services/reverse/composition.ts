import type { CaptionDocument, CaptionTiming } from './caption';
import type { ShotWindow } from './projection';
import { msToFrame, windowOf } from './temporal';
import type { TemporalWindow, Timeline } from './temporal';

// L5 合成描述（对照 Hypit composition 包的概念与命名，本仓库自写）。
// 只产出数据：轨道（VisualTrack / AudioTrack）与按时间排好的 Present；不渲染、不触碰媒体。
// 镜头表给出画面，字幕定时给出叠加层，音频由调用方给定窗口。

export const VISUAL_Z = 0;
export const CAPTION_Z = 10;

export interface VisualClip {
  shotId: string;
  window: TemporalWindow;
  // 来自 retimeShots：起点是否锚定在 cue 上。
  anchored: boolean;
}

export interface VisualTrack {
  id: string;
  kind: 'visual';
  clips: VisualClip[];
}

export interface AudioClip {
  sourceId: string;
  window: TemporalWindow;
}

export interface AudioTrack {
  id: string;
  kind: 'audio';
  clips: AudioClip[];
}

export type PresentElement =
  | { kind: 'shot'; trackId: string; shotId: string }
  | { kind: 'caption'; cueId: string; text: string };

// 一段时间内、某一层上呈现的元素；order 是全局呈现顺序（按起点、再按 z）。
export interface Present {
  span: TemporalWindow;
  order: number;
  z: number;
  elements: PresentElement[];
}

export interface CompositionDiagnostic {
  code: 'empty-shot' | 'unbound-caption' | 'audio-outside-timeline';
  id: string;
}

export interface Composition {
  timelineId: string;
  visual: VisualTrack;
  audio: AudioTrack[];
  presents: Present[];
  diagnostics: CompositionDiagnostic[];
}

export interface CompositionInput {
  timeline: Timeline;
  // 毫秒在 Timeline 自己的时钟上（目标版的 retimeShots 结果）。
  shots: readonly ShotWindow[];
  captions?: { document: CaptionDocument; timing: CaptionTiming };
  audio?: ReadonlyArray<{ trackId: string; sourceId: string; window: TemporalWindow }>;
}

export function composeReverse(input: CompositionInput): Composition {
  const { timeline } = input;
  const diagnostics: CompositionDiagnostic[] = [];
  const visual: VisualTrack = { id: 'visual', kind: 'visual', clips: [] };
  for (const shot of input.shots) {
    const window = windowOf(timeline, msToFrame(timeline.frameRate, shot.startMs), msToFrame(timeline.frameRate, shot.endMs));
    if (window) visual.clips.push({ shotId: shot.shotId, window, anchored: shot.anchored });
    else diagnostics.push({ code: 'empty-shot', id: shot.shotId });
  }

  const audioTracks = new Map<string, AudioTrack>();
  for (const clip of input.audio ?? []) {
    const inside = clip.window.timelineId === timeline.id ? windowOf(timeline, clip.window.start, clip.window.end) : null;
    if (!inside) {
      diagnostics.push({ code: 'audio-outside-timeline', id: clip.sourceId });
      continue;
    }
    const track: AudioTrack = audioTracks.get(clip.trackId) ?? { id: clip.trackId, kind: 'audio', clips: [] };
    track.clips.push({ sourceId: clip.sourceId, window: inside });
    audioTracks.set(clip.trackId, track);
  }

  const drafts: Array<Omit<Present, 'order'>> = visual.clips.map((clip): Omit<Present, 'order'> => ({
    span: clip.window,
    z: VISUAL_Z,
    elements: [{ kind: 'shot', trackId: visual.id, shotId: clip.shotId }],
  }));
  if (input.captions) {
    const text = new Map(input.captions.document.cues.map((c) => [c.id, c.text] as const));
    for (const cue of input.captions.timing.cues) {
      if (!cue.window) {
        diagnostics.push({ code: 'unbound-caption', id: cue.cueId });
        continue;
      }
      drafts.push({ span: cue.window, z: CAPTION_Z, elements: [{ kind: 'caption', cueId: cue.cueId, text: text.get(cue.cueId) ?? '' }] });
    }
  }
  drafts.sort((a, b) => a.span.start - b.span.start || a.z - b.z);
  const presents = drafts.map((d, order): Present => ({ ...d, order }));
  return { timelineId: timeline.id, visual, audio: [...audioTracks.values()], presents, diagnostics };
}
