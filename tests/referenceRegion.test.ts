import { describe, expect, it } from 'vitest';
import { referenceRegionKey, regionChipBackground, regionFromDrag, regionPixelSize, regionResourceId, validateReferenceRegion } from '../components/workflow/referenceRegion';

describe('referenceRegion', () => {
  it('validates and clamps regions', () => {
    expect(validateReferenceRegion(undefined)).toEqual({});
    expect(validateReferenceRegion({ x: 0.5, y: 0.25, w: 0.8, h: 0.5 }).region).toEqual({ x: 0.5, y: 0.25, w: 0.5, h: 0.5 });
    expect(validateReferenceRegion({ x: 1.2, y: 0, w: 0.1, h: 0.1 }).error).toMatch(/x\/y/);
    expect(validateReferenceRegion({ x: 0, y: 0, w: 0, h: 0.1 }).error).toMatch(/w\/h/);
    expect(validateReferenceRegion({ x: 0, y: 0, w: 'a', h: 0.1 }).error).toMatch(/数字/);
    expect(validateReferenceRegion({ x: 0, y: 0, w: 0.005, h: 0.5 }).error).toMatch(/太小/);
    expect(validateReferenceRegion({ x: 0, y: 0, w: 0.5, h: 0.5, mask: { storageKey: 'm1' } }).region?.mask).toEqual({ storageKey: 'm1' });
    expect(validateReferenceRegion({ x: 0, y: 0, w: 0.5, h: 0.5, mask: {} }).error).toMatch(/mask/);
  });

  it('builds identity keys and resource ids', () => {
    const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    expect(referenceRegionKey(region)).toBe('0.1,0.2,0.3,0.4');
    expect(referenceRegionKey({ ...region, mask: { storageKey: 'm' } })).toBe('0.1,0.2,0.3,0.4;m:m');
    expect(regionResourceId('node:img-a', region)).toBe('node:img-a#r:0.1,0.2,0.3,0.4');
    expect(regionResourceId('node:img-a', undefined)).toBe('node:img-a');
  });

  it('computes pixel size and chip background', () => {
    expect(regionPixelSize(2000, 1000, { x: 0, y: 0, w: 0.25, h: 0.5 })).toEqual({ width: 500, height: 500 });
    expect(regionPixelSize(undefined, 1000, { x: 0, y: 0, w: 0.25, h: 0.5 })).toBeUndefined();
    expect(regionChipBackground({ x: 0.5, y: 0, w: 0.5, h: 0.5 })).toEqual({ backgroundSize: '200% 200%', backgroundPosition: '100% 0%' });
    expect(regionChipBackground({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 })).toEqual({ backgroundSize: '200% 200%', backgroundPosition: '50% 50%' });
    expect(regionChipBackground(null)).toEqual({ backgroundSize: 'cover', backgroundPosition: 'center' });
  });

  it('turns a drag in any direction into a region', () => {
    expect(regionFromDrag({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.4 })).toEqual({ x: 0.2, y: 0.4, w: 0.6, h: 0.5 });
    expect(regionFromDrag({ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.6 })).toBeUndefined();
  });
});

import { mentionRegionsFromDocument, setMentionRegionInDocument } from '../components/workflow/referenceRegion';

describe('document region helpers', () => {
  const region = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '看 ' }, { type: 'mediaMention', attrs: { id: 'img-a', label: '图片1' } }] }] };

  it('sets, reads and clears a region on an existing chip without mutating the input', () => {
    const next = setMentionRegionInDocument(doc, 'img-a', region, { label: '图片1' });
    expect(mentionRegionsFromDocument(next).get('img-a')).toEqual(region);
    expect(mentionRegionsFromDocument(doc).size).toBe(0);
    expect(mentionRegionsFromDocument(setMentionRegionInDocument(next, 'img-a', null, { label: '图片1' })).size).toBe(0);
  });

  it('appends a region chip when the node is not mentioned yet', () => {
    const next = setMentionRegionInDocument(doc, 'img-b', region, { label: '图片2', thumbnail: 'https://x/b.png' });
    const paragraph = next.content[0].content!;
    expect(paragraph.at(-1)).toMatchObject({ type: 'mediaMention', attrs: { id: 'img-b', label: '图片2', region } });
    expect(setMentionRegionInDocument(undefined, 'img-b', region, { label: '图片2' }).content[0].content![0].attrs?.id).toBe('img-b');
  });
});
