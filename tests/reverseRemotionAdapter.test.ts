import { describe, expect, it } from 'vitest';
import { buildProductionSpecV1 } from '../services/reverse/productionSpec';
import { previewAssetKind, toPreviewSequences } from '../services/reverse/remotionAdapter';
import type { ReverseOutputRef } from '../services/reverse/types';

const analysis = {
  durationMs: 3000,
  words: [],
  segments: [],
  analyzedAt: 'fixture',
  source: 'manual' as const,
  shots: [
    { id: 's1', index: 1, startMs: 0, endMs: 1000, slotIds: [], description: '开场' },
    { id: 's2', index: 2, startMs: 1000, endMs: 2000, slotIds: [], description: '演示' },
    { id: 's3', index: 3, startMs: 2000, endMs: 3000, slotIds: [], description: '落版' },
  ],
};

const completed = (id: string, shotId: string, path: string): ReverseOutputRef => ({
  id, ownerKind: 'shot', ownerId: shotId, key: 'k-' + shotId, status: 'completed', path, createdAt: '2026-01-01T00:00:00.000Z',
});

const build = (outputs: ReverseOutputRef[]) => buildProductionSpecV1({ id: 'p1', analysis, outputs });

describe('remotion preview adapter', () => {
  it('classifies asset refs and keeps unknown ones as placeholders', () => {
    expect(previewAssetKind('https://cdn/a.mp4')).toBe('video');
    expect(previewAssetKind('/media/a.webm?x=1')).toBe('video');
    expect(previewAssetKind('/media/a.PNG')).toBe('image');
    expect(previewAssetKind('artifact://abc')).toBe('placeholder');
    expect(previewAssetKind(undefined)).toBe('placeholder');
  });

  it('maps shots to sequences with labels and gaps preserved', () => {
    const spec = build([
      completed('o1', 's1', '/media/a.mp4'),
      completed('o3', 's3', '/media/c.png'),
    ]);
    const sequences = toPreviewSequences(spec, { s2: '演示' });
    expect(sequences.map(s => [s.shotId, s.from, s.durationInFrames, s.kind, s.src])).toEqual([
      ['s1', 0, 30, 'video', '/media/a.mp4'],
      ['s2', 30, 30, 'placeholder', undefined],
      ['s3', 60, 30, 'image', '/media/c.png'],
    ]);
    expect(sequences[1]!.label).toBe('演示');
    expect(sequences[0]!.label).toBeUndefined();
  });

  it('changing the second shot leaves the other two sequences identical', () => {
    const before = toPreviewSequences(build([completed('o1', 's1', '/media/a.mp4'), completed('o3', 's3', '/media/c.png')]));
    const after = toPreviewSequences(build([
      completed('o1', 's1', '/media/a.mp4'),
      completed('o2', 's2', '/media/b.mp4'),
      completed('o3', 's3', '/media/c.png'),
    ]));
    expect(after[0]).toEqual(before[0]);
    expect(after[2]).toEqual(before[2]);
    expect(after[1]).not.toEqual(before[1]);
    expect(after[1]).toMatchObject({ kind: 'video', src: '/media/b.mp4' });
  });
});
