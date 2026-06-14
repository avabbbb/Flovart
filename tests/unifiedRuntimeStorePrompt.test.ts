import { beforeEach, describe, expect, it } from 'vitest';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import {
  applyPromptTextToRuntime,
  createRuntimePromptTarget,
} from '../components/prompt/PromptComposerTarget';
import type { RuntimeEntity, UnifiedProjectRuntime } from '../types/runtime';

const runtime = (): UnifiedProjectRuntime => ({
  version: 1,
  projectId: 'project-1',
  entities: {
    target: {
      id: 'target',
      kind: 'videoGen',
      name: 'Video Target',
      promptPayload: { rawText: '', resolvedReferences: [] },
      modelId: 'seedance-2.0',
      provider: 'volcengine',
      createdAt: 1,
      updatedAt: 1,
    },
    ref: {
      id: 'ref',
      kind: 'image',
      name: 'Reference',
      media: { kind: 'image', href: 'data:image/png;base64,a', mimeType: 'image/png' },
      createdAt: 1,
      updatedAt: 1,
    },
  },
  connections: {},
  canvasView: {
    nodes: {
      target: { entityId: 'target', x: 10, y: 20, width: 260, height: 146, zIndex: 0, visible: true },
      ref: { entityId: 'ref', x: 320, y: 20, width: 260, height: 146, zIndex: 1, visible: true },
    },
    viewport: { x: 0, y: 0, zoom: 1 },
    showTechnicalEntities: false,
  },
  workflowView: {
    nodes: {
      target: { entityId: 'target', nodeKind: 'videoGen', x: 100, y: 120 },
      ref: { entityId: 'ref', nodeKind: 'imageGen', x: 0, y: 120 },
    },
    groups: {},
    viewport: { x: 0, y: 0, scale: 1 },
  },
  jobs: {},
  assets: { character: [], scene: [], prop: [] },
  settings: {},
  updatedAt: 1,
});

describe('useRuntimeStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useRuntimeStore.getState().replaceRuntime(runtime());
  });

  it('updates an entity without duplicating view state', () => {
    useRuntimeStore.getState().upsertEntity({
      id: 'new-image',
      kind: 'image',
      name: 'New Image',
      createdAt: 2,
      updatedAt: 2,
    });

    expect(useRuntimeStore.getState().runtime.entities['new-image'].name).toBe('New Image');

    useRuntimeStore.getState().updateEntity('target', { name: 'Renamed' });

    const state = useRuntimeStore.getState().runtime;
    expect(state.entities.target.name).toBe('Renamed');
    expect(state.canvasView.nodes.target).toMatchObject({ entityId: 'target', x: 10, y: 20 });
    expect(state.workflowView.nodes.target).toMatchObject({ entityId: 'target', x: 100, y: 120 });
  });

  it('removes related view records and connections when deleting an entity', () => {
    useRuntimeStore.getState().upsertConnection({
      id: 'slot',
      sourceEntityId: 'ref',
      targetEntityId: 'target',
      kind: 'media_slot',
      role: 'first_frame',
      createdBy: 'canvas',
      createdAt: 2,
    });

    useRuntimeStore.getState().removeEntity('ref');

    const state = useRuntimeStore.getState().runtime;
    expect(state.entities.ref).toBeUndefined();
    expect(state.canvasView.nodes.ref).toBeUndefined();
    expect(state.workflowView.nodes.ref).toBeUndefined();
    expect(state.connections.slot).toBeUndefined();
  });
});

describe('PromptComposerTarget', () => {
  it('creates prompt reference connections from mentions and removes stale prompt references', () => {
    const initial = runtime();
    const target = createRuntimePromptTarget(initial, 'target');

    expect(target.entity.id).toBe('target');
    expect(target.availableReferences.map((entity: RuntimeEntity) => entity.id)).toEqual(['ref']);

    const withMention = applyPromptTextToRuntime(initial, 'target', '@Reference animate this', 10);
    expect(withMention.entities.target.promptPayload?.rawText).toBe('@Reference animate this');
    expect(Object.values(withMention.connections)).toEqual([
      expect.objectContaining({
        sourceEntityId: 'ref',
        targetEntityId: 'target',
        kind: 'prompt_reference',
        role: 'reference',
        createdBy: 'prompt',
      }),
    ]);

    const removed = applyPromptTextToRuntime(withMention, 'target', 'animate this', 11);
    expect(Object.values(removed.connections)).toHaveLength(0);
  });
});
