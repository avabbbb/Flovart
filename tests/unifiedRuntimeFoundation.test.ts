import { describe, expect, it } from 'vitest';
import type { ImageElement, VideoElement } from '../types';
import type { WorkflowEdge, WorkflowNode } from '../components/nodeflow/types';
import type { UnifiedProjectRuntime, RuntimeConnection, RuntimeEntity } from '../types/runtime';
import { normalizeRuntimeConnections } from '../utils/runtimeConnectionNormalizer';
import { migrateLegacyStateToRuntime } from '../utils/unifiedRuntimeMigration';
import { selectCanvasElements, selectWorkflowGraph } from '../utils/runtimeSelectors';

const entity = (id: string, kind: RuntimeEntity['kind'], name?: string): RuntimeEntity => ({
  id,
  kind,
  name,
  createdAt: 1,
  updatedAt: 1,
});

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
  assets: { character: [], scene: [], prop: [] },
  settings: {},
  updatedAt: 1,
});

describe('UnifiedProjectRuntime foundation', () => {
  it('represents the same entity in canvas and workflow views', () => {
    const runtime = emptyRuntime();
    runtime.entities.hero = {
      ...entity('hero', 'image', 'Hero'),
      media: { kind: 'image', href: 'data:image/png;base64,a', mimeType: 'image/png' },
    };
    runtime.canvasView.nodes.hero = {
      entityId: 'hero',
      x: 10,
      y: 20,
      width: 320,
      height: 180,
      zIndex: 0,
      visible: true,
    };
    runtime.workflowView.nodes.hero = {
      entityId: 'hero',
      nodeKind: 'image',
      x: 100,
      y: 120,
    };

    expect(runtime.canvasView.nodes.hero.entityId).toBe(runtime.workflowView.nodes.hero.entityId);
  });

  it('normalizes runtime connections by dropping missing endpoints and deduping equivalents', () => {
    const entities = {
      source: entity('source', 'image'),
      target: entity('target', 'videoGen'),
    };
    const connections: RuntimeConnection[] = [
      {
        id: 'slot_1',
        sourceEntityId: 'source',
        targetEntityId: 'target',
        kind: 'media_slot',
        role: 'first_frame',
        createdBy: 'canvas',
        createdAt: 1,
      },
      {
        id: 'slot_duplicate',
        sourceEntityId: 'source',
        targetEntityId: 'target',
        kind: 'media_slot',
        role: 'first_frame',
        createdBy: 'workflow',
        createdAt: 2,
      },
      {
        id: 'missing',
        sourceEntityId: 'missing',
        targetEntityId: 'target',
        kind: 'media_slot',
        role: 'first_frame',
        createdBy: 'cli',
        createdAt: 3,
      },
      {
        id: 'workflow_edge',
        sourceEntityId: 'source',
        targetEntityId: 'target',
        kind: 'workflow_edge',
        sourcePort: 'image',
        targetPort: 'image',
        createdBy: 'workflow',
        createdAt: 4,
      },
    ];

    expect(Object.keys(normalizeRuntimeConnections(entities, connections))).toEqual(['slot_1', 'workflow_edge']);
  });

  it('migrates legacy canvas elements and workflow nodes into one runtime', () => {
    const image: ImageElement = {
      id: 'canvas_image',
      type: 'image',
      name: 'Canvas Image',
      x: 10,
      y: 20,
      width: 320,
      height: 180,
      href: 'data:image/png;base64,a',
      mimeType: 'image/png',
    };
    const video: VideoElement = {
      id: 'canvas_video',
      type: 'video',
      name: 'Canvas Video',
      x: 440,
      y: 20,
      width: 320,
      height: 180,
      href: 'blob:video',
      mimeType: 'video/mp4',
      poster: 'data:image/png;base64,p',
      durationSec: 8,
    };
    const workflowNodes: WorkflowNode[] = [
      {
        id: 'canvas_image',
        kind: 'imageGen',
        x: 100,
        y: 120,
        config: { prompt: 'polish this image', model: 'gemini-3.1-flash-image-preview', provider: 'google' },
      },
      {
        id: 'video_gen',
        kind: 'videoGen',
        x: 460,
        y: 120,
        config: { prompt: 'animate it', model: 'seedance-2.0', provider: 'volcengine', aspectRatio: '16:9' },
      },
    ];
    const workflowEdges: WorkflowEdge[] = [
      { id: 'edge_1', fromNode: 'canvas_image', fromPort: 'image', toNode: 'video_gen', toPort: 'image' },
    ];

    const runtime = migrateLegacyStateToRuntime({
      projectId: 'project-1',
      canvasElements: [image, video],
      workflowNodes,
      workflowEdges,
      assetLibrary: { character: [], scene: [], prop: [] },
      now: 100,
    });

    expect(runtime.entities.canvas_image.media?.href).toBe(image.href);
    expect(runtime.entities.canvas_image.promptPayload?.rawText).toBe('polish this image');
    expect(runtime.entities.video_gen).toMatchObject({
      kind: 'videoGen',
      modelId: 'seedance-2.0',
      provider: 'volcengine',
    });
    expect(runtime.canvasView.nodes.canvas_video).toMatchObject({ entityId: 'canvas_video', x: 440, y: 20 });
    expect(runtime.workflowView.nodes.video_gen).toMatchObject({ entityId: 'video_gen', x: 460, y: 120 });
    expect(runtime.connections.edge_1).toMatchObject({
      kind: 'workflow_edge',
      sourceEntityId: 'canvas_image',
      targetEntityId: 'video_gen',
    });
  });

  it('derives canvas elements and workflow graph from runtime state', () => {
    const runtime = emptyRuntime();
    runtime.entities.image = {
      ...entity('image', 'image', 'Image'),
      media: { kind: 'image', href: 'data:image/png;base64,a', mimeType: 'image/png', width: 320, height: 180 },
    };
    runtime.entities.llm = {
      ...entity('llm', 'llm', 'LLM'),
      promptPayload: { rawText: 'describe @Image', resolvedReferences: [] },
      modelId: 'gemini-3-flash-preview',
      provider: 'google',
    };
    runtime.canvasView.nodes.image = { entityId: 'image', x: 10, y: 20, width: 320, height: 180, zIndex: 0, visible: true };
    runtime.canvasView.nodes.llm = { entityId: 'llm', x: 40, y: 60, width: 260, height: 120, zIndex: 1, visible: true };
    runtime.workflowView.nodes.image = { entityId: 'image', nodeKind: 'imageGen', x: 0, y: 0 };
    runtime.workflowView.nodes.llm = { entityId: 'llm', nodeKind: 'llm', x: 320, y: 0 };
    runtime.connections.edge = {
      id: 'edge',
      sourceEntityId: 'image',
      targetEntityId: 'llm',
      kind: 'workflow_edge',
      sourcePort: 'image',
      targetPort: 'input',
      createdBy: 'workflow',
      createdAt: 1,
    };

    expect(selectCanvasElements(runtime).map((element) => element.id)).toEqual(['image']);
    expect(selectCanvasElements({
      ...runtime,
      canvasView: { ...runtime.canvasView, showTechnicalEntities: true },
    }).map((element) => element.id)).toEqual(['image', 'llm']);

    const graph = selectWorkflowGraph(runtime);
    expect(graph.nodes.map((node) => node.id)).toEqual(['image', 'llm']);
    expect(graph.nodes.find((node) => node.id === 'llm')?.config?.prompt).toBe('describe @Image');
    expect(graph.edges).toEqual([{ id: 'edge', fromNode: 'image', fromPort: 'image', toNode: 'llm', toPort: 'input' }]);
  });
});
