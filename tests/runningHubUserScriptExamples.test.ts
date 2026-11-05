import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCanonicalGenerationInput,
  resolveWorkflowInputs,
  type CanonicalGenerationInput,
} from '../components/workflow/inputResolver';
import { createWorkflowNode } from '../components/workflow/constants';
import type { ProviderMaterializedReference } from '../services/providerGenerationAdapter';
import { parseUserScriptDefinition } from '../services/userScriptAuthoring';
import { UserScriptProviderAdapter } from '../services/userScriptProviderAdapter';

const RH = ['https:', '', 'www.' + 'runninghub' + '.cn'].join('/');
const CDN = ['https:', '', 'cdn.example.com'].join('/');
const credential = { referenceId: 'rh-key', read: () => 'rh-secret' };

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response;
}

function loadExample(name: string): UserScriptProviderAdapter {
  const text = fs.readFileSync(new URL('../examples/user-script-providers/' + name, import.meta.url), 'utf8');
  return new UserScriptProviderAdapter(parseUserScriptDefinition(text));
}

function canonicalImageEdit() {
  const source = createWorkflowNode('source', 'image', { x: 0, y: 0 }, { href: CDN + '/source.png', mimeType: 'image/png' });
  const target = createWorkflowNode('target', 'image', { x: 420, y: 0 }, {
    config: { mode: 'image', submode: 'image-to-image', modelId: 'seedream-v5-pro' },
  });
  const inputs = resolveWorkflowInputs(target, [source, target], [{ id: 'edge', fromNodeId: source.id, toNodeId: target.id }]);
  const input = buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: '换成图2角色', mode: 'image', submode: 'image-to-image' });
  const references: ProviderMaterializedReference[] = input.references.map(reference => ({
    resourceId: reference.resource.resourceId,
    type: 'image',
    href: CDN + '/source.png',
    mimeType: 'image/png',
    role: reference.role,
    order: reference.order,
  }));
  return { input, references };
}

function canonicalMultimodalVideo() {
  const input = {
    nodeId: 'video-target',
    capability: 'reference-to-video',
    prompt: '参考视频1的运镜，角色换成图1',
    parameters: { aspectRatio: '9:16', duration: '15', resolution: '720p' },
    textInputs: [],
    references: [
      { resource: { resourceId: 'img-1', kind: 'image', title: 'yayi', mimeType: 'image/png' }, role: 'character', order: 0 },
      { resource: { resourceId: 'vid-1', kind: 'video', title: 'silent', mimeType: 'video/mp4' }, role: 'source_video', order: 1 },
    ],
  } as unknown as CanonicalGenerationInput;
  const references: ProviderMaterializedReference[] = [
    { resourceId: 'img-1', type: 'image', href: CDN + '/yayi.png', mimeType: 'image/png', role: 'character', order: 0 },
    { resourceId: 'vid-1', type: 'video', href: CDN + '/silent.mp4', mimeType: 'video/mp4', role: 'source_video', order: 1 },
  ] as ProviderMaterializedReference[];
  return { input, references };
}

const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RunningHub user-script provider examples', () => {
  it('runs Seedream v5 Pro image edit through submit and the shared query endpoint', async () => {
    const adapter = loadExample('runninghub-seedream-v5-image-edit.json');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ taskId: 't-img', status: 'QUEUED', errorCode: '', errorMessage: '' }))
      .mockResolvedValueOnce(response({ taskId: 't-img', status: 'RUNNING' }))
      .mockResolvedValueOnce(response({ taskId: 't-img', status: 'SUCCESS', results: [{ url: CDN + '/out.png', outputType: 'png' }] }));
    const { input, references } = canonicalImageEdit();

    const result = await adapter.execute(input, references, { provider: 'custom', routeId: 'seedream-v5-pro' }, {
      fetch: fetchMock,
      credential,
      sleep: async () => undefined,
    });

    expect(result.result.mediaUrl).toBe(CDN + '/out.png');
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      RH + '/openapi/v2/seedream-v5-pro/image-to-image',
      RH + '/openapi/v2/query',
      RH + '/openapi/v2/query',
    ]);
    expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject({ prompt: '换成图2角色', imageUrls: [CDN + '/source.png'] });
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({ taskId: 't-img' });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer rh-secret' });
    expect(JSON.stringify(fetchMock.mock.calls.map(call => (call[1] as RequestInit).body))).not.toContain('rh-secret');
  });

  it('surfaces the RunningHub error message when the task fails', async () => {
    const adapter = loadExample('runninghub-seedream-v5-image-edit.json');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ taskId: 't-bad', status: 'QUEUED' }))
      .mockResolvedValueOnce(response({ taskId: 't-bad', status: 'FAILED', errorCode: '40310', errorMessage: '40310 model offline' }));
    const { input, references } = canonicalImageEdit();

    await expect(adapter.execute(input, references, { provider: 'custom', routeId: 'seedream-v5-pro' }, {
      fetch: fetchMock,
      credential,
      sleep: async () => undefined,
    })).rejects.toThrow('40310 model offline');
  });

  it('splits image and video references for SparkVideo 2.0 multimodal video', async () => {
    const adapter = loadExample('runninghub-sparkvideo-2-multimodal.json');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ taskId: 't-vid', status: 'QUEUED' }))
      .mockResolvedValueOnce(response({ taskId: 't-vid', status: 'SUCCESS', results: [{ url: CDN + '/out.mp4', outputType: 'mp4' }] }));
    const { input, references } = canonicalMultimodalVideo();

    const result = await adapter.execute(input, references, { provider: 'custom', routeId: 'sparkvideo-2.0' }, {
      fetch: fetchMock,
      credential,
      sleep: async () => undefined,
    });

    expect(result.result).toMatchObject({ mediaUrl: CDN + '/out.mp4', mimeType: 'video/mp4' });
    expect(fetchMock.mock.calls[0][0]).toBe(RH + '/openapi/v2/rhart-video/sparkvideo-2.0/multimodal-video');
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({
      prompt: '参考视频1的运镜，角色换成图1',
      imageUrls: [CDN + '/yayi.png'],
      videoUrls: [CDN + '/silent.mp4'],
      ratio: '9:16',
      duration: '15',
      resolution: '720p',
      generateAudio: false,
    });
  });
});
