import { describe, expect, it } from 'vitest';
import {
  checkReferencePixels,
  checkReferenceVideoLimits,
  validateReferenceSet,
  type ProviderCapabilities,
} from '../services/providerGenerationAdapter';
import { getReferenceVideoLimits, getReferenceVideoPixelRange } from '../services/productModelCatalog';

const range = { min: 409_600, max: 927_408 };

const capabilities: ProviderCapabilities = {
  provider: 'custom' as ProviderCapabilities['provider'],
  routeId: 'test-route',
  supportedCapabilities: ['reference-to-video'],
  supportedReferenceKinds: ['image', 'video'],
  supportedReferenceRoles: ['reference', 'source_video'],
  maxReferences: { image: 9, video: 3, audio: 3 },
  referencePixelRange: { video: range },
};

describe('reference pixel range (1521)', () => {
  it('declares the Seedance 2.0 reference video range in the catalog', () => {
    expect(getReferenceVideoPixelRange('flovart:seedance-2')).toEqual(range);
    expect(getReferenceVideoPixelRange('flovart:seedance-2-fast')).toEqual(range);
    expect(getReferenceVideoPixelRange('flovart:veo-3.1')).toBeUndefined();
  });

  it('rejects the 360x640 reference video that the provider rejected with 1521', () => {
    const issue = checkReferencePixels({ kind: 'video', role: 'source_video', width: 360, height: 640, title: 'silent.mp4' }, range);
    expect(issue?.code).toBe('REFERENCE_RESOLUTION_OUT_OF_RANGE');
    expect(issue?.direction).toBe('low');
    expect(issue?.pixels).toBe(230_400);
    expect(issue?.message).toContain('silent.mp4');
    expect(issue?.message).toContain('409,600');
  });

  it('accepts the 720x1280 reference video that the provider accepted', () => {
    expect(checkReferencePixels({ kind: 'video', role: 'source_video', width: 720, height: 1280 }, range)).toBeUndefined();
  });

  it('rejects a 1080p reference video above the declared max', () => {
    const issue = checkReferencePixels({ kind: 'video', role: 'source_video', width: 1080, height: 1920 }, range);
    expect(issue?.direction).toBe('high');
  });

  it('lets references with unknown size or undeclared kind through', () => {
    expect(checkReferencePixels({ kind: 'video', role: 'source_video' }, range)).toBeUndefined();
    expect(checkReferencePixels({ kind: 'video', role: 'source_video', width: 360, height: 640 }, undefined)).toBeUndefined();
    const errors = validateReferenceSet('reference-to-video', capabilities, [
      { kind: 'image', role: 'reference', width: 100, height: 100 },
    ]);
    expect(errors).toEqual([]);
  });

  it('reports the out-of-range video from validateReferenceSet before submission', () => {
    const errors = validateReferenceSet('reference-to-video', capabilities, [
      { kind: 'image', role: 'reference', width: 1024, height: 1024 },
      { kind: 'video', role: 'source_video', width: 360, height: 640, resourceId: 'video-1' },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'REFERENCE_RESOLUTION_OUT_OF_RANGE', kind: 'video', resourceId: 'video-1' });
  });
});

describe('reference video limits', () => {
  const limits = getReferenceVideoLimits('flovart:seedance-2');

  it('declares Seedance 2.0 video limits and none for Veo', () => {
    expect(limits).toMatchObject({ minDurationSec: 2, maxDurationSec: 15, maxTotalDurationSec: 15, minAspectRatio: 0.4, maxAspectRatio: 2.5 });
    expect(getReferenceVideoLimits('flovart:seedance-2-fast')).toEqual(limits);
    expect(getReferenceVideoLimits('flovart:veo-3.1')).toBeUndefined();
  });

  it('accepts the 7.96s 1280x720 HEVC 4:2:2 sample', () => {
    expect(checkReferenceVideoLimits([{ kind: 'video', role: 'source_video', width: 1280, height: 720, durationMs: 7960, bytes: 5_697_660 }], limits)).toEqual([]);
  });

  it('blocks clips that are too short, too large or too narrow', () => {
    const codes = checkReferenceVideoLimits([
      { kind: 'video', role: 'source_video', durationMs: 1500, resourceId: 'short' },
      { kind: 'video', role: 'source_video', bytes: 300_000_000, resourceId: 'big' },
      { kind: 'video', role: 'source_video', width: 300, height: 1000, resourceId: 'narrow' },
    ], limits).map(issue => issue.code);
    expect(codes).toEqual(['REFERENCE_DURATION_OUT_OF_RANGE', 'REFERENCE_FILE_TOO_LARGE', 'REFERENCE_ASPECT_OUT_OF_RANGE']);
  });

  it('blocks a total duration above 15s', () => {
    const issues = checkReferenceVideoLimits([
      { kind: 'video', role: 'source_video', durationMs: 10_000 },
      { kind: 'video', role: 'source_video', durationMs: 8_000 },
    ], limits);
    expect(issues.map(issue => issue.code)).toEqual(['REFERENCE_TOTAL_DURATION_EXCEEDED']);
  });

  it('lets unknown metadata, images and undeclared limits through', () => {
    expect(checkReferenceVideoLimits([{ kind: 'video', role: 'source_video' }], limits)).toEqual([]);
    expect(checkReferenceVideoLimits([{ kind: 'video', role: 'source_video', durationMs: 60_000 }], undefined)).toEqual([]);
    expect(checkReferenceVideoLimits([{ kind: 'image', role: 'reference', width: 100, height: 1000 }], limits)).toEqual([]);
  });

  it('reports a too-long clip from validateReferenceSet before submission', () => {
    const errors = validateReferenceSet('reference-to-video', { ...capabilities, referenceVideoLimits: limits }, [
      { kind: 'video', role: 'source_video', width: 1280, height: 720, durationMs: 20_000, resourceId: 'long', title: 'long.mp4' },
    ]);
    expect(errors.map(issue => issue.code)).toEqual(['REFERENCE_DURATION_OUT_OF_RANGE', 'REFERENCE_TOTAL_DURATION_EXCEEDED']);
    expect(errors[0].message).toContain('long.mp4');
  });
});
