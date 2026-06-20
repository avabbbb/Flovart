import type { AssetSlotRole } from '../types';
import type { MultimodalSlot } from './aiGateway';
import type { WorkflowCommandEnvelope, WorkflowCommandResult } from './workflowDispatcher';

type MaybePromise<T> = T | Promise<T>;

export interface RuntimeCommandError {
  code?: string;
  message?: string;
}

export interface RuntimeCommandResult {
  ok?: boolean;
  id?: string;
  jobId?: string;
  error?: RuntimeCommandError | string;
  [key: string]: unknown;
}

export interface FlovartRuntimeApi {
  workflow?: {
    dispatch?: (envelope: WorkflowCommandEnvelope) => MaybePromise<WorkflowCommandResult>;
  };
  generate?: {
    image?: (input: { prompt: string; name?: string }) => MaybePromise<RuntimeCommandResult>;
    video?: (input: {
      prompt: string;
      sourceImageIds?: string[];
      sourceVideoIds?: string[];
      slots?: MultimodalSlot[];
      durationSec?: number;
      aspectRatio?: string;
      resolution?: string;
      seed?: number;
    }) => MaybePromise<RuntimeCommandResult>;
  };
  element?: {
    create?: (input: {
      id?: string;
      type: 'image' | 'video' | 'text';
      name: string;
      x: number;
      y: number;
      width?: number;
      height?: number;
      href?: string;
      mimeType?: string;
    }) => MaybePromise<RuntimeCommandResult>;
    updatePrompt?: (input: {
      elementId: string;
      textPrompt: string;
      modelId?: string;
    }) => MaybePromise<RuntimeCommandResult>;
    assignSlot?: (input: {
      elementId: string;
      targetElementId: string;
      slotRole: AssetSlotRole;
    }) => MaybePromise<RuntimeCommandResult>;
    ignite?: (input: { elementId: string }) => MaybePromise<RuntimeCommandResult>;
  };
}

type FlovartWindow = Window & typeof globalThis & {
  __flovartAPI?: FlovartRuntimeApi;
};

export function getFlovartRuntimeApi(): FlovartRuntimeApi | null {
  if (typeof window === 'undefined') return null;
  return ((window as FlovartWindow).__flovartAPI) || null;
}

export function getRuntimeErrorMessage(result: RuntimeCommandResult | null | undefined, fallback: string): string {
  const error = result?.error;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
