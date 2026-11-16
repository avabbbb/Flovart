import { describe, expect, it } from 'vitest';
import { checkReferenceCount, describeReferenceFix, getReferenceConstraints, suggestReferenceCandidates } from '../services/referenceConstraints';

describe('referenceConstraints', () => {
  it('derives [min,max] per kind from the model and mode', () => {
    const fl = getReferenceConstraints('flovart:seedance-2', 'first-last-frame')!;
    expect(fl.perKind.image).toEqual({ min: 2, max: 2 });
    expect(fl.requires).toEqual(['media']);
    const t2v = getReferenceConstraints('flovart:seedance-2', 'text-to-video')!;
    expect(t2v.maxTotal).toBe(0);
    expect(t2v.requires).toEqual(['prompt']);
    const r2v = getReferenceConstraints('flovart:seedance-2', 'reference-to-video')!;
    expect(r2v.minTotal).toBe(1);
    expect(r2v.perKind.video.max).toBe(3);
    expect(getReferenceConstraints('nope', 'text-to-image')).toBeNull();
  });

  it('flags too few and too many references with min/max/got', () => {
    expect(checkReferenceCount('flovart:seedance-2', 'first-last-frame', ['image'])).toMatchObject({
      code: 'REFERENCE_COUNT_OUT_OF_RANGE', kind: 'image', min: 2, max: 2, got: 1,
    });
    expect(checkReferenceCount('flovart:imagen-4', 'text-to-image', ['image'])).toMatchObject({ kind: 'image', max: 0, got: 1 });
    expect(checkReferenceCount('flovart:seedance-2', 'reference-to-video', [])).toMatchObject({ kind: 'total', min: 1, got: 0 });
    expect(checkReferenceCount('flovart:seedance-2', 'reference-to-video', ['image', 'video', 'audio'])).toBeNull();
    expect(checkReferenceCount('flovart:seedance-2', 'reference-to-video', ['video', 'video', 'video', 'video'])).toMatchObject({ kind: 'video', max: 3, got: 4 });
  });

  it('suggests only (model, mode) pairs that accept the exact reference set', () => {
    const candidates = suggestReferenceCandidates('video', ['video', 'audio']);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(checkReferenceCount(candidate.modelId, candidate.mode, ['video', 'audio'])).toBeNull();
    }
    expect(candidates.every(candidate => candidate.mode !== 'text-to-video')).toBe(true);
    const imageOnly = suggestReferenceCandidates('image', ['image'], { modes: ['image-to-image'] });
    expect(imageOnly.every(candidate => candidate.mode === 'image-to-image')).toBe(true);
    expect(imageOnly.map(candidate => candidate.modelId)).not.toContain('flovart:imagen-4');
  });

  it('puts configured routes first and honours the limit', () => {
    const all = suggestReferenceCandidates('image', []);
    const preferred = all[all.length - 1];
    const ordered = suggestReferenceCandidates('image', [], { isConfigured: id => id === preferred.modelId, limit: 2 });
    expect(ordered).toHaveLength(2);
    expect(ordered[0].modelId).toBe(preferred.modelId);
  });

  it('writes an actionable fix', () => {
    const violation = checkReferenceCount('flovart:seedance-2', 'first-last-frame', ['image'])!;
    expect(describeReferenceFix(violation, [{ modelId: 'flovart:seedance-2', mode: 'image-to-video' }])).toContain('再连 1 个图片参考');
    expect(describeReferenceFix(violation, [])).toContain('没有模型');
  });
});
