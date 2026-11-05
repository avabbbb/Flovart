import { describe, expect, it } from 'vitest';
import { bindCaptionTiming, captionDocumentFromNarrative, joinCaptionWords } from '../services/reverse/caption';
import { parseReverseScript } from '../services/reverse/narrative';
import { projectNarrative } from '../services/reverse/projection';
import { createLocalDomain, createTimeline } from '../services/reverse/temporal';
import type { ReverseNarrative, ReverseTokenTiming } from '../services/reverse/types';

const { narrative } = parseReverseScript(['[hook] Tired, of waiting', '[cta] Try Brew'].join(String.fromCharCode(10)));
const timings = (n: ReverseNarrative): ReverseTokenTiming[] =>
  n.tokens.map((t, i) => ({ tokenId: t.id, startMs: i * 100, endMs: i * 100 + 100, measured: true }));
const timeline = createTimeline('main', { num: 10, den: 1 }, 100);

describe('reverse caption', () => {
  it('builds a time-free document of words, units and cues', () => {
    const doc = captionDocumentFromNarrative(narrative, { maxWordsPerUnit: 2, maxUnitsPerCue: 2 });
    expect(doc.words.map((w) => w.id)).toEqual(narrative.tokens.map((t) => t.id));
    expect(doc.words[0]!.text).toBe('Tired,');
    expect(doc.units.map((u) => u.text)).toEqual(['Tired, of', 'waiting', 'Try Brew']);
    expect(doc.cues.map((c) => c.text)).toEqual([['Tired, of', 'waiting'].join(String.fromCharCode(10)), 'Try Brew']);
    expect(doc.words.every((w) => !('startMs' in w) && !('window' in w))).toBe(true);
  });

  it('joins CJK and joinNext words without spaces', () => {
    expect(joinCaptionWords([{ text: '你' }, { text: '好' }, { text: 'ok' }])).toBe('你好 ok');
    expect(joinCaptionWords([{ text: 'one', joinNext: true }, { text: '-tap' }])).toBe('one-tap');
  });

  it('binds cues to projected token windows by identity', () => {
    const doc = captionDocumentFromNarrative(narrative, { maxWordsPerUnit: 2, maxUnitsPerCue: 2 });
    const p = projectNarrative(timeline, createLocalDomain('ref', timeline, 0, 100), narrative, timings(narrative));
    const t = bindCaptionTiming(doc, p);
    expect(t.diagnostics).toEqual([]);
    expect(t.cues).toEqual([
      { cueId: 'c1', window: { timelineId: 'main', start: 0, end: 3 }, complete: true },
      { cueId: 'c2', window: { timelineId: 'main', start: 3, end: 5 }, complete: true },
    ]);
  });

  it('reports missing bindings instead of inventing time', () => {
    const doc = captionDocumentFromNarrative(narrative, { maxWordsPerUnit: 2, maxUnitsPerCue: 2 });
    const p = projectNarrative(timeline, createLocalDomain('ref', timeline, 0, 4), narrative, timings(narrative));
    const t = bindCaptionTiming(doc, p);
    expect(t.diagnostics).toEqual([{ code: 'missing-binding', id: narrative.tokens[4]!.id }]);
    expect(t.cues[1]).toEqual({ cueId: 'c2', window: { timelineId: 'main', start: 3, end: 4 }, complete: false });
    const none = bindCaptionTiming(doc, { ...p, tokens: [] });
    expect(none.cues.every((c) => c.window === null)).toBe(true);
    expect(none.diagnostics.filter((d) => d.code === 'unbound-cue')).toHaveLength(2);
  });
});
