import { parseReverseScript } from './narrative';
import { readReference, retimeShots, toScriptBreakdown, wordRangeForShot, wordsText } from './video';
import type { ReferenceReading, ShotWindow } from './video';
import type { ScriptBreakdown } from '../../components/workflow/types';
import type { ReverseNarrative, ReverseScriptSegment, ReverseShot, ReverseVideoProject, ReverseWord } from './types';

// 参考稿 Narrative 段落 → 镜头表 / Workflow 用的文本段。
export function segmentsFromNarrative(narrative: ReverseNarrative, words: readonly ReverseWord[]): ReverseScriptSegment[] {
  return narrative.segments
    .filter((s) => s.tokenEnd > s.tokenStart)
    .map((s) => {
      const range: [number, number] = [s.tokenStart, s.tokenEnd - 1];
      const speaker = narrative.tokens[s.tokenStart]?.speaker;
      return { id: s.id, role: s.role, text: wordsText(words, range), wordRange: range, ...(speaker ? { speaker } : {}) };
    });
}

// 句末：原文以句号 / 问号 / 叹号（可带右引号、右括号）结尾，且不与下一词紧贴（排除 3.5 这类）。
const SENTENCE_END_RE = /[.!?。！？…][”’')）」』]*$/u;

function isSentenceEnd(word: ReverseWord): boolean {
  return !word.joinNext && SENTENCE_END_RE.test(word.surface ?? word.text);
}

// 每个镜头窗口的台词词区间。先按词中点划分；下一镜头没有 cue（顺延）时，
// 两镜头之间的边界吸附到最近的句末，避免台词在句中断开。只调词的归属；时长由 snapWindowsToSentences 跟进。
export function dialogueRanges(words: readonly ReverseWord[], windows: readonly ShotWindow[]): Map<string, [number, number]> {
  const ranges = windows.map((w) => wordRangeForShot(words, w));
  const ends = words.filter(isSentenceEnd).map((w) => w.index).sort((a, b) => a - b);
  for (let i = 0; i + 1 < windows.length; i += 1) {
    const a = ranges[i];
    const b = ranges[i + 1];
    if (!a || !b || windows[i + 1]!.anchored) continue;
    let best = -1;
    for (const e of ends) {
      if (e < a[0] || e >= b[1]) continue;
      if (best < 0 || Math.abs(e - a[1]) < Math.abs(best - a[1])) best = e;
    }
    if (best < 0) continue;
    ranges[i] = [a[0], best];
    ranges[i + 1] = [best + 1, b[1]];
  }
  const out = new Map<string, [number, number]>();
  windows.forEach((w, i) => {
    const r = ranges[i];
    if (r) out.set(w.shotId, r);
  });
  return out;
}

// 镜头时长跟着句子走：顺延边界上，若前一镜头的台词以句末收尾，
// 边界时间移到句末词结束与下一词开始的中点（无下一词时取句末词结束）。
// 锚定（有 cue）的边界不动；边界夹在两镜头原窗口之间，保证单调、总时长不变。
export function snapWindowsToSentences(
  words: readonly ReverseWord[],
  windows: readonly ShotWindow[],
  ranges: ReadonlyMap<string, [number, number]>,
): ShotWindow[] {
  const byIndex = new Map(words.map((w) => [w.index, w] as const));
  const out = windows.map((w) => ({ ...w }));
  for (let i = 0; i + 1 < out.length; i += 1) {
    const cur = out[i]!;
    const next = out[i + 1]!;
    if (next.anchored) continue;
    const r = ranges.get(cur.shotId);
    const last = r ? byIndex.get(r[1]) : undefined;
    if (!last || last.endMs === undefined || !isSentenceEnd(last)) continue;
    const following = byIndex.get(last.index + 1);
    const boundary = following?.startMs !== undefined ? Math.round((last.endMs + following.startMs) / 2) : last.endMs;
    const ms = Math.min(Math.max(boundary, cur.startMs), next.endMs);
    cur.endMs = ms;
    next.startMs = ms;
  }
  return out;
}

// 目标版：目标稿按参考语速估总时长（没有目标配音前只是估计），
// 镜头按同名 cue 重定时，台词取目标稿落在该镜头窗口内的词（顺延边界吸附句末，时长随之调整）。
export interface TargetPlan {
  reading: ReferenceReading;
  windows: ShotWindow[];
  durationMs: number;
  dialogueFor: (shot: ReverseShot) => string;
}

export function planTarget(project: Pick<ReverseVideoProject, 'analysis' | 'targetScript'>): TargetPlan | null {
  const analysis = project.analysis;
  const script = project.targetScript?.trim();
  if (!analysis || !script || !analysis.shots.length) return null;
  const refCount = analysis.narrative?.tokens.length || analysis.words.length;
  const targetCount = parseReverseScript(script).narrative.tokens.length;
  if (!refCount || !targetCount) return null;
  const durationMs = Math.round(analysis.durationMs / (refCount / targetCount));
  const reading = readReference(script, durationMs);
  const retimed = retimeShots(analysis.shots, reading.narrative, reading.alignment.timings);
  const ranges = dialogueRanges(reading.words, retimed);
  const windows = snapWindowsToSentences(reading.words, retimed, ranges);
  return {
    reading,
    windows,
    durationMs,
    dialogueFor: (shot) => {
      const r = ranges.get(shot.id);
      return r ? wordsText(reading.words, r) : '';
    },
  };
}

// 投影到 Workflow 的镜头表：有目标稿时，时长与台词取目标重定时结果；槽位替换写进动作描述。
// include 只保留需要重新生成的镜头（其余按 key 复用已写出的节点）。
export function projectBreakdown(
  project: Pick<ReverseVideoProject, 'analysis' | 'references' | 'slots' | 'targetScript'>,
  target: TargetPlan | null,
  include?: ReadonlySet<string>,
): ScriptBreakdown {
  const breakdown = toScriptBreakdown(project);
  const shots = project.analysis?.shots ?? [];
  const windows = new Map((target?.windows ?? []).map((w) => [w.shotId, w] as const));
  breakdown.shots = breakdown.shots
    .filter((bs) => !include || include.has(bs.id))
    .map((bs) => {
      const shot = shots.find((s) => s.id === bs.id);
      const next = { ...bs };
      const w = windows.get(bs.id);
      if (target && shot && w) {
        next.durationSec = Math.round((w.endMs - w.startMs) / 100) / 10;
        const line = target.dialogueFor(shot);
        if (line) next.dialogue = line;
        else delete next.dialogue;
      }
      const swaps = project.slots
        .filter((sl) => shot?.slotIds.includes(sl.id) && (sl.replacement || sl.original))
        .map((sl) => sl.label + ': ' + (sl.replacement || sl.original));
      if (swaps.length) next.action = (next.action ? next.action + '; ' : '') + swaps.join('; ');
      return next;
    });
  const targetText = target ? project.targetScript?.trim() : '';
  if (targetText) breakdown.sourceText = targetText;
  return breakdown;
}
