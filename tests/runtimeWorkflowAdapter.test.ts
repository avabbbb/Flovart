import { describe, expect, it } from 'vitest';
import { createWorkflowExecutionInputFromRuntime } from '../services/runtimeWorkflowAdapter';
import type { UnifiedProjectRuntime } from '../types/runtime';

const runtime = (): UnifiedProjectRuntime => ({
  version: 1,
  projectId: 'project-1',
  entities: {
    prompt: {
      id: 'prompt',
      kind: 'prompt',
      name: 'Prompt',
      promptPayload: { rawText: 'a mountain at sunrise', resolvedReferences: [] },
      createdAt: 1,
      updatedAt: 1,
    },
    image: {
      id: 'image',
      kind: 'imageGen',
      name: 'Image',
      modelId: 'gemini-3.1-flash-image-preview',
      provider: 'google',
      params: { aspectRatio: '16:9', resolution: '2K' },
      createdAt: 1,
      updatedAt: 1,
    },
  },
  connections: {
    edge: {
      id: 'edge',
      sourceEntityId: 'prompt',
      targetEntityId: 'image',
      kind: 'workflow_edge',
      sourcePort: 'text',
      targetPort: 'text',
      createdBy: 'workflow',
      createdAt: 1,
    },
  },
  canvasView: {
    nodes: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    showTechnicalEntities: false,
  },
  workflowView: {
    nodes: {
      prompt: { entityId: 'prompt', nodeKind: 'prompt', x: 0, y: 0 },
      image: { entityId: 'image', nodeKind: 'imageGen', x: 360, y: 0 },
    },
    groups: {},
    viewport: { x: 0, y: 0, scale: 1 },
  },
  jobs: {},
  assets: { character: [], scene: [], prop: [] },
  settings: {},
  updatedAt: 1,
});

describe('runtimeWorkflowAdapter', () => {
  it('builds executable workflow nodes and edges from runtime', () => {
    const input = createWorkflowExecutionInputFromRuntime(runtime());

    expect(input.nodes.find((node) => node.id === 'prompt')?.config?.prompt).toBe('a mountain at sunrise');
    expect(input.nodes.find((node) => node.id === 'image')?.config).toMatchObject({
      label: 'Image',
      model: 'gemini-3.1-flash-image-preview',
      provider: 'google',
      aspectRatio: '16:9',
      resolution: '2K',
    });
    expect(input.edges).toEqual([
      { id: 'edge', fromNode: 'prompt', fromPort: 'text', toNode: 'image', toPort: 'text' },
    ]);
  });
});
