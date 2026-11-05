import type { NarrativeProjection } from './projection';
import type { TemporalWindow } from './temporal';
import type { ReverseNarrative, ReverseNarrativeToken } from './types';

// L4 字幕（对照 Hypit caption / narrative-caption 包的概念与命名，本仓库自写）。
// CaptionDocument 只描述"显示什么"：words / units / cues，不含任何时间；
// CaptionTiming 按 token 身份（word.id === token.id）绑定到 NarrativeProjection，绑不上就记诊断，不猜时间。

export interface CaptionWord {
  // 与 narrative token id 相同，是绑定定时的唯一依据。
  id: string;
  // 展示文本：优先 surface（带紧贴标点），否则 token.text。
  text: string;
  segmentId: string;
  speaker?: string;
  joinNext?: boolean;
}

// 一行：同段、同说话人、不超过 maxWordsPerUnit 个词。
export interface CaptionUnit {
  id: string;
  segmentId: string;
  wordIds: string[];
  text: string;
}

// 一屏：同段内连续的若干行。
export interface CaptionCue {
  id: string;
  unitIds: string[];
  text: string;
}

export interface CaptionDocument {
  narrativeId: string;
  words: CaptionWord[];
  units: CaptionUnit[];
  cues: CaptionCue[];
}

export interface CaptionOptions {
  maxWordsPerUnit?: number;
  maxUnitsPerCue?: number;
}

export interface CaptionWordTiming {
  wordId: string;
  window: TemporalWindow | null;
}

export interface CaptionCueTiming {
  cueId: string;
  // 由已绑定词的最早起点到最晚终点；一个词都没绑上为 null。
  window: TemporalWindow | null;
  // 该 cue 的词全部绑定。
  complete: boolean;
}

export interface CaptionDiagnostic {
  code: 'missing-binding' | 'unbound-cue';
  id: string;
}

export interface CaptionTiming {
  timelineId: string;
  words: CaptionWordTiming[];
  cues: CaptionCueTiming[];
  diagnostics: CaptionDiagnostic[];
}

const NEWLINE = String.fromCharCode(10);
const CJK_EDGE_RE = new RegExp('[぀-ヿ㐀-鿿豈-﫿]', 'u');

// 拼接展示文本：joinNext 或两侧都是中日文字符时不加空格。
export function joinCaptionWords(words: readonly Pick<CaptionWord, 'text' | 'joinNext'>[]): string {
  let out = '';
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const tight = !prev || prev.joinNext || (CJK_EDGE_RE.test(prev.text.slice(-1)) && CJK_EDGE_RE.test(w.text.charAt(0)));
    out += (tight ? '' : ' ') + w.text;
  });
  return out;
}

function toCaptionWord(token: ReverseNarrativeToken): CaptionWord {
  return {
    id: token.id,
    text: token.surface ?? token.text,
    segmentId: token.segmentId,
    ...(token.speaker ? { speaker: token.speaker } : {}),
    ...(token.joinNext ? { joinNext: true } : {}),
  };
}

export function captionDocumentFromNarrative(narrative: ReverseNarrative, options: CaptionOptions = {}): CaptionDocument {
  const maxWords = Math.max(1, Math.floor(options.maxWordsPerUnit ?? 6));
  const maxUnits = Math.max(1, Math.floor(options.maxUnitsPerCue ?? 2));
  const words = narrative.tokens.map(toCaptionWord);
  const units: CaptionUnit[] = [];
  let line: CaptionWord[] = [];
  const flush = (): void => {
    if (!line.length) return;
    units.push({ id: 'u' + (units.length + 1), segmentId: line[0]!.segmentId, wordIds: line.map((w) => w.id), text: joinCaptionWords(line) });
    line = [];
  };
  for (const word of words) {
    const head = line[0];
    if (head && (head.segmentId !== word.segmentId || head.speaker !== word.speaker || line.length >= maxWords)) flush();
    line.push(word);
  }
  flush();
  const cues: CaptionCue[] = [];
  let group: CaptionUnit[] = [];
  const flushCue = (): void => {
    if (!group.length) return;
    cues.push({ id: 'c' + (cues.length + 1), unitIds: group.map((u) => u.id), text: group.map((u) => u.text).join(NEWLINE) });
    group = [];
  };
  for (const unit of units) {
    const head = group[0];
    if (head && (head.segmentId !== unit.segmentId || group.length >= maxUnits)) flushCue();
    group.push(unit);
  }
  flushCue();
  return { narrativeId: narrative.id, words, units, cues };
}

// 按 token 身份把字幕绑定到投影；缺失绑定逐词诊断，整屏无词可绑再记 unbound-cue。
export function bindCaptionTiming(doc: CaptionDocument, projection: NarrativeProjection): CaptionTiming {
  const byToken = new Map(projection.tokens.map((t) => [t.tokenId, t.window] as const));
  const diagnostics: CaptionDiagnostic[] = [];
  const words = doc.words.map((w): CaptionWordTiming => {
    const window = byToken.get(w.id) ?? null;
    if (!window) diagnostics.push({ code: 'missing-binding', id: w.id });
    return { wordId: w.id, window };
  });
  const wordWindow = new Map(words.map((w) => [w.wordId, w.window] as const));
  const unitWords = new Map(doc.units.map((u) => [u.id, u.wordIds] as const));
  const cues = doc.cues.map((cue): CaptionCueTiming => {
    const ids = cue.unitIds.flatMap((id) => unitWords.get(id) ?? []);
    const bound = ids.map((id) => wordWindow.get(id) ?? null).filter((w): w is TemporalWindow => w !== null);
    if (!bound.length) {
      diagnostics.push({ code: 'unbound-cue', id: cue.id });
      return { cueId: cue.id, window: null, complete: false };
    }
    const start = Math.min(...bound.map((w) => w.start));
    const end = Math.max(...bound.map((w) => w.end));
    return { cueId: cue.id, window: { timelineId: projection.timelineId, start, end }, complete: bound.length === ids.length };
  });
  return { timelineId: projection.timelineId, words, cues, diagnostics };
}
