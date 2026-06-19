import { describe, expect, it } from 'vitest';
import type { UserApiKey } from '../types';
import { getGenerationCapability } from '../services/generationCapabilities';

const key = (patch: Partial<UserApiKey>): UserApiKey => ({
  id: 'key-1',
  provider: 'openai',
  capabilities: ['image'],
  key: 'secret',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

describe('generation capabilities', () => {
  it('uses configured key models instead of a Workflow-specific model list', () => {
    const capability = getGenerationCapability([
      key({ customModels: ['gpt-image-2'] }),
      key({ id: 'broken', status: 'error', customModels: ['hidden-image-model'] }),
    ], 'image', 'gpt-image-2');

    expect(capability.models.some(model => model.includes('gpt-image-2'))).toBe(true);
    expect(capability.models.some(model => model.includes('hidden-image-model'))).toBe(false);
    expect(capability.supportsReferences).toContain('image');
  });

  it('exposes only controls supported by the selected model capability dictionary', () => {
    const capability = getGenerationCapability([
      key({ provider: 'volcengine', capabilities: ['video'], customModels: ['seedance-2.0'] }),
    ], 'video', 'seedance-2.0');

    expect(capability.resolutions).toContain('1080p');
    expect(capability.durations.length).toBeGreaterThan(0);
    expect(capability.supportsReferences).toEqual(expect.arrayContaining(['image', 'video']));
    expect(capability.supportsReferences).toContain('audio');
  });

  it('uses text models without media controls and disables unsupported audio generation', () => {
    const text = getGenerationCapability([key({ capabilities: ['text'], customModels: ['gpt-4.1-mini'] })], 'text', 'gpt-4.1-mini');
    expect(text.models.some(model => model.includes('gpt-4.1-mini'))).toBe(true);
    expect(text).toMatchObject({ aspectRatios: [], resolutions: [], durations: [], supportsReferences: [] });
    expect(getGenerationCapability([], 'audio')).toEqual({ mode: 'audio', models: [], aspectRatios: [], resolutions: [], durations: [], supportsReferences: [] });
  });
});
