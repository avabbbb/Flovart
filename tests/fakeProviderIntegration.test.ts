/** @vitest-environment node */

import { afterEach, describe, expect, it } from 'vitest';
import { executeUnifiedIgnition, validateApiKey } from '../services/aiGateway';
import { MODEL_DISCOVERY_TIMEOUT_MS, fetchModelsForProvider } from '../services/modelFetcher';
import { createFakeProviderServer } from '../scripts/fake-provider-server.mjs';
import type { UserApiKey } from '../types';

const servers: any[] = [];

async function startFakeProvider(options: Record<string, unknown> = {}) {
  const server: any = createFakeProviderServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fake provider did not expose a port');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function fakeKey(origin: string): UserApiKey {
  return {
    id: 'fake-key',
    provider: 'custom',
    capabilities: ['image', 'video'],
    key: 'fake-secret',
    baseUrl: `${origin}/v1`,
    models: [
      { id: 'gpt-image-2', name: 'GPT Image 2', capability: 'image' },
      { id: 'grok-imagine-video', name: 'Grok Imagine Video', capability: 'video' },
    ],
    defaultModel: 'gpt-image-2',
    createdAt: 1,
    updatedAt: 1,
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('fake provider real HTTP integration', () => {
  it('validates an OpenAI-compatible service and discovers image/video models', async () => {
    const { origin } = await startFakeProvider();
    const result = await validateApiKey('custom', 'fake-secret', `${origin}/v1`);

    expect(result).toMatchObject({ ok: true, endpointFlavor: 'openai-compatible', effectiveBaseUrl: `${origin}/v1` });
    expect(result.models?.map(model => model.id)).toEqual(['gpt-image-2', 'grok-imagine-video']);
    expect(result.capabilitySummary).toEqual(['image', 'video']);
  });

  it('carries text-to-image and image-to-image through real HTTP endpoints', async () => {
    const { server, origin } = await startFakeProvider();
    const key = fakeKey(origin);
    const textToImage = await executeUnifiedIgnition({
      elementId: 'image-t2i',
      prompt: '一只猫',
      modelId: 'gpt-image-2',
      productModelId: 'flovart:gpt-image-2',
      generationCapability: 'text-to-image',
      generationSubmode: 'text-to-image',
      apiKeyPayload: key,
    });
    const imageToImage = await executeUnifiedIgnition({
      elementId: 'image-i2i',
      prompt: '做成电影海报',
      modelId: 'gpt-image-2',
      productModelId: 'flovart:gpt-image-2',
      generationCapability: 'image-edit',
      generationSubmode: 'image-to-image',
      apiKeyPayload: key,
      references: [{ type: 'image', href: 'data:image/png;base64,QUJD', mimeType: 'image/png', slotRole: 'reference_image' }],
    });
    const imageToImageRemote = await executeUnifiedIgnition({
      elementId: 'image-i2i-remote',
      prompt: '把远程参考图做成电影海报',
      modelId: 'gpt-image-2',
      productModelId: 'flovart:gpt-image-2',
      generationCapability: 'image-edit',
      generationSubmode: 'image-to-image',
      apiKeyPayload: key,
      references: [{ type: 'image', href: `${origin}/fixtures/image.png`, mimeType: 'image/png', slotRole: 'reference_image' }],
    });

    expect(textToImage).toMatchObject({ ok: true, capability: 'image' });
    expect(imageToImage).toMatchObject({ ok: true, capability: 'image' });
    expect(imageToImageRemote).toMatchObject({ ok: true, capability: 'image' });
    expect(imageToImage.ok && imageToImage.mediaUrl).toMatch(/^data:image\//);
    const requests = server.getState().requests;
    expect(requests.some(request => request.path === '/v1/images/generations' && request.referenceCount === 0)).toBe(true);
    expect(requests.some(request => request.path === '/v1/images/edits' && request.referenceCount === 1)).toBe(true);
    expect(requests.some(request => request.path === '/fixtures/image.png' && request.bodyType === 'artifact-download')).toBe(true);
  });

  it('carries image-to-video through async create, poll, and content download', async () => {
    const { server, origin } = await startFakeProvider();
    const result = await executeUnifiedIgnition({
      elementId: 'video-i2v',
      prompt: '产品缓慢旋转',
      modelId: 'grok-imagine-video',
      productModelId: 'flovart:grok-imagine-video',
      generationCapability: 'image-to-video',
      generationSubmode: 'image-to-video',
      apiKeyPayload: fakeKey(origin),
      references: [{ type: 'image', href: 'data:image/png;base64,QUJD', mimeType: 'image/png', slotRole: 'first_frame' }],
    });

    expect(result).toMatchObject({ ok: true, capability: 'video', mimeType: 'video/mp4' });
    const requests = server.getState().requests;
    expect(requests.some(request => request.path === '/v2/videos/generations' && request.referenceCount === 1)).toBe(true);
    expect(requests.some(request => /\/v2\/videos\/generations\/fake-video-1$/.test(request.path))).toBe(true);
    expect(requests.some(request => /\/v1\/videos\/fake-video-1\/content$/.test(request.path))).toBe(true);
  });

  it('carries text-to-video through the same async provider path without references', async () => {
    const { server, origin } = await startFakeProvider();
    const result = await executeUnifiedIgnition({
      elementId: 'video-t2v',
      prompt: '产品镜头平滑推进',
      modelId: 'grok-imagine-video',
      productModelId: 'flovart:grok-imagine-video',
      generationCapability: 'text-to-video',
      generationSubmode: 'text-to-video',
      apiKeyPayload: fakeKey(origin),
    });

    expect(result).toMatchObject({ ok: true, capability: 'video', mimeType: 'video/mp4' });
    expect(server.getState().requests.some(request => request.path === '/v2/videos/generations' && request.referenceCount === 0)).toBe(true);
  });

  it('resumes an existing video task without submitting a second provider job', async () => {
    const { server, origin } = await startFakeProvider();
    const key = fakeKey(origin);
    const initialSubmit = await fetch(`${origin}/v2/videos/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fake-secret' },
      body: JSON.stringify({ model: 'grok-imagine-video', prompt: '已提交的任务', aspect_ratio: '16:9' }),
    });
    expect(initialSubmit.ok).toBe(true);
    const lifecycle: unknown[] = [];
    const result = await executeUnifiedIgnition({
      elementId: 'video-resume',
      prompt: '恢复已提交任务',
      modelId: 'grok-imagine-video',
      productModelId: 'flovart:grok-imagine-video',
      generationCapability: 'text-to-video',
      generationSubmode: 'text-to-video',
      apiKeyPayload: key,
      resumeProviderTaskId: 'fake-video-1',
      onProviderTaskLifecycle: event => { lifecycle.push(event); },
    });

    expect(result).toMatchObject({ ok: true, capability: 'video' });
    expect(server.getState().requests.filter(request => request.method === 'POST' && request.path === '/v2/videos/generations')).toHaveLength(1);
    expect(lifecycle).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'running', providerTaskId: 'fake-video-1', remoteStatus: '恢复任务轮询' })]));
  });

  it('ends a polling timeout with a readable failure instead of an endless spinner', async () => {
    const { server, origin } = await startFakeProvider({ mode: 'polling_timeout' });
    const result = await executeUnifiedIgnition({
      elementId: 'video-timeout',
      prompt: '等待超时的产品镜头',
      modelId: 'grok-imagine-video',
      productModelId: 'flovart:grok-imagine-video',
      generationCapability: 'text-to-video',
      generationSubmode: 'text-to-video',
      apiKeyPayload: fakeKey(origin),
      videoPollTimeoutMs: 50,
    });

    expect(result).toMatchObject({ ok: false, errorMessage: '视频生成超时，请稍后重试。' });
    expect(server.getState().requests.filter(request => /\/v2\/videos\/generations\/fake-video-1$/.test(request.path)).length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ['rate_limit', 'AI 服务当前限流，请稍后重试。'],
    ['provider_error', 'AI 服务暂时不可用，任务已失败，可稍后重试。'],
    ['malformed_response', 'AI 服务返回了无法识别的结果，任务已失败，可重试或检查服务配置。'],
  ] as const)('surfaces %s without a successful artifact', async (mode, expected) => {
    const { server, origin } = await startFakeProvider({ mode });
    const result = await executeUnifiedIgnition({
      elementId: `image-${mode}`,
      prompt: '一只猫',
      modelId: 'gpt-image-2',
      productModelId: 'flovart:gpt-image-2',
      generationCapability: 'text-to-image',
      generationSubmode: 'text-to-image',
      apiKeyPayload: fakeKey(origin),
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, errorMessage: expected });
    expect(server.getState().requests.some(request => request.path === '/v1/images/generations')).toBe(true);
  });

  it('keeps a service connectable when /models is unavailable for manual model entry', async () => {
    const { origin } = await startFakeProvider({ omitModelsEndpoint: true });
    const result = await validateApiKey('custom', 'fake-secret', `${origin}/v1`);

    expect(result).toMatchObject({ ok: true, modelDiscovery: 'unavailable', models: [] });
    expect(result.message).toContain('已验证');
  });

  it('turns a slow model discovery response into a bounded timeout', async () => {
    const { origin } = await startFakeProvider({ mode: 'timeout', timeoutDelayMs: MODEL_DISCOVERY_TIMEOUT_MS + 250 });
    const startedAt = Date.now();
    const result = await fetchModelsForProvider('custom', 'fake-secret', `${origin}/v1`);

    expect(result).toMatchObject({ ok: false, error: '连接超时，请检查服务地址后重试；未能判定 API Key 是否有效。', reason: 'network' });
    expect(Date.now() - startedAt).toBeLessThan(MODEL_DISCOVERY_TIMEOUT_MS + 2_000);
  }, MODEL_DISCOVERY_TIMEOUT_MS + 5_000);

  it('returns provider failures without leaking the credential into the recorder', async () => {
    const { server, origin } = await startFakeProvider({ mode: 'unauthorized' });
    const result = await executeUnifiedIgnition({
      elementId: 'image-fail',
      prompt: '一只猫',
      modelId: 'gpt-image-2',
      productModelId: 'flovart:gpt-image-2',
      generationCapability: 'text-to-image',
      generationSubmode: 'text-to-image',
      apiKeyPayload: fakeKey(origin),
    });

    expect(result).toMatchObject({ ok: false, errorMessage: 'API Key 无效或没有访问权限，请在 AI 服务设置中检查。' });
    expect(JSON.stringify(result)).not.toContain('fake-secret');
    expect(JSON.stringify(server.getState())).not.toContain('fake-secret');
  });
});
