import { describe, expect, it } from 'vitest';
import { DESIGN_FRAME_PRESETS } from '../services/design/designTypes';
import { createDesignTemplate, DESIGN_CREATE_KINDS, isDesignElementKind } from '../services/design/presets';
import { renderDesignSvg } from '../services/design/render';

describe('design presets', () => {
  it('creates a renderable template for every kind', () => {
    for (const kind of DESIGN_CREATE_KINDS) {
      const template = createDesignTemplate(kind);
      expect(template.design.kind).toBe(kind);
      expect(template.width).toBeGreaterThan(0);
      expect(renderDesignSvg(template.design, template.width, template.height)).toContain('<svg');
    }
  });

  it('sizes frames from presets and falls back to the first preset', () => {
    const square = createDesignTemplate('frame', 'square');
    expect([square.width, square.height]).toEqual([1080, 1080]);
    expect(square.design.frame?.preset).toBe('square');
    const fallback = createDesignTemplate('frame', 'missing');
    expect(fallback.width).toBe(DESIGN_FRAME_PRESETS[0].width);
  });

  it('narrows unknown values to design kinds', () => {
    expect(isDesignElementKind('ellipse')).toBe(true);
    expect(isDesignElementKind('image')).toBe(false);
    expect(isDesignElementKind(3)).toBe(false);
  });
});
