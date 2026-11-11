import { describe, expect, it } from 'vitest';
import { migrateReverseState } from '../stores/useReverseStore';

describe('reverse store migration', () => {
  it('adds origin to v1 outputs without inventing a reuse key', () => {
    const v1 = { tab: 'video', activeIds: { video: 'p1', game: null }, projects: [{ id: 'p1', direction: 'video', outputs: [{ id: 'o1', ownerKind: 'variant', ownerId: 'base', workflowNodeId: 'n1', createdAt: 'x' }] }] };
    const next = migrateReverseState(v1, 1) as typeof v1 & { projects: Array<{ outputs: Array<Record<string, unknown>> }> };
    expect(next.projects[0]!.outputs[0]!.origin).toBe('generated');
    expect(next.projects[0]!.outputs[0]!.key).toBeUndefined();
    expect(next.projects[0]!.outputs[0]!.status).toBe('planned');
  });

  it('drops game projects and their active id when moving to v3', () => {
    const v2 = { tab: 'game', activeIds: { video: 'p1', game: 'g1' }, projects: [{ id: 'p1', direction: 'video', outputs: [] }, { id: 'g1', direction: 'game', outputs: [] }] };
    const next = migrateReverseState(v2, 2) as { tab: string; activeIds: Record<string, string | null>; projects: Array<{ id: string }> };
    expect(next.projects.map((p) => p.id)).toEqual(['p1']);
    expect(next.activeIds).toEqual({ video: 'p1' });
    expect(next.tab).toBe('video');
  });

  it('marks v3 outputs as planned unless a real artifact exists', () => {
    const v3 = {
      projects: [{
        id: 'p1', direction: 'video',
        outputs: [
          { id: 'placeholder', ownerKind: 'shot', ownerId: 's1', key: 'k1', origin: 'generated', createdAt: 'x' },
          { id: 'real', ownerKind: 'shot', ownerId: 's2', key: 'k2', origin: 'generated', path: '/media/a.mp4', createdAt: 'x' },
        ],
      }],
      activeIds: { video: 'p1' },
    };
    const next = migrateReverseState(v3, 3) as { projects: Array<{ outputs: Array<Record<string, unknown>> }> };
    expect(next.projects[0]!.outputs[0]).toMatchObject({ status: 'planned' });
    expect(next.projects[0]!.outputs[1]).toMatchObject({ status: 'completed' });
  });

  it('leaves current-version state untouched', () => {
    const v4 = { projects: [] };
    expect(migrateReverseState(v4, 4)).toBe(v4);
  });
});
