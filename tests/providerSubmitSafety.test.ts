/** @vitest-environment node */

// Real HTTP against the fake provider: a paid submit must never be repeated
// when its outcome is unknown, and a failed download must be retryable
// without a second submit.
import { afterEach, describe, expect, it } from 'vitest';
import { executeUnifiedIgnition } from '../services/aiGateway';
import { createFakeProviderServer } from '../scripts/fake-provider-server.mjs';
import type { UserApiKey } from '../types';

type FakeRequest = { method?: string; path: string };
type FakeServer = {
  listen: (port: number, host: string, cb: () => void) => void;
  once: (event: string, cb: (error: Error) => void) => void;
  address: () => { port: number } | string | null;
  close: (cb: () => void) => void;
  getState: () => { requests: FakeRequest[] };
  setMode: (mode: string) => void;
};

const servers: FakeServer[] = [];

async function startFakeProvider(mode: string) {
  const server = createFakeProviderServer({ mode }) as unknown as FakeServer;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fake provider did not expose a port');
  return { server, origin: 'http:' + '//' + '127.0.0.1:' + address.port };
}

function fakeKey(origin: string): UserApiKey {
  return {
    id: 'fake-key',
    provider: 'custom',
    capabilities: ['image', 'video'],
    key: 'fake-secret',
    baseUrl: origin + '/v1',
    models: [{ id: 'grok-imagine-video', name: 'Grok Imagine Video', capability: 'video' }],
    defaultModel: 'grok-imagine-video',
    createdAt: 1,
    updatedAt: 1,
  };
}

function videoInput(origin: string, extra: Record<string, unknown> = {}) {
  return {
    elementId: 'video-safety',
    prompt: '产品镜头平滑推进',
    modelId: 'grok-imagine-video',
    productModelId: 'flovart:grok-imagine-video',
    generationCapability: 'text-to-video' as const,
    generationSubmode: 'text-to-video' as const,
    apiKeyPayload: fakeKey(origin),
    ...extra,
  };
}

function submits(server: FakeServer) {
  return server.getState().requests.filter(request => request.method === 'POST' && /\/videos(\/generations)?$/.test(request.path));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('provider submit and download safety', () => {
  it('marks a lost submit response as unknown and never resubmits on another base URL', async () => {
    const { server, origin } = await startFakeProvider('submit_lost');
    const result = await executeUnifiedIgnition(videoInput(origin));
    expect(result).toMatchObject({ ok: false, submissionUnknown: true });
    expect(submits(server)).toHaveLength(1);
  });

  it('marks a submit response without task id as unknown', async () => {
    const { server, origin } = await startFakeProvider('submit_no_task_id');
    const result = await executeUnifiedIgnition(videoInput(origin));
    expect(result).toMatchObject({ ok: false, submissionUnknown: true });
    expect(submits(server)).toHaveLength(1);
  });

  it('does not retry a definite 429 rejection on another base URL', async () => {
    const { server, origin } = await startFakeProvider('rate_limit');
    const result = await executeUnifiedIgnition(videoInput(origin));
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty('submissionUnknown');
    expect(submits(server)).toHaveLength(1);
  });

  it('keeps the task id after a download failure and re-downloads without a second submit', async () => {
    const { server, origin } = await startFakeProvider('download_error');
    const first = await executeUnifiedIgnition(videoInput(origin));
    expect(first).toMatchObject({ ok: false, downloadPendingTaskId: 'fake-video-1' });
    expect(submits(server)).toHaveLength(1);

    server.setMode('success');
    const retry = await executeUnifiedIgnition(videoInput(origin, { resumeProviderTaskId: 'fake-video-1' }));
    expect(retry).toMatchObject({ ok: true, capability: 'video', mimeType: 'video/mp4' });
    expect(submits(server)).toHaveLength(1);
  });

  it('surfaces a poll failure after submit without resubmitting', async () => {
    const { server, origin } = await startFakeProvider('poll_error');
    const result = await executeUnifiedIgnition(videoInput(origin));
    expect(result.ok).toBe(false);
    expect(submits(server)).toHaveLength(1);
  });
});
