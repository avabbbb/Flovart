import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  CanvasViewNode,
  RuntimeConnection,
  RuntimeEntity,
  UnifiedProjectRuntime,
  WorkflowViewNode,
} from '../types/runtime';
import { normalizeRuntimeConnections } from '../utils/runtimeConnectionNormalizer';

const emptyRuntime = (): UnifiedProjectRuntime => ({
  version: 1,
  projectId: 'local',
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
  updatedAt: 0,
});

function touch(runtime: UnifiedProjectRuntime): UnifiedProjectRuntime {
  return { ...runtime, updatedAt: Date.now() };
}

interface RuntimeStore {
  runtime: UnifiedProjectRuntime;
  replaceRuntime: (runtime: UnifiedProjectRuntime) => void;
  upsertEntity: (entity: RuntimeEntity) => void;
  updateEntity: (entityId: string, patch: Partial<RuntimeEntity>) => void;
  removeEntity: (entityId: string) => void;
  upsertConnection: (connection: RuntimeConnection) => void;
  removeConnection: (connectionId: string) => void;
  upsertCanvasViewNode: (node: CanvasViewNode) => void;
  upsertWorkflowViewNode: (node: WorkflowViewNode) => void;
  setCanvasTechnicalOverlay: (enabled: boolean) => void;
}

const RUNTIME_STORAGE_KEY = 'flovart.unifiedRuntime.v1';

const safeRuntimeStorage = {
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
    } catch (err) {
      try {
        localStorage.removeItem(name);
      } catch {
        // ignore cleanup failures
      }
      console.warn('[useRuntimeStore] Skipped runtime persistence because storage quota was exceeded.', err);
    }
  },
  removeItem: (name: string) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // ignore
    }
  },
};

function stripLargeRuntimeFields(runtime: UnifiedProjectRuntime): UnifiedProjectRuntime {
  const slimEntities: Record<string, RuntimeEntity> = {};
  for (const [id, entity] of Object.entries(runtime.entities)) {
    slimEntities[id] = {
      id: entity.id,
      kind: entity.kind,
      name: entity.name,
      media: entity.media ? {
        kind: entity.media.kind,
        href: '',
        mimeType: entity.media.mimeType,
        width: entity.media.width,
        height: entity.media.height,
        durationSec: entity.media.durationSec,
        trimInSec: entity.media.trimInSec,
        trimOutSec: entity.media.trimOutSec,
      } : undefined,
      promptPayload: entity.promptPayload ? {
        rawText: entity.promptPayload.rawText,
        resolvedReferences: entity.promptPayload.resolvedReferences,
      } : undefined,
      provider: entity.provider,
      modelId: entity.modelId,
      apiKeyRef: entity.apiKeyRef,
      params: entity.params,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  return {
    ...runtime,
    entities: slimEntities,
    jobs: {},
    assets: { character: [], scene: [], prop: [] },
  };
}

function partializeRuntime(state: RuntimeStore) {
  return {
    runtime: stripLargeRuntimeFields(state.runtime),
  };
}

export const useRuntimeStore = create<RuntimeStore>()(
  persist(
    (set) => ({
      runtime: emptyRuntime(),
      replaceRuntime: (runtime) => set({ runtime }),
      upsertEntity: (entity) => set((state) => ({
        runtime: touch({
          ...state.runtime,
          entities: {
            ...state.runtime.entities,
            [entity.id]: entity,
          },
        }),
      })),
      updateEntity: (entityId, patch) => set((state) => {
        const current = state.runtime.entities[entityId];
        if (!current) return state;
        return {
          runtime: touch({
            ...state.runtime,
            entities: {
              ...state.runtime.entities,
              [entityId]: {
                ...current,
                ...patch,
                id: entityId,
                updatedAt: Date.now(),
              },
            },
          }),
        };
      }),
      removeEntity: (entityId) => set((state) => {
        const { [entityId]: _removedEntity, ...entities } = state.runtime.entities;
        const { [entityId]: _removedCanvasNode, ...canvasNodes } = state.runtime.canvasView.nodes;
        const { [entityId]: _removedWorkflowNode, ...workflowNodes } = state.runtime.workflowView.nodes;
        const connections = Object.values(state.runtime.connections).filter((connection) => (
          connection.sourceEntityId !== entityId && connection.targetEntityId !== entityId
        ));
        return {
          runtime: touch({
            ...state.runtime,
            entities,
            connections: normalizeRuntimeConnections(entities, connections),
            canvasView: {
              ...state.runtime.canvasView,
              nodes: canvasNodes,
            },
            workflowView: {
              ...state.runtime.workflowView,
              nodes: workflowNodes,
            },
          }),
        };
      }),
      upsertConnection: (connection) => set((state) => {
        const connections = [
          ...Object.values(state.runtime.connections).filter((item) => item.id !== connection.id),
          connection,
        ];
        return {
          runtime: touch({
            ...state.runtime,
            connections: normalizeRuntimeConnections(state.runtime.entities, connections),
          }),
        };
      }),
      removeConnection: (connectionId) => set((state) => {
        const { [connectionId]: _removedConnection, ...connections } = state.runtime.connections;
        return {
          runtime: touch({
            ...state.runtime,
            connections,
          }),
        };
      }),
      upsertCanvasViewNode: (node) => set((state) => ({
        runtime: touch({
          ...state.runtime,
          canvasView: {
            ...state.runtime.canvasView,
            nodes: {
              ...state.runtime.canvasView.nodes,
              [node.entityId]: node,
            },
          },
        }),
      })),
      upsertWorkflowViewNode: (node) => set((state) => ({
        runtime: touch({
          ...state.runtime,
          workflowView: {
            ...state.runtime.workflowView,
            nodes: {
              ...state.runtime.workflowView.nodes,
              [node.entityId]: node,
            },
          },
        }),
      })),
      setCanvasTechnicalOverlay: (enabled) => set((state) => ({
        runtime: touch({
          ...state.runtime,
          canvasView: {
            ...state.runtime.canvasView,
            showTechnicalEntities: enabled,
          },
        }),
      })),
    }),
    {
      name: RUNTIME_STORAGE_KEY,
      partialize: partializeRuntime,
      storage: createJSONStorage(() => safeRuntimeStorage),
    },
  ),
);
