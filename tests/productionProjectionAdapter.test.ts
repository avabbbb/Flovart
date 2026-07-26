import { describe, expect, it, vi } from 'vitest';
import {
  mergeProductionProjection,
  ProductionProjectionAdapter,
} from '../services/productionProjectionAdapter';

const project = {
  id: 'workflow-project-1',
  title: '可见工作流',
  nodes: [
    {
      id: 'user-note',
      type: 'text',
      title: '用户便签',
      position: { x: 20, y: 30 },
      width: 300,
      height: 200,
      metadata: { content: '不要删除' },
    },
    {
      id: 'production-stage-keyframe',
      type: 'text',
      title: '旧关键帧',
      position: { x: 888, y: 666 },
      width: 420,
      height: 260,
      metadata: {
        content: '旧状态',
        productionProjection: {
          projectionId: 'projection-old',
          projectionVersion: 1,
          productionSessionId: 'session-1',
          specRevisionId: 'spec-1',
          productionRunId: 'run-1',
          stageRunId: 'stage-old',
          stageKey: 'shot:1:keyframe',
          capabilityId: 'image.generate',
        },
      },
    },
  ],
  connections: [
    {
      id: 'user-connection',
      fromNodeId: 'user-note',
      toNodeId: 'production-stage-keyframe',
    },
    {
      id: 'production-dependency-old',
      fromNodeId: 'production-stage-keyframe',
      toNodeId: 'production-stage-removed',
    },
  ],
  selectedNodeIds: ['user-note'],
  viewport: { x: 10, y: 20, k: 1.2 },
  backgroundMode: 'dots',
  agentSessions: [],
  activeAgentSessionId: null,
  createdAt: '2026-07-26T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
} as const;

const projection = {
  schemaVersion: 'flovart.workflow-projection/1',
  projectionId: 'projection-new',
  projectionVersion: 2,
  projectionHash: 'a'.repeat(64),
  projectId: 'workflow-project-1',
  productionSessionId: 'session-1',
  specRevisionId: 'spec-2',
  productionRunId: 'run-2',
  nodes: [
    {
      id: 'production-stage-keyframe',
      type: 'text',
      title: '新关键帧状态',
      position: { x: 420, y: 120 },
      width: 320,
      height: 220,
      metadata: {
        content: '新状态',
        productionProjection: {
          projectionId: 'projection-new',
          projectionVersion: 2,
          productionSessionId: 'session-1',
          specRevisionId: 'spec-2',
          productionRunId: 'run-2',
          stageRunId: 'stage-new',
          stageKey: 'shot:1:keyframe',
          capabilityId: 'image.generate',
        },
      },
    },
    {
      id: 'production-stage-motion',
      type: 'text',
      title: '动态镜头',
      position: { x: 780, y: 120 },
      width: 320,
      height: 220,
      metadata: {
        content: '等待关键帧',
        productionProjection: {
          projectionId: 'projection-new',
          projectionVersion: 2,
          productionSessionId: 'session-1',
          specRevisionId: 'spec-2',
          productionRunId: 'run-2',
          stageRunId: 'stage-motion',
          stageKey: 'shot:1:motion',
          capabilityId: 'video.generate',
        },
      },
    },
  ],
  connections: [
    {
      id: 'production-dependency-new',
      fromNodeId: 'production-stage-keyframe',
      toNodeId: 'production-stage-motion',
    },
  ],
} as const;

describe('Production Plan Projection Adapter', () => {
  it('rebuilds only Runtime-owned nodes while preserving user graph and projected layout edits', () => {
    const merged = mergeProductionProjection(project as any, projection as any);

    expect(merged.nodes.find(node => node.id === 'user-note')).toEqual(project.nodes[0]);
    expect(merged.nodes.find(node => node.id === 'production-stage-keyframe')).toMatchObject({
      title: '新关键帧状态',
      position: { x: 888, y: 666 },
      width: 420,
      height: 260,
      metadata: {
        content: '新状态',
        productionProjection: {
          projectionId: 'projection-new',
          stageRunId: 'stage-new',
        },
      },
    });
    expect(merged.nodes.some(node => node.id === 'production-stage-motion')).toBe(true);
    expect(merged.connections).toEqual(expect.arrayContaining([
      project.connections[0],
      projection.connections[0],
    ]));
    expect(merged.connections.some(connection => connection.id === 'production-dependency-old')).toBe(false);
    expect(merged.selectedNodeIds).toEqual(['user-note']);
    expect(merged.viewport).toEqual(project.viewport);
  });

  it('reads the Runtime projection and commits each projection hash only once', async () => {
    let currentProject = project as any;
    const updateProject = vi.fn((_projectId, patch) => {
      currentProject = { ...currentProject, ...patch };
    });
    const execute = vi.fn().mockResolvedValue({
      projectId: project.id,
      projectionVersion: projection.projectionVersion,
      projection,
    });
    const adapter = new ProductionProjectionAdapter({
      runtime: { execute } as any,
      getProject: () => currentProject,
      updateProject,
    });

    await expect(adapter.sync(project.id)).resolves.toBe('applied');
    await expect(adapter.sync(project.id)).resolves.toBe('unchanged');

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'workflow.projection.get',
      args: { projectId: project.id },
      actor: { kind: 'ui', instanceId: 'production_projection_adapter' },
    }));
    expect(updateProject).toHaveBeenCalledOnce();
  });
});
