import { describe, expect, it } from 'vitest';
import { CAPTION_Z, VISUAL_Z, composeReverse } from '../services/reverse/composition';
import { bindCaptionTiming, captionDocumentFromNarrative } from '../services/reverse/caption';
import { parseReverseScript } from '../services/reverse/narrative';
import { projectNarrative } from '../services/reverse/projection';
import { createLocalDomain, createTimeline } from '../services/reverse/temporal';

const timeline = createTimeline('main', { num: 10, den: 1 }, 50);
const shots = [
  { shotId: 's1', startMs: 0, endMs: 2000, anchored: false },
  { shotId: 's2', startMs: 2000, endMs: 2000, anchored: true },
  { shotId: 's3', startMs: 2000, endMs: 4000, anchored: true },
];

describe('reverse composition', () => {
  it('builds a visual track from the shot table', () => {
    const c = composeReverse({ timeline, shots });
    expect(c.visual.clips).toEqual([
      { shotId: 's1', window: { timelineId: 'main', start: 0, end: 20 }, anchored: false },
      { shotId: 's3', window: { timelineId: 'main', start: 20, end: 40 }, anchored: true },
    ]);
    expect(c.diagnostics).toEqual([{ code: 'empty-shot', id: 's2' }]);
    expect(c.presents.map((p) => [p.order, p.z, p.span.start])).toEqual([[0, VISUAL_Z, 0], [1, VISUAL_Z, 20]]);
  });

  it('layers caption presents above shots in time order', () => {
    const { narrative } = parseReverseScript('[hook] one two three four');
    const timings = narrative.tokens.map((t, i) => ({ tokenId: t.id, startMs: i * 1000, endMs: i * 1000 + 1000, measured: true }));
    const document = captionDocumentFromNarrative(narrative, { maxWordsPerUnit: 2, maxUnitsPerCue: 1 });
    const timing = bindCaptionTiming(document, projectNarrative(timeline, createLocalDomain('ref', timeline, 0, 50), narrative, timings));
    const c = composeReverse({ timeline, shots, captions: { document, timing } });
    const captions = c.presents.filter((p) => p.z === CAPTION_Z);
    expect(captions.map((p) => p.elements)).toEqual([[{ kind: 'caption', cueId: 'c1', text: 'one two' }], [{ kind: 'caption', cueId: 'c2', text: 'three four' }]]);
    expect(c.presents.map((p) => p.order)).toEqual([0, 1, 2, 3]);
    expect(c.presents[1]).toMatchObject({ z: CAPTION_Z, span: { start: 0, end: 20 } });
  });

  it('groups audio clips by track and rejects foreign windows', () => {
    const c = composeReverse({
      timeline,
      shots: [],
      audio: [
        { trackId: 'vo', sourceId: 'a1', window: { timelineId: 'main', start: 0, end: 30 } },
        { trackId: 'vo', sourceId: 'a2', window: { timelineId: 'other', start: 0, end: 5 } },
      ],
    });
    expect(c.audio).toEqual([{ id: 'vo', kind: 'audio', clips: [{ sourceId: 'a1', window: { timelineId: 'main', start: 0, end: 30 } }] }]);
    expect(c.diagnostics).toEqual([{ code: 'audio-outside-timeline', id: 'a2' }]);
  });
});
