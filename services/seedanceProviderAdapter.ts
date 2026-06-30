import {
  downloadSeedanceVideoResult,
  pollSeedanceVideoTask,
  submitSeedanceVideoTask,
  type SeedanceVideoTaskHandle,
} from './aiGateway';
import type {
  ProviderAdapter,
  ProviderRequest,
  ProviderResult,
  ProviderTaskHandle,
  ProviderTaskPollResult,
  ProviderTaskSubmission,
} from './providerAdapter';

const SEEDANCE_POLL_INTERVAL_MS = 10_000;
const SEEDANCE_TIMEOUT_MS = 600_000;

function isSeedanceModel(modelId: string): boolean {
  return modelId.toLowerCase().includes('seedance');
}

function toSeedanceHandle(handle: ProviderTaskHandle): SeedanceVideoTaskHandle {
  const metadata = handle.metadata ?? {};
  return {
    providerId: 'volcengine',
    modelId: handle.modelId,
    taskId: handle.taskId,
    baseUrl: typeof metadata.baseUrl === 'string' ? metadata.baseUrl : '',
    createdAt: typeof metadata.createdAt === 'number' ? metadata.createdAt : Date.now(),
    metadata,
  };
}

function toProviderHandle(handle: SeedanceVideoTaskHandle): ProviderTaskHandle {
  return {
    providerId: 'volcengine',
    modelId: handle.modelId,
    taskId: handle.taskId,
    metadata: {
      ...(handle.metadata ?? {}),
      baseUrl: handle.baseUrl,
      createdAt: handle.createdAt,
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const seedanceProviderAdapter: ProviderAdapter = {
  id: 'volcengine',
  supportsTaskResume: true,
  supportsModel: isSeedanceModel,
  submitTask: async (request: ProviderRequest): Promise<ProviderTaskSubmission> => {
    const handle = await submitSeedanceVideoTask(request.prompt, request.modelId, request.apiKeyPayload, {
      aspectRatio: request.aspectRatio as ProviderRequest['aspectRatio'] & Parameters<typeof submitSeedanceVideoTask>[3]['aspectRatio'],
      slots: request.slots,
      durationSec: request.durationSec,
      resolution: request.resolution,
      seed: typeof request.extraParams?.seed === 'number' ? request.extraParams.seed : undefined,
      frames: typeof request.extraParams?.frames === 'number' ? request.extraParams.frames : undefined,
      cameraFixed: typeof request.extraParams?.cameraFixed === 'boolean' ? request.extraParams.cameraFixed : undefined,
      watermark: typeof request.extraParams?.watermark === 'boolean' ? request.extraParams.watermark : undefined,
      returnLastFrame: typeof request.extraParams?.returnLastFrame === 'boolean' ? request.extraParams.returnLastFrame : undefined,
      generateAudio: typeof request.extraParams?.generateAudio === 'boolean' ? request.extraParams.generateAudio : undefined,
      serviceTier: typeof request.extraParams?.serviceTier === 'string' ? request.extraParams.serviceTier : undefined,
      safetyIdentifier: typeof request.extraParams?.safetyIdentifier === 'string' ? request.extraParams.safetyIdentifier : undefined,
    });
    return { status: 'queued', handle: toProviderHandle(handle) };
  },
  pollTask: async (handle: ProviderTaskHandle): Promise<ProviderTaskPollResult> => {
    const result = await pollSeedanceVideoTask(toSeedanceHandle(handle));
    if (result.status === 'running') {
      return { status: 'running', message: result.remoteStatus, raw: result.raw };
    }
    if (result.status === 'failed') {
      return { status: 'failed', error: result.error, raw: result.raw };
    }
    return {
      status: 'succeeded',
      result: { mediaUrl: result.videoUrl, mimeType: 'video/mp4', raw: result.raw },
      raw: result.raw,
    };
  },
  // generate 是可选快捷路径：调用方（aiGateway）可优先走 generate 一步出结果，
  // 也可走 registry 的 submit + poll 分步流程。两者复用同一 submitTask/pollTask，无重复实现。
  generate: async (request: ProviderRequest): Promise<ProviderResult> => {
    const submitted = await seedanceProviderAdapter.submitTask(request);
    if (submitted.status === 'succeeded') return submitted.result;

    const startedAt = Date.now();
    while (Date.now() - startedAt <= SEEDANCE_TIMEOUT_MS) {
      await sleep(SEEDANCE_POLL_INTERVAL_MS);
      const result = await seedanceProviderAdapter.pollTask(submitted.handle);
      if (result.status === 'failed' || result.status === 'canceled' || result.status === 'not_found') {
        throw new Error(result.error);
      }
      if (result.status === 'succeeded') {
        if (result.result.mediaUrl) {
          const downloaded = await downloadSeedanceVideoResult(result.result.mediaUrl);
          return { ...result.result, mimeType: downloaded.mimeType };
        }
        return result.result;
      }
    }

    throw new Error('Seedance 视频生成超时（已等待超过 10 分钟）');
  },
};
