import { describe, expect, it } from 'vitest';
import { fillToCss, fillToSvg, linearGradientVector, normalizeFill } from '../services/design/gradient';

describe('design gradient', () => {
  it('maps CSS angles to bounding-box vectors', () => {
    expect(linearGradientVector(90)).toEqual({ x1: 0, y1: expect.closeTo(0.5, 6), x2: 1, y2: expect.closeTo(0.5, 6) });
    const down = linearGradientVector(180);
    expect(down.y1).toBeCloseTo(0, 6);
    expect(down.y2).toBeCloseTo(1, 6);
  });

  it('degrades gradients with fewer than two stops', () => {
    expect(normalizeFill({ type: 'linear', angle: 0, stops: [] })).toEqual({ type: 'none' });
    expect(normalizeFill({ type: 'linear', angle: 0, stops: [{ offset: 0, color: '#f00' }] })).toEqual({ type: 'solid', color: '#f00', opacity: 1 });
  });

  it('emits sorted, clamped stops and escapes attribute values', () => {
    const svg = fillToSvg({ type: 'linear', angle: 90, stops: [{ offset: 2, color: '#00f' }, { offset: -1, color: '"><script>', opacity: 0.5 }] }, 'g"1');
    expect(svg.paint).toBe('url(#g&quot;1)');
    expect(svg.defs).not.toContain('<script>');
    expect(svg.defs.indexOf('offset="0"')).toBeLessThan(svg.defs.indexOf('offset="1"'));
    expect(svg.defs).toContain('stop-opacity="0.5"');
  });

  it('renders solid and radial fills', () => {
    expect(fillToSvg({ type: 'solid', color: '#123456', opacity: 0.4 }, 'x')).toEqual({ defs: '', paint: '#123456', opacity: 0.4 });
    expect(fillToSvg({ type: 'radial', stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] }, 'r').defs).toMatch(/^<radialGradient id="r" cx="0.5" cy="0.5" r="0.5">/);
  });

  it('produces CSS for previews', () => {
    expect(fillToCss({ type: 'none' })).toBe('transparent');
    expect(fillToCss({ type: 'linear', angle: 45, stops: [{ offset: 0, color: '#fff' }, { offset: 1, color: '#000' }] })).toBe('linear-gradient(45deg, #fff 0%, #000 100%)');
  });
});
