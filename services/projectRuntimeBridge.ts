import type { AssetLibrary, Element, ImageElement, VideoElement } from '../types';
import type {
  RuntimeConnection,
  RuntimeEntity,
  RuntimeEntityKind,
  RuntimeMedia,
  UnifiedProjectRuntime,
} from '../types/runtime';
import { normalizeRuntimeConnections } from '../utils/runtimeConnectionNormalizer';

interface CanvasRuntimeSyncInput {
  projectId: string;
  canvasElements: Element[];
  assetLibrary: AssetLibrary;
  viewport: { x: number; y: number; zoom: number };
  now?: number;
}

function isImageElement(element: Element): element is ImageElement {
  return element.type === 'image';
}

function isVideoElement(element: Element): element is VideoElement {
  return element.type === 'video';
}

function mediaFromElement(element: Element): RuntimeMedia | undefined {
  if (isImageElement(element)) {
    return {
      kind: 'image',
      href: element.href,
      mimeType: element.mimeType,
      width: element.width,
      height: element.height,
    };
  }

  if (isVideoElement(element)) {
    return {
      kind: 'video',
      href: element.href,
      mimeType: element.mimeType,
      width: element.width,
      height: element.height,
      posterHref: element.poster,
      durationSec: element.durationSec,
    };
  }

  return undefined;
}

function runtimeKindFromElement(element: Element): RuntimeEntityKind {
  return element.type;
}

function upsertRuntimeEntity(
  entities: Record<string, RuntimeEntity>,
  entity: RuntimeEntity,
): Record<string, RuntimeEntity> {
  return {
    ...entities,
    [entity.id]: {
      ...entities[entity.id],
      ...entity,
      createdAt: entities[entity.id]?.createdAt ?? entity.createdAt,
    },
  };
}

export function syncCanvasElementsIntoRuntime(
  runtime: UnifiedProjectRuntime,
  input: CanvasRuntimeSyncInput,
): UnifiedProjectRuntime {
  const now = input.now ?? Date.now();
  let entities = { ...runtime.entities };
  const canvasNodes: UnifiedProjectRuntime['canvasView']['nodes'] = {};

  input.canvasElements.forEach((element, index) => {
    const existing = entities[element.id];
    entities = upsertRuntimeEntity(entities, {
      id: element.id,
      kind: runtimeKindFromElement(element),
      name: element.name ?? existing?.name,
      media: mediaFromElement(element) ?? existing?.media,
      promptPayload: 'generationState' in element ? element.generationState?.promptPayload ?? existing?.promptPayload : existing?.promptPayload,
      generationState: 'generationState' in element ? element.generationState ?? existing?.generationState : existing?.generationState,
      provider: existing?.provider,
      modelId: existing?.modelId,
      apiKeyRef: existing?.apiKeyRef,
      params: existing?.params,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    canvasNodes[element.id] = {
      entityId: element.id,
      x: element.x,
      y: element.y,
      width: 'width' in element ? element.width : undefined,
      height: 'height' in element ? element.height : undefined,
      zIndex: index,
      visible: element.isVisible !== false,
      locked: element.isLocked,
      parentId: element.parentId,
    };
  });

  return {
    ...runtime,
    projectId: input.projectId,
    entities,
    connections: normalizeRuntimeConnections(entities, Object.values(runtime.connections)),
    canvasView: {
      ...runtime.canvasView,
      nodes: canvasNodes,
      viewport: input.viewport,
    },
    assets: input.assetLibrary,
    updatedAt: now,
  };
}
