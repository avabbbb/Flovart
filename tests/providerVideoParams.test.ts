/** @vitest-environment node */

// The plan card prices duration, resolution and audio; the provider must receive
// exactly those values over real HTTP, or the quote and the charge diverge.
import { afterEach, describe, expect, it } from 'vitest';
import { executeUnifiedIgnition } from '../services/aiGateway';
import { createFakeProviderServer } from '../scripts/fake-provider-server.mjs';
import type { UserApiKey } from '../types';

type FakeRequest = { method?: string; path: string; bodyKeys?: string[]; duration?: unknown; resolution?: string; aspectRatio?: string; referenceCount?: number; referenceRoles?: string[] };
type FakeServer = {
  listen: (port: number, host: string, cb: () => void) => void;
  once: (event: string, cb: (error: Error) => void) => void;
  address: () => { port: number } | string | null;
  close: (cb: () => void) => void;
  getState: () => { requests: FakeRequest[] };
};

const servers: FakeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('unified video submit parameters', () => {
  it('sends duration, resolution, audio and reference roles to the provider', async () => {
    const server = createFakeProviderServer({}) as unknown as FakeServer;
    const listening = Promise.withResolvers<void>();
    server.once('error', listening.reject);
    server.listen(0, '127.0.0.1', () => listening.resolve());
    await listening.promise;
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fake provider did not expose a port');
    const origin = 'http:' + '//' + '127.0.0.1:' + address.port;
    const key: UserApiKey = {
      id: 'fake-key',
      provider: 'custom',
      capabilities: ['video'],
      key: 'fake-secret',
      baseUrl: origin + '/v1',
      models: [{ id: 'grok-imagine-video', name: 'Grok Imagine Video', capability: 'video' }],
      defaultModel: 'grok-imagine-video',
      createdAt: 1,
      updatedAt: 1,
    };

    const result = await executeUnifiedIgnition({
      elementId: 'video-params',
      prompt: '产品缓慢旋转',
      modelId: 'grok-imagine-video',
      productModelId: 'flovart:grok-imagine-video',
      generationCapability: 'image-to-video',
      generationSubmode: 'image-to-video',
      apiKeyPayload: key,
      aspectRatio: '9:16',
      durationSec: 8,
      resolution: '1080p',
      generateAudio: true,
      references: [{ type: 'image', href: 'data:image/png;base64,QUJD', mimeType: 'image/png', slotRole: 'first_frame' }],
    } as Parameters<typeof executeUnifiedIgnition>[0]);

    expect(result).toMatchObject({ ok: true, capability: 'video' });
    const submit = server.getState().requests.find(request => request.method === 'POST' && request.path === '/v2/videos/generations');
    expect(submit).toMatchObject({ duration: 8, resolution: '1080p', aspectRatio: '9:16', referenceCount: 1, referenceRoles: ['first_frame'] });
    expect(submit?.bodyKeys).toEqual(expect.arrayContaining(['duration', 'resolution', 'reference_roles']));
    // grok-imagine-video declares audioControl: 'none' — an unsupported flag must not reach the provider.
    expect(submit?.bodyKeys).not.toContain('generate_audio');
  });
});
