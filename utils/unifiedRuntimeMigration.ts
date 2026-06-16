import type {
  AssetLibrary,
  CanvasElement,
  Element,
  ImageElement,
  VideoElement,
} from '../types';
import type {
  RuntimeConnection,
  RuntimeEntity,
  RuntimeEntityKind,
  RuntimeMedia,
  UnifiedProjectRuntime,
} from '../types/runtime';
import { normalizeRuntimeConnections } from './runtimeConnectionNormalizer';

interface LegacyMigrationInput {
  projectId: string;
  canvasElements: Element[];
  assetLibrary: AssetLibrary;
  now?: number;
}

function isImageElement(element: Element): element is ImageElement {
  return element.type === 'image';
}

function isVideoElement(element: Element): element is VideoElement {
  return element.type === 'video';
}

function isCanvasElement(element: Element): element is CanvasElement {
  return element.type === 'image' || element.type === 'video' || element.type === 'text' || element.type === 'shape';
}

function mediaFromCanvasElement(element: Element): RuntimeMedia | undefined {
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

export function migrateLegacyStateToRuntime(input: LegacyMigrationInput): UnifiedProjectRuntime {
  const now = input.now ?? Date.now();
  const entities: Record<string, RuntimeEntity> = {};
  const connections: RuntimeConnection[] = [];
  const canvasView: UnifiedProjectRuntime['canvasView'] = {
    nodes: {},
    viewport: { x: 0, y: 0, zoom: 1 },
    showTechnicalEntities: false,
  };

  input.canvasElements.forEach((element, index) => {
    entities[element.id] = {
      id: element.id,
      kind: runtimeKindFromElement(element),
      name: element.name,
      media: mediaFromCanvasElement(element),
      promptPayload: isCanvasElement(element) ? element.generationState?.promptPayload : undefined,
      generationState: isCanvasElement(element) ? element.generationState : undefined,
      createdAt: now,
      updatedAt: now,
    };

    canvasView.nodes[element.id] = {
      entityId: element.id,
      x: element.x,
      y: element.y,
      width: 'width' in element ? element.width : undefined,
      height: 'height' in element ? element.height : undefined,
      rotation: 'rotation' in element && typeof element.rotation === 'number' ? element.rotation : 0,
      zIndex: index,
      visible: element.isVisible !== false,
      locked: element.isLocked,
      parentId: element.parentId,
    };
  });

  return {
    version: 1,
    projectId: input.projectId,
    entities,
    connections: normalizeRuntimeConnections(entities, connections),
    canvasView,
    jobs: {},
    assets: input.assetLibrary,
    settings: {},
    updatedAt: now,
  };
}
