import type {
  AssetSlotRole,
  CanvasElement,
  ChatAttachment,
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
      type: 'image' | 'video' | 'audio';
      href: string;
      mimeType: string;
      slotRole: AssetSlotRole;
      label?: string;
      sourceName?: string;
      elementId?: string;
    }
  | {
      type: 'text' | 'shape';
      slotRole: AssetSlotRole;
      label?: string;
      sourceName?: string;
      text?: string;
      elementId?: string;
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
    durationSec: element.generationState?.durationSec,
    resolution: element.generationState?.resolution,
    generateAudio: element.generationState?.generateAudio,
    watermark: element.generationState?.watermark,
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
  const promptPayload = mergeStructuredMentionsWithTextReferences(
    rawText,
    richTextDocument,
    references,
  );

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

type RichMention = {
  id: string;
  label?: string;
};

function extractRichMentions(document?: Record<string, unknown>): RichMention[] {
  const mentions: RichMention[] = [];
  if (!document) return mentions;

  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return;
    const item = node as { type?: unknown; attrs?: unknown; content?: unknown };
    if (item.type === 'canvasMention' && item.attrs && typeof item.attrs === 'object') {
      const attrs = item.attrs as { id?: unknown; label?: unknown };
      if (typeof attrs.id === 'string' && attrs.id.trim()) {
        mentions.push({
          id: attrs.id,
          label: typeof attrs.label === 'string' ? attrs.label : undefined,
        });
      }
    }
    if (Array.isArray(item.content)) {
      item.content.forEach(walk);
    }
  }

  walk(document);
  return mentions;
}

function getElementReferenceType(element: CanvasElement): ResolvedReference['targetType'] {
  if (element.type === 'image') return 'image';
  if (element.type === 'video') return 'video';
  return 'text';
}

function mergeStructuredMentionsWithTextReferences(
  rawText: string,
  richTextDocument: Record<string, unknown> | undefined,
  allElements: CanvasElement[],
): ElementGenerationState['promptPayload'] {
  const fallbackPayload = compilePromptReferences(rawText, allElements);
  const richMentions = extractRichMentions(richTextDocument);
  if (richMentions.length === 0) return fallbackPayload;

  const seenIds = new Set<string>();
  const seenTokens = new Set<string>();
  const structuredReferences = richMentions
    .map((mention): ResolvedReference | null => {
      if (seenIds.has(mention.id)) return null;
      seenIds.add(mention.id);
      const target = allElements.find(element => element.id === mention.id);
      if (!target) return null;
      const label = mention.label?.trim() || target.name?.trim() || target.id;
      const token = `@${label}`;
      seenTokens.add(token);
      return {
        token,
        targetElementId: target.id,
        targetType: getElementReferenceType(target),
      };
    })
    .filter((reference): reference is ResolvedReference => reference !== null);

  return {
    ...fallbackPayload,
    resolvedReferences: [
      ...structuredReferences,
      ...fallbackPayload.resolvedReferences.filter(
        reference => !seenIds.has(reference.targetElementId) && !seenTokens.has(reference.token),
      ),
    ],
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
      const sourceName = target.name?.trim() || target.id;
      const label = reference.token?.replace(/^@/, '').trim() || sourceName;

      if (target.type === 'image' || target.type === 'video') {
        return {
          type: target.type,
          href: target.href,
          mimeType: target.mimeType,
          slotRole,
          label,
          sourceName,
          elementId: target.id,
        };
      }

      return {
        type: target.type,
        slotRole,
        label,
        sourceName,
        text: target.type === 'text'
          ? target.text
          : target.type === 'shape'
            ? `${target.shapeType} shape, fill ${target.fillColor}, stroke ${target.strokeColor}`
            : undefined,
        elementId: target.id,
      };
    })
    .filter((reference): reference is ElementIgnitionReference => reference !== null);
}

function getAttachmentReferenceType(mimeType: string): 'image' | 'video' | 'audio' | null {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return null;
}

function getAttachmentSlotRole(type: 'image' | 'video' | 'audio'): AssetSlotRole {
  if (type === 'image') return 'reference_image';
  if (type === 'video') return 'reference_video';
  return 'reference_audio';
}

export async function buildAttachmentIgnitionReferences(
  attachments: ChatAttachment[],
  resolveHref?: (href: string) => Promise<string>,
): Promise<ElementIgnitionReference[]> {
  const references = await Promise.all(
    attachments.map(async (attachment): Promise<ElementIgnitionReference | null> => {
      const type = getAttachmentReferenceType(attachment.mimeType);
      if (!type) return null;
      const href = resolveHref ? await resolveHref(attachment.href) : attachment.href;
      return {
        type,
        href,
        mimeType: attachment.mimeType,
        slotRole: getAttachmentSlotRole(type),
        label: attachment.name,
        sourceName: attachment.name,
        elementId: attachment.id,
      };
    }),
  );

  return references.filter((reference): reference is ElementIgnitionReference => reference !== null);
}
