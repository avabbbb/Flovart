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

/**
 * 用于 provider 实现幂等的失败重提：客户端在每次 submit 前生成一次 idempotency UUID
 * 并缓存内存；同一节点重试时把同一 key 写进 handle.metadata.idempotencyKey，
 * provider 据此决定是否复用上游任务或带相同 Idempotency-Key 头重新提交。
 */
export const PROVIDER_IDEMPOTENCY_KEY = 'idempotencyKey';

export interface ProviderCancelResult {
  /** true=上游已确认取消；false=不可取消或调用失败（参考 reason） */
  canceled: boolean;
  /** 'ok' | 'not_queued' | 'not_cancellable' | 'unsupported' | 'network_error' */
  reason: ProviderCancelReason;
  /** 上游任务可能仍在运行（cancel 不可达或已 processing），UI 用此提示用户 */
  upstreamStillRunning?: boolean;
  /** 失败时携带的原始错误信息（便于 toast/日志） */
  message?: string;
  raw?: unknown;
}

export type ProviderCancelReason = 'ok' | 'not_queued' | 'not_cancellable' | 'unsupported' | 'network_error';

/**
 * 终态使用量回填：用于在 cancelTask 之外查询上游真实计费字段。
 * - 接口默认可选；不实现的 adapter 视 capability 不支持账单回填。
 * - 支持 billing 字段的 provider（如 Scnet/Lemondata 网关）回传 amount+currency；
 * - 仅返回 tokens 但无 billing 的 provider（如 Volcengine 官方）只回传 totalTokens，
 *   调用方保留 `actualCost: undefined` + `billableState: 'unknown'`，不假装成 actual。
 */
export interface ProviderUsageResult {
  status: 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'unknown';
  amount?: number;
  currency?: string;
  totalTokens?: number;
  /** 终态原因/错误码：用于日志，不直接展示 */
  reason?: string;
  raw?: unknown;
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
  /**
   * 取消上游任务。仅在 adapter + 上游协议支持取消时实现：
   * - Seedance（Volcengine Ark 官方）：仅在 queued 阶段可取消；processing 阶段 NACK
   *   应返回 `{ canceled: false, reason: 'not_cancellable', upstreamStillRunning: true }`。
   * - Scnet 网关：pending/running 阶段均可取消。
   * - 不支持取消的 provider 不实现本方法（registry/UI 据此退回“放弃等待”路径）。
   *
   * 调用方在重试/取消流程中传入 `options.apiKey`（不能从 handle 拿，因为 handle 持久化到节点 metadata 时不能带 key）。
   */
  cancelTask?(handle: ProviderTaskHandle, options?: { reason?: string; apiKey?: UserApiKey; signal?: AbortSignal }): Promise<ProviderCancelResult>;
  /**
   * 在终态之外再次拉取上游 use/billing 数据，把 estimated 使用记录回填为 actual。
   * 调用方拿到返回后会：
   *   - 若 amount 存在 → `actualCost = amount`，`billableState = 'actual'`
   *   - 仅 totalTokens → `actualTokens = totalTokens`，`billableState` 保持 'unknown'
   *   - status 为 unknown → 不变更 usageRecord，仅记日志
   */
  reconcileUsage?(handle: ProviderTaskHandle, options?: { apiKey?: UserApiKey; signal?: AbortSignal }): Promise<ProviderUsageResult>;
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
