import { NODE_DEFS } from '../components/nodeflow/defs';
import type { WorkflowEdge, WorkflowGroup, WorkflowNode, WorkflowViewport } from '../components/nodeflow/types';
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
    text: entity.name || NODE_DEFS[entity.kind as keyof typeof NODE_DEFS]?.title || entity.kind,
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

export function selectWorkflowGraph(runtime: UnifiedProjectRuntime): {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  groups: WorkflowGroup[];
  viewport: WorkflowViewport;
} {
  const nodes = Object.values(runtime.workflowView.nodes).flatMap((view) => {
    const entity = runtime.entities[view.entityId];
    if (!entity) return [];
    const node: WorkflowNode = {
      id: entity.id,
      kind: view.nodeKind as WorkflowNode['kind'],
      x: view.x,
      y: view.y,
      config: {
        label: entity.name,
        prompt: entity.promptPayload?.rawText,
        provider: entity.provider,
        model: entity.modelId,
        apiKeyRef: entity.apiKeyRef,
        aspectRatio: typeof entity.params?.aspectRatio === 'string' ? entity.params.aspectRatio : undefined,
        resolution: typeof entity.params?.resolution === 'string' ? entity.params.resolution : undefined,
        durationSec: typeof entity.params?.durationSec === 'number' ? entity.params.durationSec : undefined,
        generationMode: entity.params?.generationMode === 'image' || entity.params?.generationMode === 'video'
          ? entity.params.generationMode
          : undefined,
      },
    };
    return [node];
  });

  const edges = Object.values(runtime.connections)
    .filter((connection) => connection.kind === 'workflow_edge')
    .map((connection): WorkflowEdge => ({
      id: connection.id,
      fromNode: connection.sourceEntityId,
      fromPort: connection.sourcePort || 'output',
      toNode: connection.targetEntityId,
      toPort: connection.targetPort || 'input',
    }));

  const groups = Object.values(runtime.workflowView.groups).map((group): WorkflowGroup => ({
    id: group.id,
    title: group.title,
    x: group.x,
    y: group.y,
    width: group.width,
    height: group.height,
    nodeIds: [...group.entityIds],
  }));

  return {
    nodes,
    edges,
    groups,
    viewport: runtime.workflowView.viewport,
  };
}
