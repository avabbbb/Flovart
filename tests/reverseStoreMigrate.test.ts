import { describe, expect, it } from 'vitest';
import { migrateReverseState } from '../stores/useReverseStore';

describe('reverse store migration', () => {
  it('adds origin to v1 outputs without inventing a reuse key', () => {
    const v1 = { tab: 'video', activeIds: { video: 'p1', game: null }, projects: [{ id: 'p1', direction: 'video', outputs: [{ id: 'o1', ownerKind: 'variant', ownerId: 'base', workflowNodeId: 'n1', createdAt: 'x' }] }] };
    const next = migrateReverseState(v1, 1) as typeof v1 & { projects: Array<{ outputs: Array<Record<string, unknown>> }> };
    expect(next.projects[0]!.outputs[0]!.origin).toBe('generated');
    expect(next.projects[0]!.outputs[0]!.key).toBeUndefined();
  });

  it('leaves current-version state untouched', () => {
    const v2 = { projects: [] };
    expect(migrateReverseState(v2, 2)).toBe(v2);
  });
});
