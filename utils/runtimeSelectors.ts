import type {
  ArrowElement,
  Element,
  GroupElement,
  ImageElement,
  LineElement,
  PathElement,
  ShapeElement,
  TextElement,
  VideoElement,
} from '../types';
import type { RuntimeEntity, RuntimeEntityKind, UnifiedProjectRuntime } from '../types/runtime';

const VISUAL_KINDS = new Set<RuntimeEntityKind>([
  'image',
  'video',
  'text',
  'shape',
  'path',
  'arrow',
  'line',
  'group',
]);

function runtimeEntityToCanvasElement(entity: RuntimeEntity, view: UnifiedProjectRuntime['canvasView']['nodes'][string]): Element | null {
  const base = {
    id: entity.id,
    name: entity.name,
    x: view.x,
    y: view.y,
    isVisible: view.visible,
    isLocked: view.locked,
    parentId: view.parentId,
    generationState: entity.generationState,
  };

  if (entity.kind === 'image') {
    if (!entity.media) return null;
    return {
      ...base,
      type: 'image',
      href: entity.media.href,
      mimeType: entity.media.mimeType,
      width: view.width ?? entity.media.width ?? 320,
      height: view.height ?? entity.media.height ?? 180,
    } satisfies ImageElement;
  }

  if (entity.kind === 'video') {
    if (!entity.media) return null;
    return {
      ...base,
      type: 'video',
      href: entity.media.href,
      mimeType: entity.media.mimeType,
      poster: entity.media.posterHref,
      durationSec: entity.media.durationSec,
      width: view.width ?? entity.media.width ?? 320,
      height: view.height ?? entity.media.height ?? 180,
    } satisfies VideoElement;
  }

  if (entity.kind === 'text') {
    return {
      ...base,
      type: 'text',
      text: entity.promptPayload?.rawText || entity.name || '',
      fontSize: 18,
      fontColor: '#111827',
      width: view.width ?? 260,
      height: view.height ?? 120,
    } satisfies TextElement;
  }

  if (entity.kind === 'shape') {
    return {
      ...base,
      type: 'shape',
      shapeType: 'rectangle',
      width: view.width ?? 220,
      height: view.height ?? 140,
      strokeColor: '#94a3b8',
      strokeWidth: 1,
      fillColor: '#f8fafc',
    } satisfies ShapeElement;
  }

  if (entity.kind === 'path') {
    return { ...base, type: 'path', points: [], strokeColor: '#111827', strokeWidth: 2 } satisfies PathElement;
  }

  if (entity.kind === 'arrow') {
    return {
      ...base,
      type: 'arrow',
      points: [{ x: view.x, y: view.y }, { x: view.x + 120, y: view.y }],
      strokeColor: '#111827',
      strokeWidth: 2,
    } satisfies ArrowElement;
  }

  if (entity.kind === 'line') {
    return {
      ...base,
      type: 'line',
      points: [{ x: view.x, y: view.y }, { x: view.x + 120, y: view.y }],
      strokeColor: '#111827',
      strokeWidth: 2,
    } satisfies LineElement;
  }

  if (entity.kind === 'group') {
    return {
      ...base,
      type: 'group',
      width: view.width ?? 360,
      height: view.height ?? 240,
    } satisfies GroupElement;
  }

  return {
    ...base,
    type: 'text',
    text: entity.name || entity.kind,
    fontSize: 13,
    fontColor: '#334155',
    width: view.width ?? 220,
    height: view.height ?? 72,
  } satisfies TextElement;
}

export function selectCanvasElements(runtime: UnifiedProjectRuntime): Element[] {
  return Object.values(runtime.canvasView.nodes)
    .sort((a, b) => a.zIndex - b.zIndex)
    .flatMap((view) => {
      const entity = runtime.entities[view.entityId];
      if (!entity) return [];
      if (!VISUAL_KINDS.has(entity.kind) && !runtime.canvasView.showTechnicalEntities) return [];
      const element = runtimeEntityToCanvasElement(entity, view);
      return element ? [element] : [];
    });
}
