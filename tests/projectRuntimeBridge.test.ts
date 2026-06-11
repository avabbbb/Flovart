import { describe, expect, it } from 'vitest';
import type { AssetLibrary, ImageElement } from '../types';
import type { WorkflowEdge, WorkflowGroup, WorkflowNode, WorkflowViewport } from '../components/nodeflow/types';
import type { UnifiedProjectRuntime } from '../types/runtime';
import {
  syncCanvasElementsIntoRuntime,
  syncWorkflowGraphIntoRuntime,
} from '../services/projectRuntimeBridge';

const assets: AssetLibrary = { character: [], scene: [], prop: [] };

const emptyRuntime = (): UnifiedProjectRuntime => ({
  version: 1,
  projectId: 'project-1',
  entities: {},
  connections: {},
  canvasView: {
    nodes: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    showTechnicalEntities: false,
  },
  workflowView: {
    nodes: {},
    groups: {},
    viewport: { x: 0, y: 0, scale: 1 },
  },
  jobs: {},
  assets,
  settings: {},
  updatedAt: 1,
});

const image: ImageElement = {
  id: 'hero',
  type: 'image',
  name: 'Hero',
  x: 10,
  y: 20,
  width: 320,
  height: 180,
  href: 'data:image/png;base64,a',
  mimeType: 'image/png',
};

const workflowNodes: WorkflowNode[] = [
  { id: 'hero', kind: 'loadImage', x: 80, y: 120, config: { label: 'Hero Input' } },
  { id: 'video', kind: 'videoGen', x: 420, y: 120, config: { prompt: 'animate @Hero', model: 'seedance-2.0', provider: 'volcengine' } },
];

const workflowEdges: WorkflowEdge[] = [
  { id: 'edge-1', fromNode: 'hero', fromPort: 'image', toNode: 'video', toPort: 'image' },
];

const workflowGroups: WorkflowGroup[] = [
  { id: 'group-1', title: 'Shot 1', x: 40, y: 80, width: 700, height: 260, nodeIds: ['hero', 'video'] },
];

const viewport: WorkflowViewport = { x: 12, y: 24, scale: 0.8 };

describe('projectRuntimeBridge', () => {
  it('keeps canvas and workflow views pointed at the same runtime entity', () => {
    const withCanvas = syncCanvasElementsIntoRuntime(emptyRuntime(), {
      projectId: 'project-1',
      canvasElements: [image],
      assetLibrary: assets,
      viewport: { x: 4, y: 8, zoom: 1.25 },
      now: 10,
    });
    const withWorkflow = syncWorkflowGraphIntoRuntime(withCanvas, {
      nodes: workflowNodes,
      edges: workflowEdges,
      groups: workflowGroups,
      viewport,
      now: 11,
    });

    expect(withWorkflow.entities.hero.media?.href).toBe(image.href);
    expect(withWorkflow.entities.hero.name).toBe('Hero Input');
    expect(withWorkflow.canvasView.nodes.hero.entityId).toBe(withWorkflow.workflowView.nodes.hero.entityId);
    expect(withWorkflow.workflowView.nodes.video).toMatchObject({ entityId: 'video', nodeKind: 'videoGen', x: 420 });
    expect(withWorkflow.connections['edge-1']).toMatchObject({
      sourceEntityId: 'hero',
      targetEntityId: 'video',
      kind: 'workflow_edge',
    });
    expect(withWorkflow.workflowView.groups['group-1'].entityIds).toEqual(['hero', 'video']);
  });

  it('removes stale workflow edges while preserving non-workflow connections', () => {
    const runtime = {
      ...emptyRuntime(),
      entities: {
        hero: { id: 'hero', kind: 'image' as const, createdAt: 1, updatedAt: 1 },
        video: { id: 'video', kind: 'videoGen' as const, createdAt: 1, updatedAt: 1 },
      },
      connections: {
        stale: {
          id: 'stale',
          sourceEntityId: 'hero',
          targetEntityId: 'video',
          kind: 'workflow_edge' as const,
          sourcePort: 'image',
          targetPort: 'image',
          createdBy: 'workflow' as const,
          createdAt: 1,
        },
        slot: {
          id: 'slot',
          sourceEntityId: 'hero',
          targetEntityId: 'video',
          kind: 'media_slot' as const,
          role: 'first_frame' as const,
          createdBy: 'canvas' as const,
          createdAt: 1,
        },
      },
    };

    const synced = syncWorkflowGraphIntoRuntime(runtime, {
      nodes: workflowNodes,
      edges: workflowEdges,
      groups: [],
      viewport,
      now: 12,
    });

    expect(synced.connections.stale).toBeUndefined();
    expect(synced.connections.slot).toBeDefined();
    expect(synced.connections['edge-1']).toBeDefined();
  });

  it('updates runtime prompt payload when workflow node prompt changes', () => {
    const first = syncWorkflowGraphIntoRuntime(emptyRuntime(), {
      nodes: [{ id: 'video', kind: 'videoGen', x: 0, y: 0, config: { prompt: 'first prompt' } }],
      edges: [],
      groups: [],
      viewport,
      now: 1,
    });
    const second = syncWorkflowGraphIntoRuntime(first, {
      nodes: [{ id: 'video', kind: 'videoGen', x: 0, y: 0, config: { prompt: 'second prompt' } }],
      edges: [],
      groups: [],
      viewport,
      now: 2,
    });

    expect(second.entities.video.promptPayload?.rawText).toBe('second prompt');
  });
});
