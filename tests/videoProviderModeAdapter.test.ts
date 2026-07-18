import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ generateVideos: vi.fn(), getVideosOperation: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateVideos: mocks.generateVideos };
    operations = { getVideosOperation: mocks.getVideosOperation };
  },
  Modality: { TEXT: 'TEXT', IMAGE: 'IMAGE' },
  GenerateContentResponse: class {},
  GenerateVideosOperation: class {},
  VideoGenerationReferenceType: { ASSET: 'asset' },
}));

import { generateVideoWithProvider } from '../services/aiGateway';

const key = {
  id: 'google-video', provider: 'google' as const, capabilities: ['video' as const], key: 'google-key',
  baseUrl: 'https://generativelanguage.googleapis.com', createdAt: 0, updatedAt: 0,
};

const binaryResponse = (value: string, type: string) => new Response(value, { status: 200, headers: { 'Content-Type': type } });

describe('Veo PromptBar mode adapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.generateVideos.mockReset().mockResolvedValue({
      done: true,
      response: { generatedVideos: [{ video: { uri: 'https://cdn.example.com/result.mp4' } }] },
    });
    mocks.getVideosOperation.mockReset();
  });

  it('turns Workflow blob references into Veo first and last frame bytes', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(binaryResponse('FIRST', 'image/png'))
      .mockResolvedValueOnce(binaryResponse('LAST', 'image/jpeg'))
      .mockResolvedValueOnce(binaryResponse('VIDEO', 'video/mp4'));

    await generateVideoWithProvider('平滑转场', 'veo-3.1-generate-preview', key, {
      generationSubmode: 'first-last-frame', durationSec: 8, resolution: '1080p',
      slots: [
        { kind: 'image', href: 'blob:first', mimeType: 'image/png' },
        { kind: 'image', href: 'blob:last', mimeType: 'image/jpeg' },
        { kind: 'image', href: 'blob:ignored', mimeType: 'image/png' },
      ],
    });

    expect(mocks.generateVideos).toHaveBeenCalledWith(expect.objectContaining({
      image: { imageBytes: btoa('FIRST'), mimeType: 'image/png' },
      config: expect.objectContaining({
        lastFrame: { imageBytes: btoa('LAST'), mimeType: 'image/jpeg' },
        referenceImages: [],
      }),
    }));
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('uses up to three images only as Veo referenceImages and never as a first frame', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(binaryResponse('A', 'image/png'))
      .mockResolvedValueOnce(binaryResponse('B', 'image/png'))
      .mockResolvedValueOnce(binaryResponse('C', 'image/png'))
      .mockResolvedValueOnce(binaryResponse('VIDEO', 'video/mp4'));

    await generateVideoWithProvider('保持主体一致', 'veo-3.1-fast-generate-preview', key, {
      generationSubmode: 'reference-to-video', durationSec: 8,
      slots: [
        { kind: 'image', href: 'https://cdn.example.com/a.png', mimeType: 'image/png' },
        { kind: 'image', href: 'https://cdn.example.com/b.png', mimeType: 'image/png' },
        { kind: 'image', href: 'https://cdn.example.com/c.png', mimeType: 'image/png' },
        { kind: 'video', href: 'https://cdn.example.com/ignored.mp4', mimeType: 'video/mp4' },
      ],
    });

    const request = mocks.generateVideos.mock.calls[0][0];
    expect(request.image).toBeUndefined();
    expect(request.config.lastFrame).toBeUndefined();
    expect(request.config.referenceImages).toHaveLength(3);
    expect(request.config.referenceImages[0]).toEqual({ image: { imageBytes: btoa('A'), mimeType: 'image/png' }, referenceType: 'asset' });
  });
});
