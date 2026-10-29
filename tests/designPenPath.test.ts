import { describe, expect, it } from 'vitest';
import { anchorsToPath, parsePath, pathBounds, pathToAnchors, samplePath, serializeCommands, transformPath } from '../services/design/penPath';

describe('pen path', () => {
  it('normalizes relative and shorthand commands to absolute M/L/C/Z', () => {
    const commands = parsePath('m10 10 h20 v10 l-5 5 z');
    expect(commands.map(c => c.type)).toEqual(['M', 'L', 'L', 'L', 'Z']);
    expect(commands[2]).toEqual({ type: 'L', x: 30, y: 20 });
    expect(commands[3]).toEqual({ type: 'L', x: 25, y: 25 });
  });

  it('treats extra coordinates after M as implicit lineto', () => {
    expect(serializeCommands(parsePath('M0 0 10 0 10 10'))).toBe('M0 0 L10 0 L10 10');
  });

  it('reflects control points for S and T', () => {
    const [, first, second] = parsePath('M0 0 C0 10 10 10 10 0 S20 -10 20 0');
    expect(first.type).toBe('C');
    expect(second).toMatchObject({ type: 'C', x1: 10, y1: -10, x: 20, y: 0 });
    const quad = parsePath('M0 0 Q5 10 10 0 T20 0');
    expect(quad).toHaveLength(3);
    expect(quad[2]).toMatchObject({ type: 'C', x: 20, y: 0 });
    const last = quad[2];
    expect(last.type === 'C' ? last.y1 : Number.NaN).toBeCloseTo(-20 / 3, 6);
  });

  it('converts arcs, including compact flag syntax', () => {
    const arc = parsePath('M0 0 a10 10 0 0110 10');
    expect(arc.length).toBeGreaterThan(1);
    expect(arc[arc.length - 1]).toMatchObject({ type: 'C', x: 10, y: 10 });
    const circle = pathBounds('M0 10 A10 10 0 1 1 20 10 A10 10 0 1 1 0 10 Z');
    expect(circle?.width).toBeCloseTo(20, 1);
    expect(circle?.height).toBeCloseTo(20, 1);
  });

  it('round-trips anchors through path data', () => {
    const subpaths = [{
      closed: true,
      anchors: [
        { x: 0, y: 0, out: { x: 10, y: -10 } },
        { x: 40, y: 0, in: { x: 30, y: -10 } },
        { x: 20, y: 30 },
      ],
    }];
    const d = anchorsToPath(subpaths);
    expect(d).toBe('M0 0 C10 -10 30 -10 40 0 L20 30 Z');
    expect(pathToAnchors(d)).toEqual(subpaths);
  });

  it('keeps open subpaths and multiple subpaths', () => {
    const result = pathToAnchors('M0 0 L10 0 M20 20 L30 30 L20 30 Z');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ closed: false, anchors: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    expect(result[1].closed).toBe(true);
    expect(result[1].anchors).toHaveLength(3);
  });

  it('samples curves into polygons and transforms paths', () => {
    const [polygon] = samplePath('M0 0 C0 10 10 10 10 0 Z', 8);
    expect(polygon.closed).toBe(true);
    expect(polygon.points).toHaveLength(9);
    expect(transformPath('M1 2 L3 4', p => ({ x: p.x * 2, y: p.y + 1 }))).toBe('M2 3 L6 5');
  });

  it('ignores garbage without throwing', () => {
    expect(parsePath('M 0 0 L 5')).toEqual([{ type: 'M', x: 0, y: 0 }]);
    expect(pathBounds('')).toBeNull();
  });
});
