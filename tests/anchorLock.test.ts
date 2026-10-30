import { describe, expect, it } from 'vitest';
import { planAnchorConnections } from '../services/anchorLock';

const anchor = (id: string, approved: boolean) => ({ id, anchor: { kind: 'character' as const, approved } });
const shot = (id: string, index: number, anchorNodeIds?: string[]) => ({ id, shot: { index, anchorNodeIds } });

function ids() {
  let n = 0;
  return () => `c${++n}`;
}

describe('planAnchorConnections', () => {
  it('connects all approved anchors to shots without explicit anchors', () => {
    const plan = planAnchorConnections([anchor('hero', true), anchor('draft', false), shot('s1', 1), shot('s2', 2)], [], ids());
    expect(plan.connections.map(c => [c.fromNodeId, c.toNodeId, c.kind])).toEqual([
      ['hero', 's1', 'data'],
      ['hero', 's2', 'data'],
    ]);
    expect(plan.issues).toEqual([]);
    expect(plan.readyShotNodeIds).toEqual(['s1', 's2']);
  });

  it('skips existing connections', () => {
    const plan = planAnchorConnections([anchor('hero', true), shot('s1', 1)], [{ fromNodeId: 'hero', toNodeId: 's1' }], ids());
    expect(plan.connections).toEqual([]);
    expect(plan.readyShotNodeIds).toEqual(['s1']);
  });

  it('blocks shots that reference unapproved or missing anchors', () => {
    const plan = planAnchorConnections([anchor('hero', true), anchor('villain', false), shot('s1', 1, ['hero', 'villain']), shot('s2', 2, ['ghost'])], [], ids());
    expect(plan.connections.map(c => [c.fromNodeId, c.toNodeId])).toEqual([['hero', 's1']]);
    expect(plan.issues.map(i => [i.shotNodeId, i.anchorNodeId, i.code])).toEqual([
      ['s1', 'villain', 'anchor-not-approved'],
      ['s2', 'ghost', 'anchor-missing'],
    ]);
    expect(plan.readyShotNodeIds).toEqual([]);
  });

  it('does not mutate inputs', () => {
    const nodes = [anchor('hero', true), shot('s1', 1)];
    const snapshot = JSON.stringify(nodes);
    planAnchorConnections(nodes, [], ids());
    expect(JSON.stringify(nodes)).toBe(snapshot);
  });
});
