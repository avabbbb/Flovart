import { describe, expect, it } from 'vitest';
import { buildProductionSpecV1, validateProductionSpec } from '../services/reverse/productionSpec';
import type { ReverseVideoProject } from '../services/reverse/types';

const project = {
  id: 'p1',
  outputs: [
    { id: 'o1', ownerKind: 'shot', ownerId: 's1', key: 'k1', status: 'completed', artifactId: 'art-1', createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'o2', ownerKind: 'shot', ownerId: 's2', key: 'k2', status: 'planned', createdAt: '2026-01-03T00:00:00.000Z' },
    { id: 'o3', ownerKind: 'shot', ownerId: 's3', key: 'k3', status: 'completed', path: '/media/ref.mp4', origin: 'external-file', createdAt: '2026-01-01T00:00:00.000Z' },
  ],
  analysis: {
    durationMs: 3000,
    words: [],
    segments: [],
    analyzedAt: 'fixture',
    source: 'manual' as const,
    shots: [
      { id: 's1', index: 1, startMs: 0, endMs: 1000, slotIds: [] },
      { id: 's2', index: 2, startMs: 1000, endMs: 2000, slotIds: [] },
      { id: 's3', index: 3, startMs: 2000, endMs: 3000, slotIds: [] },
    ],
  },
} as unknown as Pick<ReverseVideoProject, 'id' | 'analysis' | 'outputs'>;

describe('production spec v1', () => {
  it('derives frames, asset refs, and locks from completed outputs only', () => {
    const spec = buildProductionSpecV1(project, { fps: 30, width: 1080, height: 1920, sourceRevision: 12 });
    expect(spec).toMatchObject({
      schemaVersion: 1,
      projectId: 'p1',
      sourceRevision: 12,
      output: { width: 1080, height: 1920, fps: 30, durationFrames: 90 },
      renderer: 'remotion',
    });
    expect(spec.shots).toEqual([
      { shotId: 's1', index: 1, startFrame: 0, durationFrames: 30, sourceType: 'recorded', assetRef: 'art-1', locked: true },
      { shotId: 's2', index: 2, startFrame: 30, durationFrames: 30, sourceType: 'generated', locked: false },
      { shotId: 's3', index: 3, startFrame: 60, durationFrames: 30, sourceType: 'imported', assetRef: '/media/ref.mp4', locked: true },
    ]);
    expect(validateProductionSpec(spec)).toEqual([]);
  });

  it('is deterministic and defaults to 30fps 1920x1080', () => {
    const first = buildProductionSpecV1(project);
    const second = buildProductionSpecV1(project);
    expect(first).toEqual(second);
    expect(first.output).toMatchObject({ width: 1920, height: 1080, fps: 30, durationFrames: 90 });
  });

  it('reports structural problems before a render', () => {
    const spec = buildProductionSpecV1(project);
    expect(validateProductionSpec({
      ...spec,
      schemaVersion: 2 as never,
      output: { ...spec.output, fps: 0 },
      shots: [{ ...spec.shots[0]!, durationFrames: 0 }],
    })).toEqual(expect.arrayContaining([
      'schemaVersion 必须是 1',
      'output.fps 必须等于 1',
      's1: durationFrames 必须是正整数',
    ].map((expected) => expected === 'output.fps 必须等于 1' ? 'output.fps 必须是正数' : expected)));
    expect(validateProductionSpec({
      ...spec,
      shots: [spec.shots[1]!, spec.shots[0]!],
    })).toContain('s1: 镜头重叠或顺序错误');
    expect(validateProductionSpec({ ...spec, shots: [] })).toContain('shots 不能为空');
  });

  it('keeps an empty-timeline project valid with no shots', () => {
    const spec = buildProductionSpecV1({ ...project, analysis: undefined } as never);
    expect(spec.output.durationFrames).toBe(1);
    expect(spec.shots).toEqual([]);
    expect(validateProductionSpec(spec)).toEqual(['shots 不能为空']);
  });
});
