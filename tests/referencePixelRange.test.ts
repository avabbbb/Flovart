import { describe, expect, it } from 'vitest';
import {
  checkReferencePixels,
  validateReferenceSet,
  type ProviderCapabilities,
} from '../services/providerGenerationAdapter';
import { getReferenceVideoPixelRange } from '../services/productModelCatalog';

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
