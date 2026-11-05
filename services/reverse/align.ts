import { normalizeToken } from './narrative';
import type { ReverseAlignRelation, ReverseNarrativeToken, ReverseTokenTiming, ReverseTranscriptWord } from './types';

// 脚本 token 与转写证据词的单调对齐（编辑距离型动态规划，本仓库自写）。
// 允许 1:N 拆分、N:1 合并、替换（识别错字）、脚本遗漏、证据插入（呃/嗯）。
// 证据不是语义真相：只给脚本 token 定时，缺测 token 在相邻实测之间按字长插值。

export interface AlignGroup {
  tokenStart: number;
  tokenEnd: number;
  wordStart: number;
  wordEnd: number;
  relation: ReverseAlignRelation;
  cost: number;
}

const MAX_GROUP = 3;
const OMISSION_COST = 0.4;
const INSERTION_COST = 0.35;
const REGROUP_COST = 0.05;
const MISMATCH_GROUP_COST = 0.1;
const MISMATCH_SCALE = 0.8;
const EPSILON = 1e-9;

function levenshtein(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const sub = prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      row.push(Math.min(sub, prev[j]! + 1, row[j - 1]! + 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

function groupRelation(tokenCount: number, wordCount: number, equal: boolean): ReverseAlignRelation {
  if (tokenCount === 1 && wordCount === 1) return equal ? 'exact' : 'replacement';
  if (tokenCount === 1) return 'split';
  if (wordCount === 1) return 'merge';
  return 'replacement';
}

export function alignWordGroups(
  tokens: readonly Pick<ReverseNarrativeToken, 'normalized'>[],
  words: readonly ReverseTranscriptWord[],
): AlignGroup[] {
  const src = tokens.map((t) => t.normalized);
  const ev = words.map((w) => normalizeToken(w.text));
  const n = src.length;
  const m = ev.length;
  // 最常见的完全一致稿：线性直出。
  if (n === m && src.every((s, i) => s === ev[i])) {
    return src.map((_, i) => ({ tokenStart: i, tokenEnd: i + 1, wordStart: i, wordEnd: i + 1, relation: 'exact' as const, cost: 0 }));
  }
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(Infinity));
  const back: Array<Array<AlignGroup | null>> = Array.from({ length: n + 1 }, () => new Array<AlignGroup | null>(m + 1).fill(null));
  cost[0]![0] = 0;
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      const base = cost[i]![j]!;
      if (!Number.isFinite(base)) continue;
      const relax = (a: number, b: number, relation: ReverseAlignRelation, c: number): void => {
        const total = base + c;
        if (total < cost[i + a]![j + b]! - EPSILON) {
          cost[i + a]![j + b] = total;
          back[i + a]![j + b] = { tokenStart: i, tokenEnd: i + a, wordStart: j, wordEnd: j + b, relation, cost: c };
        }
      };
      if (i < n) relax(1, 0, 'omission', OMISSION_COST);
      if (j < m) relax(0, 1, 'insertion', INSERTION_COST);
      for (let a = 1; a <= MAX_GROUP && i + a <= n; a += 1) {
        const s = src.slice(i, i + a).join('');
        for (let b = 1; b <= MAX_GROUP && j + b <= m; b += 1) {
          const e = ev.slice(j, j + b).join('');
          const extra = a + b - 2;
          if (s === e) {
            relax(a, b, groupRelation(a, b, true), REGROUP_COST * extra);
          } else {
            const sa = [...s];
            const ea = [...e];
            const ratio = levenshtein(sa, ea) / Math.max(sa.length, ea.length, 1);
            relax(a, b, groupRelation(a, b, false), ratio * MISMATCH_SCALE + MISMATCH_GROUP_COST * extra);
          }
        }
      }
    }
  }
  const groups: AlignGroup[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const group = back[i]![j];
    if (!group) throw new Error('对齐未能形成完整路径');
    groups.push(group);
    i = group.tokenStart;
    j = group.wordStart;
  }
  return groups.reverse();
}

export interface AlignOptions {
  // 参考媒体时长；末尾缺测 token 插值到这里。
  durationMs?: number;
  // 既无右侧实测也无时长时，每个缺测 token 的兜底时长。
  fallbackTokenMs?: number;
}

export interface AlignResult {
  timings: ReverseTokenTiming[];
  groups: AlignGroup[];
  // 1:1 完全一致的 token 占比，用于提示转写质量。
  exactRatio: number;
}

type Slot = { start: number; end: number; measured: boolean };

function spread(
  slots: Array<Slot | undefined>,
  tokens: readonly Pick<ReverseNarrativeToken, 'text'>[],
  from: number,
  to: number,
  start: number,
  end: number,
  measured: boolean,
): void {
  const weights = tokens.slice(from, to).map((t) => Math.max(1, [...t.text].length));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let acc = 0;
  weights.forEach((w, k) => {
    const s = start + ((end - start) * acc) / total;
    acc += w;
    slots[from + k] = { start: s, end: start + ((end - start) * acc) / total, measured };
  });
}

function timed(word: ReverseTranscriptWord): word is ReverseTranscriptWord & { startMs: number; endMs: number } {
  return Number.isFinite(word.startMs) && Number.isFinite(word.endMs) && (word.endMs as number) >= (word.startMs as number);
}

export function alignNarrativeToTranscript(
  tokens: readonly ReverseNarrativeToken[],
  words: readonly ReverseTranscriptWord[],
  options: AlignOptions = {},
): AlignResult {
  const groups = alignWordGroups(tokens, words);
  const slots: Array<Slot | undefined> = new Array<Slot | undefined>(tokens.length).fill(undefined);
  let exact = 0;
  for (const group of groups) {
    if (group.tokenEnd === group.tokenStart) continue;
    if (group.relation === 'exact') exact += 1;
    const evidence = words.slice(group.wordStart, group.wordEnd).filter(timed);
    if (evidence.length === 0) continue;
    const start = Math.min(...evidence.map((w) => w.startMs));
    const end = Math.max(...evidence.map((w) => w.endMs));
    spread(slots, tokens, group.tokenStart, group.tokenEnd, start, end, true);
  }
  let k = 0;
  while (k < tokens.length) {
    if (slots[k]) {
      k += 1;
      continue;
    }
    let e = k;
    while (e < tokens.length && !slots[e]) e += 1;
    const left = k > 0 ? slots[k - 1]!.end : 0;
    const nextStart = e < tokens.length ? slots[e]!.start : undefined;
    const right = nextStart
      ?? (options.durationMs !== undefined && options.durationMs > left
        ? options.durationMs
        : left + (options.fallbackTokenMs ?? 250) * (e - k));
    spread(slots, tokens, k, e, left, Math.max(left, right), false);
    k = e;
  }
  const timings = tokens.map((token, index) => {
    const slot = slots[index]!;
    return { tokenId: token.id, startMs: Math.round(slot.start), endMs: Math.round(slot.end), measured: slot.measured };
  });
  return { timings, groups, exactRatio: tokens.length ? exact / tokens.length : 0 };
}
