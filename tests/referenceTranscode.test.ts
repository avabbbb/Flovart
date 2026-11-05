import { describe, expect, it } from 'vitest';
import type { CanonicalGenerationInput } from '../components/workflow/inputResolver';
import type { ProviderValidationIssue } from '../services/providerGenerationAdapter';
import {
  applyReferenceTranscodes,
  fitDimensionsToPixelRange,
  planReferenceTranscodes,
} from '../services/referenceTranscode';

const range = { min: 409_600, max: 927_408 };

function inputWith(resourceId: string, title: string): CanonicalGenerationInput {
  return {
    references: [
      { resource: { resourceId, title, kind: 'video', naturalWidth: 360, naturalHeight: 640, mimeType: 'video/webm' }, role: 'source_video', order: 0 },
      { resource: { resourceId: 'img-1', title: 'yayi.png', kind: 'image' }, role: 'reference', order: 1 },
    ],
  } as unknown as CanonicalGenerationInput;
}

const lowIssue: ProviderValidationIssue = {
  code: 'REFERENCE_RESOLUTION_OUT_OF_RANGE',
  message: 'low',
  kind: 'video',
  role: 'source_video',
  resourceId: 'video-1',
  width: 360,
  height: 640,
  pixels: 230_400,
  range,
  direction: 'low',
};

function area(size: { width: number; height: number }) {
  return Math.imul(size.width, size.height);
}

describe('reference transcode plan (1521)', () => {
  it('upscales 360x640 just past the minimum with even dimensions', () => {
    const size = fitDimensionsToPixelRange(360, 640, range);
    expect(size).toEqual({ width: 480, height: 854 });
    expect(area(size)).toBeGreaterThanOrEqual(range.min);
    expect(area(size)).toBeLessThanOrEqual(range.max);
  });

  it('downscales 1080x1920 under the maximum with even dimensions', () => {
    const size = fitDimensionsToPixelRange(1080, 1920, range);
    expect(size.width % 2).toBe(0);
    expect(size.height % 2).toBe(0);
    expect(area(size)).toBeLessThanOrEqual(range.max);
    expect(area(size)).toBeGreaterThanOrEqual(range.min);
  });

  it('keeps in-range sizes unchanged', () => {
    expect(fitDimensionsToPixelRange(720, 1280, range)).toEqual({ width: 720, height: 1280 });
  });

  it('plans a transcode only when every error is an out-of-range video', () => {
    const input = inputWith('video-1', 'silent.mp4');
    const plan = planReferenceTranscodes(input, [lowIssue]);
    expect(plan).toEqual([expect.objectContaining({ resourceId: 'video-1', title: 'silent.mp4', toWidth: 480, toHeight: 854, direction: 'low' })]);
    expect(planReferenceTranscodes(input, [])).toBeNull();
    expect(planReferenceTranscodes(input, [lowIssue, { code: 'MISSING_REFERENCE', message: 'x' }])).toBeNull();
    expect(planReferenceTranscodes(input, [{ ...lowIssue, width: undefined }])).toBeNull();
    expect(planReferenceTranscodes(input, [{ ...lowIssue, resourceId: 'gone' }])).toBeNull();
  });

  it('writes the transcoded size back without touching other references', () => {
    const input = inputWith('video-1', 'silent.mp4');
    const plan = planReferenceTranscodes(input, [lowIssue]);
    const next = applyReferenceTranscodes(input, plan || []);
    expect(next.references[0].resource).toMatchObject({ naturalWidth: 480, naturalHeight: 854, mimeType: 'video/mp4' });
    expect(next.references[1]).toBe(input.references[1]);
    expect(input.references[0].resource.naturalWidth).toBe(360);
  });
});
