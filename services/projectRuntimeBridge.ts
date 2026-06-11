import type { AssetLibrary, Element, ImageElement, VideoElement } from '../types';
import type { WorkflowEdge, WorkflowGroup, WorkflowNode, WorkflowViewport } from '../components/nodeflow/types';
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

interface WorkflowRuntimeSyncInput {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  groups: WorkflowGroup[];
  viewport: WorkflowViewport;
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

function runtimeKindFromNode(node: WorkflowNode): RuntimeEntityKind {
  return node.kind;
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

export function syncWorkflowGraphIntoRuntime(
  runtime: UnifiedProjectRuntime,
  input: WorkflowRuntimeSyncInput,
): UnifiedProjectRuntime {
  const now = input.now ?? Date.now();
  let entities = { ...runtime.entities };
  const workflowNodes: UnifiedProjectRuntime['workflowView']['nodes'] = {};

  input.nodes.forEach((node) => {
    const existing = entities[node.id];
    const promptText = node.config?.prompt ?? existing?.promptPayload?.rawText ?? '';
    entities = upsertRuntimeEntity(entities, {
      id: node.id,
      kind: runtimeKindFromNode(node),
      name: node.config?.label ?? existing?.name,
      media: existing?.media,
      promptPayload: {
        rawText: promptText,
        resolvedReferences: existing?.promptPayload?.resolvedReferences ?? [],
        richTextDocument: existing?.promptPayload?.richTextDocument,
      },
      generationState: existing?.generationState,
      provider: node.config?.provider ?? existing?.provider,
      modelId: node.config?.model ?? existing?.modelId,
      apiKeyRef: node.config?.apiKeyRef ?? existing?.apiKeyRef,
      params: {
        ...existing?.params,
        aspectRatio: node.config?.aspectRatio,
        resolution: node.config?.resolution,
        durationSec: node.config?.durationSec,
        generationMode: node.config?.generationMode,
        fps: node.config?.fps,
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });

    workflowNodes[node.id] = {
      entityId: node.id,
      nodeKind: runtimeKindFromNode(node),
      x: node.x,
      y: node.y,
    };
  });

  const nonWorkflowConnections = Object.values(runtime.connections).filter((connection) => connection.kind !== 'workflow_edge');
  const workflowConnections: RuntimeConnection[] = input.edges.map((edge) => ({
    id: edge.id,
    sourceEntityId: edge.fromNode,
    targetEntityId: edge.toNode,
    kind: 'workflow_edge',
    sourcePort: edge.fromPort,
    targetPort: edge.toPort,
    createdBy: 'workflow',
    createdAt: now,
  }));

  return {
    ...runtime,
    entities,
    connections: normalizeRuntimeConnections(entities, [...nonWorkflowConnections, ...workflowConnections]),
    workflowView: {
      nodes: workflowNodes,
      groups: Object.fromEntries(input.groups.map((group) => [
        group.id,
        {
          id: group.id,
          title: group.title,
          x: group.x,
          y: group.y,
          width: group.width,
          height: group.height,
          entityIds: group.nodeIds,
        },
      ])),
      viewport: input.viewport,
    },
    updatedAt: now,
  };
}
