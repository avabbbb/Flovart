// SRT / WebVTT 导入导出。
// SRT 解析改编自 OpenCut classic apps/web/src/subtitles/srt.ts（MIT，见 third_party/opencut/LICENSE）：
// 同样按空行切块、容忍可选序号行、跳过坏块并计数；这里改成秒为单位，并补上 VTT 与写出。
import type { CutClip } from './timeline';

export interface SubtitleCue { start: number; end: number; text: string }
export interface ParseSubtitleResult { cues: SubtitleCue[]; skipped: number }

const TIMESTAMP_SEPARATOR = /\s*-->\s*/;
const TIME = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/;

function parseTimestamp(input: string): number {
  const match = input.trim().split(/\s+/)[0].match(TIME);
  if (!match) return Number.NaN;
  const [, hours = '0', minutes, seconds, millis] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis.padEnd(3, '0')) / 1000;
}

function stripTags(text: string) {
  return text.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '');
}

/** SRT 与 VTT 共用：块 = 可选序号 / cue id + 时间行 + 文本。 */
function parseBlocks(input: string, vtt: boolean): ParseSubtitleResult {
  const normalized = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return { cues: [], skipped: 0 };
  const blocks = normalized.split(/\n{2,}/);
  const cues: SubtitleCue[] = [];
  let skipped = 0;
  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (vtt && (/^WEBVTT/.test(lines[0] || '') || /^(NOTE|STYLE|REGION)\b/.test(lines[0] || ''))) continue;
    const timeIndex = lines.findIndex(line => TIMESTAMP_SEPARATOR.test(line));
    if (timeIndex < 0 || timeIndex > 1) { skipped += 1; continue; }
    const [rawStart, rawEnd] = lines[timeIndex].split(TIMESTAMP_SEPARATOR);
    const start = parseTimestamp(rawStart || '');
    const end = parseTimestamp(rawEnd || '');
    const text = stripTags(lines.slice(timeIndex + 1).join('\n')).trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) { skipped += 1; continue; }
    cues.push({ start, end, text });
  }
  return { cues, skipped };
}

export function parseSrt(input: string): ParseSubtitleResult { return parseBlocks(input, false); }
export function parseVtt(input: string): ParseSubtitleResult { return parseBlocks(input, true); }

export function parseSubtitleFile(fileName: string, input: string): ParseSubtitleResult {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'vtt' || /^\uFEFF?WEBVTT/.test(input)) return parseVtt(input);
  if (ext === 'srt' || ext === 'txt') return parseSrt(input);
  throw new Error('Unsupported subtitle format (use .srt or .vtt)');
}

function stamp(seconds: number, separator: ',' | '.') {
  const total = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const ms = total % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${separator}${String(ms).padStart(3, '0')}`;
}

export function cuesFromClips(clips: readonly CutClip[]): SubtitleCue[] {
  return clips.filter(clip => clip.kind === 'subtitle' && (clip.text || '').trim())
    .sort((a, b) => a.start - b.start)
    .map(clip => ({ start: clip.start, end: clip.start + clip.duration, text: (clip.text || '').trim() }));
}

export function toSrt(cues: readonly SubtitleCue[]): string {
  return cues.map((cue, index) => `${index + 1}\n${stamp(cue.start, ',')} --> ${stamp(cue.end, ',')}\n${cue.text}`).join('\n\n') + (cues.length ? '\n' : '');
}

export function toVtt(cues: readonly SubtitleCue[]): string {
  return `WEBVTT\n\n${cues.map(cue => `${stamp(cue.start, '.')} --> ${stamp(cue.end, '.')}\n${cue.text}`).join('\n\n')}${cues.length ? '\n' : ''}`;
}

/** 列表里显示 / 编辑用的时间码（m:ss.mmm，也接受秒数或 hh:mm:ss,mmm）。 */
export function formatCueTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds * 1000));
  const m = Math.floor(total / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(total % 1000).padStart(3, '0')}`;
}

export function parseCueTime(input: string): number | null {
  const value = input.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  const match = value.match(/^(?:(\d+):)?(\d+):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!match) return null;
  const [, h = '0', m, s, ms = '0'] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}
