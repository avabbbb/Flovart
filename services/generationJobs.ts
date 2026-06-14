import type { AdaptivePromptPayload } from '../types';
import type { ProviderTaskHandle, ProviderTaskStatus } from './providerAdapter';

export interface GenerationJobRecord {
  id: string;
  elementId?: string;
  status: ProviderTaskStatus;
  providerId: string;
  modelId: string;
  handle?: ProviderTaskHandle;
  promptPayload?: AdaptivePromptPayload;
  progress?: number;
  message?: string;
  resultUrl?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface GenerationJobPatch {
  status?: ProviderTaskStatus;
  handle?: ProviderTaskHandle;
  promptPayload?: AdaptivePromptPayload;
  progress?: number;
  message?: string;
  resultUrl?: string;
  error?: string;
}

export function createGenerationJob(input: {
  id: string;
  providerId: string;
  modelId: string;
  elementId?: string;
  handle?: ProviderTaskHandle;
  promptPayload?: AdaptivePromptPayload;
  now?: number;
}): GenerationJobRecord {
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    elementId: input.elementId,
    status: input.handle ? 'queued' : 'running',
    providerId: input.providerId,
    modelId: input.modelId,
    handle: input.handle,
    promptPayload: input.promptPayload,
    createdAt: now,
    updatedAt: now,
  };
}

export function patchGenerationJob(
  job: GenerationJobRecord,
  patch: GenerationJobPatch,
  now = Date.now(),
): GenerationJobRecord {
  return {
    ...job,
    ...patch,
    updatedAt: now,
  };
}

export function isGenerationJobActive(job: Pick<GenerationJobRecord, 'status'>): boolean {
  return job.status === 'queued' || job.status === 'running';
}
