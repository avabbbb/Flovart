import { describe, expect, it } from 'vitest';
import {
  buildShotsFromCuts,
  expandVariantMatrix,
  planShotRenders,
  toScriptBreakdown,
  tokenizeScript,
  wordRangeForShot,
} from '../services/reverse/video';
import type { ReverseVariantAxis, ReverseVideoProject } from '../services/reverse/types';

const axes: ReverseVariantAxis[] = [
  { id: 'hook', label: 'Hook', targets: [{ kind: 'segment', id: 'hook' }], options: [{ id: 'a', label: 'A', value: 'a' }, { id: 'b', label: 'B', value: 'b' }] },
  { id: 'cta', label: 'CTA', targets: [{ kind: 'slot', id: 'slot-cta' }], options: [{ id: 'x', label: 'X', value: 'x' }, { id: 'y', label: 'Y', value: 'y' }, { id: 'z', label: 'Z', value: 'z' }] },
];

describe('reverse video', () => {
  it('builds contiguous shots from unsorted, duplicated, out-of-range cuts', () => {
    const shots = buildShotsFromCuts([3000, 1000, 1000, -5, 9000], 5000);
    expect(shots.map((s) => [s.startMs, s.endMs])).toEqual([[0, 1000], [1000, 3000], [3000, 5000]]);
    expect(shots.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it('tokenizes CJK per character and latin per word', () => {
    expect(tokenizeScript('你好 hello world').map((w) => w.text)).toEqual(['你', '好', 'hello', 'world']);
  });

  it('assigns timed words to shots by midpoint', () => {
    const words = [
      { index: 0, text: 'a', startMs: 0, endMs: 400 },
      { index: 1, text: 'b', startMs: 800, endMs: 1300 },
      { index: 2, text: 'c', startMs: 1400, endMs: 1600 },
    ];
    expect(wordRangeForShot(words, { startMs: 0, endMs: 1000 })).toEqual([0, 0]);
    expect(wordRangeForShot(words, { startMs: 1000, endMs: 2000 })).toEqual([1, 2]);
    expect(wordRangeForShot(words, { startMs: 2000, endMs: 3000 })).toBeNull();
  });

  it('expands the matrix with stable ids, keeps enabled flags, and caps', () => {
    const first = expandVariantMatrix(axes);
    expect(first.total).toBe(6);
    expect(first.variants).toHaveLength(6);
    const disabled = first.variants.map((v, i) => (i === 0 ? { ...v, enabled: false } : v));
    const again = expandVariantMatrix(axes, disabled);
    expect(again.variants[0]).toMatchObject({ id: first.variants[0].id, enabled: false });
    const capped = expandVariantMatrix(axes, [], 4);
    expect(capped).toMatchObject({ total: 6, truncated: true });
    expect(capped.variants).toHaveLength(4);
    expect(expandVariantMatrix([]).variants).toEqual([{ id: 'v:', picks: {}, enabled: true }]);
  });

  it('renders shared shots once across variants', () => {
    const project = {
      references: [],
      axes,
      variants: expandVariantMatrix(axes).variants,
      analysis: {
        durationMs: 3000,
        words: [],
        segments: [],
        analyzedAt: 'fixture',
        source: 'manual',
        shots: [
          { id: 's1', index: 1, startMs: 0, endMs: 1000, segmentId: 'hook', slotIds: [] },
          { id: 's2', index: 2, startMs: 1000, endMs: 2000, slotIds: [] },
          { id: 's3', index: 3, startMs: 2000, endMs: 3000, slotIds: ['slot-cta'] },
        ],
      },
    } satisfies Pick<ReverseVideoProject, 'analysis' | 'axes' | 'variants' | 'references'>;
    const plans = planShotRenders(project);
    const count = (id: string) => plans.filter((p) => p.shotId === id).length;
    expect([count('s1'), count('s2'), count('s3')]).toEqual([2, 1, 3]);
    expect(plans.find((p) => p.shotId === 's2')?.variantIds).toHaveLength(6);
    expect(toScriptBreakdown(project).shots.map((s) => s.durationSec)).toEqual([1, 1, 1]);
  });
});
