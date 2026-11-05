import { describe, expect, it } from 'vitest';
import { buildProductionBible } from '../components/workflow/productionBible';

const n = (id: string, extra: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) =>
  ({ id, type: 'image', title: 'T-' + id, position: { x: 0, y: 0 }, width: 1, height: 1, metadata, ...extra }) as never;

describe('production bible', () => {
  it('summarises anchors and ordered shots, resolving approved upstream anchors', () => {
    const bible = buildProductionBible({
      nodes: [
        n('hero', { anchor: { kind: 'character', approved: true } }),
        n('style', { anchor: { kind: 'style', approved: false } }),
        n('s2', { shot: { index: 2, durationSec: 4 } }, { href: 'blob:2' }),
        n('s1', { shot: { index: 1, durationSec: 3, anchorNodeIds: ['style'] } }),
        n('s4', { shot: { index: 4 } }),
      ],
      connections: [
        { id: 'c1', fromNodeId: 'hero', toNodeId: 's2' },
        { id: 'c2', fromNodeId: 'style', toNodeId: 's2' },
      ] as never,
    });
    expect(bible.shots.map(shot => shot.nodeId)).toEqual(['s1', 's2', 's4']);
    expect(bible.shots[1].anchorNodeIds).toEqual(['hero']);
    expect(bible.totals).toEqual({ shotCount: 3, durationSec: 7, approvedAnchors: 1, pendingAnchors: 1, shotsWithoutMedia: 2 });
    expect(bible.issues.some(issue => issue.includes('尚未批准'))).toBe(true);
    expect(bible.issues.some(issue => issue.includes('缺口'))).toBe(true);
  });

  it('is empty and safe for projects without shots', () => {
    expect(buildProductionBible(null)).toMatchObject({ anchors: [], shots: [], issues: [] });
  });
});
