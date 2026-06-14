import type {
  AdaptivePromptPayload,
  ElementGenerationState,
  ResolvedReference,
} from '../../types';
import type {
  RuntimeConnection,
  RuntimeEntity,
  UnifiedProjectRuntime,
} from '../../types/runtime';
import { normalizeRuntimeConnections } from '../../utils/runtimeConnectionNormalizer';

export interface PromptComposerTarget {
  entity: RuntimeEntity;
  mode: 'image' | 'video' | 'text';
  status: ElementGenerationState['status'];
  progress?: number;
  availableReferences: RuntimeEntity[];
  connections: RuntimeConnection[];
}

const mentionRegex = /@([a-zA-Z0-9_\u4e00-\u9fa5-]+)/g;

function inferMode(entity: RuntimeEntity): PromptComposerTarget['mode'] {
  if (entity.kind === 'video' || entity.kind === 'videoGen' || entity.kind === 'videoEdit') return 'video';
  if (entity.kind === 'text' || entity.kind === 'prompt' || entity.kind === 'llm' || entity.kind === 'template') return 'text';
  return 'image';
}

function inferReferenceType(entity: RuntimeEntity): ResolvedReference['targetType'] {
  if (entity.media?.kind === 'image' || entity.kind === 'image' || entity.kind === 'imageGen') return 'image';
  if (entity.media?.kind === 'video' || entity.kind === 'video' || entity.kind === 'videoGen') return 'video';
  return 'text';
}

function connectionId(sourceEntityId: string, targetEntityId: string): string {
  return `prompt_${sourceEntityId}_${targetEntityId}`;
}

function compileRuntimeMentions(rawText: string, entities: RuntimeEntity[], targetEntityId: string): {
  payload: AdaptivePromptPayload;
  mentionedEntityIds: Set<string>;
} {
  const mentionedEntityIds = new Set<string>();
  const resolvedReferences: ResolvedReference[] = [];

  for (const match of rawText.matchAll(mentionRegex)) {
    const token = match[0];
    const name = match[1].trim();
    const target = entities.find((entity) => entity.id !== targetEntityId && entity.name?.trim() === name);
    if (!target || mentionedEntityIds.has(target.id)) continue;
    mentionedEntityIds.add(target.id);
    resolvedReferences.push({
      token,
      targetElementId: target.id,
      targetType: inferReferenceType(target),
    });
  }

  return {
    payload: { rawText, resolvedReferences },
    mentionedEntityIds,
  };
}

export function createRuntimePromptTarget(runtime: UnifiedProjectRuntime, entityId: string): PromptComposerTarget {
  const entity = runtime.entities[entityId];
  if (!entity) {
    throw new Error(`Runtime entity not found: ${entityId}`);
  }

  const connections = Object.values(runtime.connections).filter((connection) => (
    connection.targetEntityId === entityId
  ));

  return {
    entity,
    mode: inferMode(entity),
    status: entity.generationState?.status || 'idle',
    progress: entity.generationState?.progress,
    availableReferences: Object.values(runtime.entities).filter((item) => item.id !== entityId),
    connections,
  };
}

export function applyPromptTextToRuntime(
  runtime: UnifiedProjectRuntime,
  entityId: string,
  rawText: string,
  now = Date.now(),
): UnifiedProjectRuntime {
  const entity = runtime.entities[entityId];
  if (!entity) {
    throw new Error(`Runtime entity not found: ${entityId}`);
  }

  const allEntities = Object.values(runtime.entities);
  const { payload, mentionedEntityIds } = compileRuntimeMentions(rawText, allEntities, entityId);
  const retainedConnections = Object.values(runtime.connections).filter((connection) => (
    connection.kind !== 'prompt_reference'
    || connection.targetEntityId !== entityId
    || connection.createdBy !== 'prompt'
  ));
  const promptConnections: RuntimeConnection[] = [...mentionedEntityIds].map((sourceEntityId) => ({
    id: connectionId(sourceEntityId, entityId),
    sourceEntityId,
    targetEntityId: entityId,
    kind: 'prompt_reference',
    role: 'reference',
    createdBy: 'prompt',
    createdAt: now,
  }));

  return {
    ...runtime,
    entities: {
      ...runtime.entities,
      [entityId]: {
        ...entity,
        promptPayload: {
          ...payload,
          richTextDocument: entity.promptPayload?.richTextDocument,
        },
        generationState: entity.generationState
          ? {
              ...entity.generationState,
              promptPayload: {
                ...payload,
                richTextDocument: entity.generationState.promptPayload.richTextDocument,
              },
            }
          : entity.generationState,
        updatedAt: now,
      },
    },
    connections: normalizeRuntimeConnections(runtime.entities, [...retainedConnections, ...promptConnections]),
    updatedAt: now,
  };
}
