import type {
  AssetSlotRole,
  CanvasElement,
  Element,
  ElementGenerationState,
  GenerationMode,
  ResolvedReference,
} from '../types';
import { compilePromptReferences } from './semanticCompiler';
import { hydrateRawTextToTiptapJSON } from './htmlHydrator';

type ElementPromptStateInput = {
  currentState?: ElementGenerationState;
  target: CanvasElement;
  allElements: Element[];
  modelId: string;
  aspectRatio?: ElementGenerationState['aspectRatio'];
  rawText: string;
  richTextDocument?: Record<string, unknown>;
  status?: ElementGenerationState['status'];
  progress?: number;
  error?: string;
};

export type ElementIgnitionReference =
  | {
      type: 'image' | 'video';
      href: string;
      mimeType: string;
      slotRole: AssetSlotRole;
    }
  | {
      type: 'text' | 'shape';
      slotRole: AssetSlotRole;
    };

export function isPromptReferenceableElement(element: Element): element is CanvasElement {
  return element.type === 'image' || element.type === 'video' || element.type === 'text' || element.type === 'shape';
}

export function getElementGenerationMode(element: CanvasElement): GenerationMode {
  return element.type === 'video' ? 'video' : 'image';
}

export function createDefaultElementGenerationState(
  element: CanvasElement,
  modelId: string,
  aspectRatio?: ElementGenerationState['aspectRatio'],
): ElementGenerationState {
  return {
    promptPayload: element.generationState?.promptPayload || { rawText: '', resolvedReferences: [] },
    provider: element.generationState?.provider || 'openrouter',
    modelId: element.generationState?.modelId || modelId,
    aspectRatio: element.generationState?.aspectRatio || aspectRatio,
    status: element.generationState?.status || 'idle',
    error: element.generationState?.error,
    progress: element.generationState?.progress,
  };
}

export function buildElementPromptGenerationState({
  currentState,
  target,
  allElements,
  modelId,
  aspectRatio,
  rawText,
  richTextDocument,
  status,
  progress,
  error,
}: ElementPromptStateInput): ElementGenerationState {
  const base = currentState || createDefaultElementGenerationState(target, modelId, aspectRatio);
  const references = allElements.filter(isPromptReferenceableElement);
  const hydrated = richTextDocument ? undefined : hydrateRawTextToTiptapJSON(rawText, references);
  const promptPayload = compilePromptReferences(rawText, references);

  return {
    ...base,
    modelId: base.modelId || modelId,
    aspectRatio: base.aspectRatio || aspectRatio,
    status: status || base.status,
    error: error === undefined ? base.error : error,
    progress: progress ?? base.progress,
    promptPayload: {
      ...promptPayload,
      richTextDocument: richTextDocument || hydrated?.json,
    },
  };
}

export function buildElementIgnitionReferences(
  promptPayload: ElementGenerationState['promptPayload'],
  allElements: Element[],
): ElementIgnitionReference[] {
  return promptPayload.resolvedReferences
    .map((reference: ResolvedReference) => {
      const target = allElements.find((item) => item.id === reference.targetElementId);
      if (!target || !isPromptReferenceableElement(target)) return null;
      const slotRole = reference.slotRole || 'unassigned';

      if (target.type === 'image' || target.type === 'video') {
        return {
          type: target.type,
          href: target.href,
          mimeType: target.mimeType,
          slotRole,
        };
      }

      return { type: target.type, slotRole };
    })
    .filter((reference): reference is ElementIgnitionReference => reference !== null);
}
