import type { AdaptivePromptPayload, CanvasElement, ResolvedReference } from '../types';
import type { MultimodalSlot, MultimodalSlotRole } from '../services/aiGateway';
import { compilePromptReferences } from './semanticCompiler';

export interface GraphInputReference {
  elementId: string;
  role?: MultimodalSlotRole | string;
}

export interface BuildPromptPayloadInput {
  rawText: string;
  elements: CanvasElement[];
  graphInputs?: GraphInputReference[];
  slotRoles?: Record<string, MultimodalSlotRole | string>;
}

function inferReferenceType(element: CanvasElement): ResolvedReference['targetType'] {
  if (element.type === 'image') return 'image';
  if (element.type === 'video') return 'video';
  return 'text';
}

export function buildPromptPayload(input: BuildPromptPayloadInput): AdaptivePromptPayload {
  const compiled = compilePromptReferences(input.rawText, input.elements);
  const byElementId = new Map<string, ResolvedReference>();

  for (const reference of compiled.resolvedReferences) {
    byElementId.set(reference.targetElementId, reference);
  }

  for (const graphInput of input.graphInputs ?? []) {
    const element = input.elements.find((item) => item.id === graphInput.elementId);
    if (!element || byElementId.has(element.id)) continue;
    byElementId.set(element.id, {
      token: element.name?.trim() ? `@${element.name.trim()}` : `@${element.id}`,
      targetElementId: element.id,
      targetType: inferReferenceType(element),
      slotRole: graphInput.role ?? input.slotRoles?.[element.id],
    });
  }

  return {
    rawText: input.rawText,
    resolvedReferences: [...byElementId.values()],
    richTextDocument: compiled.richTextDocument,
  };
}

export function resolvePromptMultimodalSlots(
  payload: AdaptivePromptPayload,
  elements: CanvasElement[],
): MultimodalSlot[] {
  const elementById = new Map(elements.map((element) => [element.id, element] as const));
  return payload.resolvedReferences.flatMap((reference) => {
    const element = elementById.get(reference.targetElementId);
    if (!element || (element.type !== 'image' && element.type !== 'video')) return [];
    return [{
      kind: element.type,
      href: element.href,
      mimeType: element.mimeType,
      role: reference.slotRole ?? (element.type === 'image' ? 'reference_image' : 'reference_video'),
      label: element.name,
    } satisfies MultimodalSlot];
  });
}
