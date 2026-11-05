import type {
  ReverseCue,
  ReverseMoment,
  ReverseNarrative,
  ReverseNarrativeSegment,
  ReverseNarrativeToken,
  ReverseScriptDiagnostic,
  ReverseSegmentRole,
  ReverseSelection,
  ReverseTokenTiming,
  ReverseWord,
} from './types';

// 脚本语法（自定，语义对照 Hypit Script；实现为本仓库自写）：
//   [hook] / [intro:problem]   段落头，位于行首；role 省略时若 id 本身是角色名则沿用。
//   <HOST>                     说话人切换，段内有效，换段重置。
//   @{name} … @{/name}         选区（解释/对比），可跨段、可交叉。
//   @{name!}                   时刻（答案/包袱），落在下一个词的起点。
// 中日文按字、其他按词切 token；标点不进 text / normalized，只随词记在 surface（台词输出用）。脚本里不写秒。

const CJK = '\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff';
const BS = String.fromCharCode(92); // 反斜杠用字符码拼接，避免字符串里的转义被中转层吃掉
const NON_CJK_WORD = '(?:(?![' + CJK + '])[' + BS + 'p{L}' + BS + 'p{N}])+';
const WORD_SRC = '[' + CJK + ']|' + NON_CJK_WORD + "(?:['\u2019]" + NON_CJK_WORD + ')*';
const LEX_RE = new RegExp('@' + BS + '{(/?)([a-z][a-z0-9_-]{0,63})(!?)' + BS + '}|<([^<>' + BS + 's|]{1,32})>|(' + WORD_SRC + ')', 'gu');
const HEADER_RE = /^\s*\[([a-z][a-z0-9_-]{0,63})(?::([a-z]+))?\]\s*(.*)$/i;
const WS_RE = new RegExp(BS + 's+', 'u');
const SINGLE_CJK_RE = new RegExp('^[' + CJK + ']$', 'u');
const ENDS_CJK_RE = new RegExp('[' + CJK + ']$', 'u');
const ROLES: readonly ReverseSegmentRole[] = ['hook', 'problem', 'solution', 'proof', 'cta', 'other'];

export function normalizeToken(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function roleFor(id: string, explicit?: string): ReverseSegmentRole {
  const want = (explicit ?? id).toLowerCase();
  return (ROLES as readonly string[]).includes(want) ? (want as ReverseSegmentRole) : 'other';
}

export interface ParsedScript {
  narrative: ReverseNarrative;
  diagnostics: ReverseScriptDiagnostic[];
}

export function parseReverseScript(source: string, id = 'story'): ParsedScript {
  const tokens: ReverseNarrativeToken[] = [];
  const segments: ReverseNarrativeSegment[] = [];
  const selections: ReverseSelection[] = [];
  const moments: ReverseMoment[] = [];
  const diagnostics: ReverseScriptDiagnostic[] = [];
  const open = new Map<string, number>();
  const names = new Set<string>();
  const state: { segment: ReverseNarrativeSegment | null; speaker: string | undefined } = { segment: null, speaker: undefined };

  const closeSegment = (): void => {
    if (!state.segment) return;
    state.segment.tokenEnd = tokens.length;
    segments.push(state.segment);
    state.segment = null;
  };

  source.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    let body = raw;
    const header = HEADER_RE.exec(raw);
    if (header) {
      closeSegment();
      const segId = (header[1] ?? '').toLowerCase();
      if (segments.some((s) => s.id === segId)) diagnostics.push({ line, message: '段落「' + segId + '」重复' });
      state.segment = { id: segId, role: roleFor(segId, header[2]), tokenStart: tokens.length, tokenEnd: tokens.length };
      state.speaker = undefined;
      body = header[3] ?? '';
    }
    if (!body.trim()) return;
    if (!state.segment) state.segment = { id: 'body', role: 'other', tokenStart: tokens.length, tokenEnd: tokens.length };
    const segment = state.segment;
    let prev: ReverseNarrativeToken | null = null;
    let glued = false;
    let lead = '';
    let cursor = 0;
    // 词间原文间隙：紧贴前词的部分归前词，最后一段空白之后的部分归下一个词。
    const takeGap = (gap: string): void => {
      if (!gap) return;
      const parts = gap.split(WS_RE);
      if (parts.length > 1) {
        const next = parts[parts.length - 1] ?? '';
        const tail = gap.slice(0, gap.length - next.length).trimEnd();
        if (prev && glued && tail) prev.surface = (prev.surface ?? prev.text) + tail;
        glued = false;
        lead = next;
      } else if (prev && glued) {
        prev.surface = (prev.surface ?? prev.text) + gap;
      } else {
        lead += gap;
      }
    };
    for (const match of body.matchAll(LEX_RE)) {
      const at = match.index ?? cursor;
      takeGap(body.slice(cursor, at));
      cursor = at + match[0].length;
      const [, slash, name, bang, role, word] = match;
      if (name) {
        if (bang) {
          if (slash) diagnostics.push({ line, message: '时刻「' + name + '」不能写成闭合标记' });
          else if (names.has(name)) diagnostics.push({ line, message: '标记「' + name + '」重名' });
          else {
            names.add(name);
            moments.push({ id: name, atToken: tokens.length });
          }
        } else if (slash) {
          const start = open.get(name);
          if (start === undefined) diagnostics.push({ line, message: '选区「' + name + '」未打开就关闭' });
          else {
            open.delete(name);
            selections.push({ id: name, startToken: start, endToken: tokens.length });
          }
        } else if (names.has(name)) {
          diagnostics.push({ line, message: '标记「' + name + '」重名' });
        } else {
          names.add(name);
          open.set(name, tokens.length);
        }
      } else if (role) {
        state.speaker = role;
      } else if (word) {
        const token: ReverseNarrativeToken = { id: 't' + tokens.length, segmentId: segment.id, text: word, normalized: normalizeToken(word) };
        if (state.speaker) token.speaker = state.speaker;
        if (lead) token.surface = lead + word;
        if (prev && glued) prev.joinNext = true;
        lead = '';
        tokens.push(token);
        prev = token;
        glued = true;
      }
    }
    takeGap(body.slice(cursor));
  });
  closeSegment();
  for (const name of open.keys()) diagnostics.push({ line: 0, message: '选区「' + name + '」没有关闭' });
  selections.sort((a, b) => a.startToken - b.startToken || a.endToken - b.endToken);
  return { narrative: { id, tokens, segments, selections, moments }, diagnostics };
}

