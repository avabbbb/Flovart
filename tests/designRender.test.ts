import { describe, expect, it } from 'vitest';
import { renderDesignSvg, splitTextLines } from '../services/design/render';

describe('renderDesignSvg', () => {
  it('renders a rounded rect with gradient defs and stroke inset', () => {
    const svg = renderDesignSvg({
      kind: 'rect',
      cornerRadius: 12,
      fill: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#f00' }, { offset: 1, color: '#00f' }] },
      stroke: { color: '#000', width: 4 },
    }, 200, 100, { idPrefix: 'n1' });
    expect(svg).toContain('<linearGradient id="n1-fill"');
    expect(svg).toContain('fill="url(#n1-fill)"');
    expect(svg).toContain('x="2" y="2" width="196" height="96" rx="12"');
  });

  it('scales a path from its viewBox and leaves open paths unfilled', () => {
    const svg = renderDesignSvg({
      kind: 'path',
      fill: { type: 'solid', color: '#123456' },
      path: { d: 'M0 0 L10 10', viewBox: { x: 0, y: 0, width: 10, height: 10 }, closed: false },
    }, 100, 50);
    expect(svg).toContain('matrix(10 0 0 5 0 0)');
    expect(svg).toContain('fill="none"');
  });

  it('escapes text content and keeps blank lines', () => {
    const svg = renderDesignSvg({
      kind: 'text',
      fill: { type: 'none' },
      text: { runs: [{ text: 'a<b>\n\nc', fontWeight: 700 }], style: { fontFamily: 'Inter', fontSize: 20, fontWeight: 400, lineHeight: 1.5, letterSpacing: 0, align: 'center', color: '#111' } },
    }, 120, 90, { fluid: true });
    expect(svg).toContain('a&lt;b&gt;');
    expect(svg).not.toContain('<b>');
    expect(svg.match(/<text /g)).toHaveLength(3);
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('width="100%"');
  });

  it('splits runs across explicit newlines', () => {
    expect(splitTextLines([{ text: 'ab\nc' }, { text: 'd', color: '#f00' }])).toEqual([
      [{ text: 'ab' }],
      [{ text: 'c' }, { text: 'd', color: '#f00' }],
    ]);
  });
});
