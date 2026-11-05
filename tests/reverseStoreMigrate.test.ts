import { describe, expect, it } from 'vitest';
import { migrateReverseState } from '../stores/useReverseStore';

describe('reverse store migration', () => {
  it('adds origin to v1 outputs without inventing a reuse key', () => {
    const v1 = { tab: 'video', activeIds: { video: 'p1', game: null }, projects: [{ id: 'p1', direction: 'video', outputs: [{ id: 'o1', ownerKind: 'variant', ownerId: 'base', workflowNodeId: 'n1', createdAt: 'x' }] }] };
    const next = migrateReverseState(v1, 1) as typeof v1 & { projects: Array<{ outputs: Array<Record<string, unknown>> }> };
    expect(next.projects[0]!.outputs[0]!.origin).toBe('generated');
    expect(next.projects[0]!.outputs[0]!.key).toBeUndefined();
  });

  it('drops game projects and their active id when moving to v3', () => {
    const v2 = { tab: 'game', activeIds: { video: 'p1', game: 'g1' }, projects: [{ id: 'p1', direction: 'video', outputs: [] }, { id: 'g1', direction: 'game', outputs: [] }] };
    const next = migrateReverseState(v2, 2) as { tab: string; activeIds: Record<string, string | null>; projects: Array<{ id: string }> };
    expect(next.projects.map((p) => p.id)).toEqual(['p1']);
    expect(next.activeIds).toEqual({ video: 'p1' });
    expect(next.tab).toBe('video');
  });

  it('leaves current-version state untouched', () => {
    const v3 = { projects: [] };
    expect(migrateReverseState(v3, 3)).toBe(v3);
  });
});