export function tokensText(tokens: readonly { text: string }[]): string {
  let out = '';
  for (const token of tokens) {
    const glue = out.length === 0 || (SINGLE_CJK_RE.test(token.text) && ENDS_CJK_RE.test(out)) ? '' : ' ';
    out += glue + token.text;
  }
  return out;
}

// cue 在 token 序里的半开区间；时刻返回空区间 [k, k)。
export function cueTokenRange(narrative: ReverseNarrative, cue: ReverseCue): [number, number] | null {
  if (cue.kind === 'selection') {
    const sel = narrative.selections.find((s) => s.id === cue.id);
    return sel ? [sel.startToken, sel.endToken] : null;
  }
  if (cue.kind === 'segment') {
    const seg = narrative.segments.find((s) => s.id === cue.id);
    return seg ? [seg.tokenStart, seg.tokenEnd] : null;
  }
  const moment = narrative.moments.find((m) => m.id === cue.id);
  return moment ? [moment.atToken, moment.atToken] : null;
}

export function cueText(narrative: ReverseNarrative, cue: ReverseCue): string {
  const range = cueTokenRange(narrative, cue);
  return range ? tokensText(narrative.tokens.slice(range[0], range[1])) : '';
}

// 通过对齐结果把 cue 投影到毫秒；timings 须与 tokens 同序同长。
export function cueTimeRange(
  narrative: ReverseNarrative,
  timings: readonly ReverseTokenTiming[],
  cue: ReverseCue,
): { startMs: number; endMs: number } | null {
  const range = cueTokenRange(narrative, cue);
  if (!range || timings.length !== narrative.tokens.length || timings.length === 0) return null;
  const [start, end] = range;
  if (end > start) return { startMs: timings[start]!.startMs, endMs: timings[end - 1]!.endMs };
  const at = start < timings.length ? timings[start]!.startMs : timings[timings.length - 1]!.endMs;
  return { startMs: at, endMs: at };
}

// 派生旧版词表，供镜头表 / Workflow 投影共用。
export function narrativeWords(narrative: ReverseNarrative, timings?: readonly ReverseTokenTiming[]): ReverseWord[] {
  const timed = timings && timings.length === narrative.tokens.length ? timings : undefined;
  return narrative.tokens.map((token, index) => {
    const word: ReverseWord = { index, text: token.text };
    const timing = timed?.[index];
    if (timing) {
      word.startMs = timing.startMs;
      word.endMs = timing.endMs;
    }
    if (token.speaker) word.speaker = token.speaker;
    if (token.surface) word.surface = token.surface;
    if (token.joinNext) word.joinNext = true;
    return word;
  });
}
