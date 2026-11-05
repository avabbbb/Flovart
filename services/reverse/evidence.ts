import type { ReverseTranscript, ReverseTranscriptWord } from './types';

// L2 语音证据（对照 Hypit speech-evidence 包的概念与命名，本仓库自写；由 transcript.ts 演进）。
// 证据不是语义真相：只提供词文本与输入媒体自己时钟上的时间，缺失时间保持缺失，不推成静音。
// 支持的导入格式（自行实现的格式适配，不引入 WhisperX / Hypit 代码）：
//   hypit.transcript@1：{ format, language?, source?, passages: [{ words: [{ text, start_seconds?, end_seconds?, score? }] }] }
//   WhisperX JSON：{ language?, segments: [{ words: [{ word, start, end, score }] }] } 或 { word_segments: [...] }
//   通用数组：[{ text | word, start, end }]（秒）或 [{ text, startMs, endMs }]（毫秒）

export const HYPIT_TRANSCRIPT_FORMAT = 'hypit.transcript@1';

// 已绑定到某个本地时间域（LocalTemporalDomain.id）的对齐证据；毫秒在该域自己的时钟上。
export interface AlignedTranscriptEvidence {
  domainId: string;
  language?: string;
  source: ReverseTranscript['source'];
  words: ReverseTranscriptWord[];
}

type Loose = Record<string, unknown>;

function asRecord(value: unknown): Loose | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : null;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function secondsToMs(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value / 0.001);
}

function collectWords(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const root = asRecord(raw);
  if (!root) return [];
  const wordSegments = root['word_segments'];
  if (Array.isArray(wordSegments)) return wordSegments;
  const words = root['words'];
  if (Array.isArray(words)) return words;
  const segments = root['segments'] ?? root['passages'];
  if (!Array.isArray(segments)) return [];
  return segments.flatMap((segment: unknown) => {
    const inner = asRecord(segment)?.['words'];
    return Array.isArray(inner) ? inner : [];
  });
}

// 单词：毫秒字段优先，其次秒（WhisperX start/end，hypit start_seconds/end_seconds）。
function readWord(item: unknown): ReverseTranscriptWord | null {
  const r = asRecord(item);
  if (!r) return null;
  const word = r['word'];
  const textValue = r['text'];
  const text = (typeof word === 'string' ? word : typeof textValue === 'string' ? textValue : '').trim();
  if (!text) return null;
  const startMs = finite(r['startMs']) ?? secondsToMs(finite(r['start']) ?? finite(r['start_seconds']));
  const endMs = finite(r['endMs']) ?? secondsToMs(finite(r['end']) ?? finite(r['end_seconds']));
  const score = finite(r['score']);
  return {
    text,
    ...(startMs === undefined ? {} : { startMs }),
    ...(endMs === undefined ? {} : { endMs }),
    ...(score === undefined ? {} : { score }),
  };
}

function sourceOf(raw: unknown): ReverseTranscript['source'] {
  if (Array.isArray(raw)) return 'manual';
  return asRecord(raw)?.['format'] === HYPIT_TRANSCRIPT_FORMAT ? 'hypit.transcript' : 'whisperx';
}

// 任一支持格式 → ReverseTranscript；没有可用词返回 null。
export function parseTranscriptJson(raw: unknown, now = new Date().toISOString()): ReverseTranscript | null {
  const words: ReverseTranscriptWord[] = [];
  for (const item of collectWords(raw)) {
    const word = readWord(item);
    if (word) words.push(word);
  }
  if (!words.length) return null;
  const root = asRecord(raw);
  const language = root && typeof root['language'] === 'string' ? (root['language'] as string) : undefined;
  return { source: sourceOf(raw), words, importedAt: now, ...(language ? { language } : {}) };
}

export function isHypitTranscript(raw: unknown): boolean {
  const root = asRecord(raw);
  return root?.['format'] === HYPIT_TRANSCRIPT_FORMAT && Array.isArray(root['passages']);
}

// 严格入口：只接受 hypit.transcript@1。
export function parseHypitTranscript(raw: unknown, now = new Date().toISOString()): ReverseTranscript | null {
  return isHypitTranscript(raw) ? parseTranscriptJson(raw, now) : null;
}

// 把转写绑定到一个本地时间域，作为对齐 / 投影的输入。
export function toAlignedEvidence(transcript: ReverseTranscript, domainId: string): AlignedTranscriptEvidence {
  return {
    domainId,
    source: transcript.source,
    words: transcript.words.map((w) => ({ ...w })),
    ...(transcript.language ? { language: transcript.language } : {}),
  };
}

export function measuredWordCount(evidence: Pick<AlignedTranscriptEvidence, 'words'>): number {
  return evidence.words.filter((w) => w.startMs !== undefined && w.endMs !== undefined).length;
}

// 证据覆盖的最晚终点（毫秒，本地时钟）；没有任何实测时间返回 undefined。
export function evidenceEndMs(evidence: Pick<AlignedTranscriptEvidence, 'words'>): number | undefined {
  let end: number | undefined;
  for (const w of evidence.words) {
    const t = w.endMs ?? w.startMs;
    if (t !== undefined && (end === undefined || t > end)) end = t;
  }
  return end;
}
