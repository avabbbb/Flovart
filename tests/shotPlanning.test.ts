import { describe, expect, it } from 'vitest';
import { orderNodesByShot, totalShotDuration, validateShotList } from '../services/shotPlanning';

const n = (id: string, index?: number, durationSec?: number) => ({
  id,
  shot: index === undefined ? undefined : { index, durationSec },
});

describe('shotPlanning', () => {
  it('orders by shot index, keeps unnumbered nodes after in original order', () => {
    const nodes = [n('x'), n('c', 3), n('a', 1), n('y'), n('b', 2)];
    expect(orderNodesByShot(nodes).map(node => node.id)).toEqual(['a', 'b', 'c', 'x', 'y']);
  });

  it('is stable for equal indexes and does not mutate input', () => {
    const nodes = [n('first', 1), n('second', 1)];
    const copy = [...nodes];
    expect(orderNodesByShot(nodes).map(node => node.id)).toEqual(['first', 'second']);
    expect(nodes).toEqual(copy);
  });

  it('reports invalid, duplicate index and bad duration', () => {
    const issues = validateShotList([n('a', 1), n('b', 1), n('c', 0), n('d', 2, -3), n('e')]);
    expect(issues.map(issue => [issue.nodeId, issue.code])).toEqual([
      ['b', 'duplicate-index'],
      ['c', 'invalid-index'],
      ['d', 'invalid-duration'],
    ]);
  });

  it('sums only declared positive durations', () => {
    expect(totalShotDuration([n('a', 1, 5), n('b', 2), n('c', 3, 2.5)])).toBe(7.5);
  });
});
