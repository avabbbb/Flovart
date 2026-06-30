import type { AIProvider } from '../types';
import type { UserApiKey } from '../types';
import type { MultimodalSlot } from './aiGateway';

export type ProviderTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'not_found';

export interface ProviderTaskHandle {
  providerId: AIProvider | string;
  modelId: string;
  taskId: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderRequest {
  prompt: string;
  modelId: string;
  providerId: AIProvider | string;
  apiKeyPayload?: UserApiKey;
  mode: 'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video' | 'video-to-video' | 'text';
  aspectRatio?: string;
  resolution?: string;
  durationSec?: number;
  slots?: MultimodalSlot[];
  extraParams?: Record<string, unknown>;
}

export interface ProviderResult {
  mediaUrl?: string;
  mimeType?: string;
  text?: string;
  raw?: unknown;
}

export type ProviderTaskSubmission =
  | { status: 'succeeded'; result: ProviderResult }
  | { status: 'queued'; handle: ProviderTaskHandle };

export type ProviderTaskPollResult =
  | { status: 'queued' | 'running'; progress?: number; message?: string; raw?: unknown }
  | { status: 'succeeded'; result: ProviderResult; raw?: unknown }
  | { status: 'failed' | 'canceled' | 'not_found'; error: string; raw?: unknown };

export interface ProviderAdapter {
  id: AIProvider | string;
  supportsModel(modelId: string): boolean;
  supportsTaskResume?: boolean;
  submitTask(request: ProviderRequest): Promise<ProviderTaskSubmission>;
  pollTask(handle: ProviderTaskHandle): Promise<ProviderTaskPollResult>;
  generate?: (request: ProviderRequest) => Promise<ProviderResult>;
}

export class ProviderAdapterRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(providerId: string): ProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  resolve(modelId: string, providerId?: string): ProviderAdapter | undefined {
    if (providerId) {
      const direct = this.adapters.get(providerId);
      if (direct?.supportsModel(modelId)) return direct;
    }
    // 无 explicit providerId 时按适配器注册顺序匹配首个 supportsModel 的。
    // ES2015+ Map 按插入顺序迭代（规范保证），且每个 modelId 通常只被一个 provider 支持，故无歧义。
    return [...this.adapters.values()].find((adapter) => adapter.supportsModel(modelId));
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }
}

export const providerAdapterRegistry = new ProviderAdapterRegistry();
