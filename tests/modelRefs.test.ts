import { describe, expect, it } from 'vitest';
import type { UserApiKey } from '../types';
import {
  buildCapabilityModelOptions,
  modelRefLabel,
  normalizeModelSelectionWithKeys,
  resolveModelSelection,
} from '../utils/modelRefs';

const makeKey = (patch: Partial<UserApiKey>): UserApiKey => ({
  id: patch.id || 'key-1',
  provider: patch.provider || 'custom',
  capabilities: patch.capabilities || ['image'],
  key: 'secret',
  baseUrl: patch.baseUrl,
  name: patch.name,
  isDefault: patch.isDefault,
  status: patch.status || 'ok',
  customModels: patch.customModels,
  defaultModel: patch.defaultModel,
  models: patch.models,
  routeBindings: patch.routeBindings,
  extraConfig: patch.extraConfig,
  createdAt: 1,
  updatedAt: 1,
});

describe('modelRefs', () => {
  it('builds key-owned options and resolves the selected key before provider calls', () => {
    const key = makeKey({
      id: 'volc-key',
      provider: 'volcengine',
      name: 'Seedance Ark',
      capabilities: ['video'],
      models: [{ id: 'dreamina-seedance-2-0-260128', name: 'Seedance 2' }],
      routeBindings: [{ productModelId: 'flovart:seedance-2', mode: 'text-to-video' as const, routeId: 'dreamina-seedance-2-0-260128', priority: 0, enabled: true, confirmed: true }],
    });

    const option = buildCapabilityModelOptions([key], 'video', [], '')[0];

    expect(option).toBe('flovart:seedance-2');
    expect(modelRefLabel(option, [key])).toBe('Seedance 2.0 · Seedance Ark');
    expect(resolveModelSelection(option, [key], 'video')).toMatchObject({
      routeId: 'dreamina-seedance-2-0-260128',
      provider: 'volcengine',
      key,
    });
  });

  it('does not silently bind a bare model when multiple keys expose the same model id', () => {
    const keys = [
      makeKey({ id: 'a', name: 'A', models: [{ id: 'shared-image', name: 'shared-image' }] }),
      makeKey({ id: 'b', name: 'B', models: [{ id: 'shared-image', name: 'shared-image' }] }),
    ];

    expect(normalizeModelSelectionWithKeys('shared-image', keys, 'image')).toBe('shared-image');
  });

  it('does not return a product route owned by another provider when a provider is requested', () => {
    const key = makeKey({
      id: 'custom-image',
      provider: 'custom',
      models: [{ id: 'gpt-image-2', name: 'GPT Image 2 proxy' }],
      routeBindings: [{ productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' as const, routeId: 'gpt-image-2', priority: 0, enabled: true, confirmed: true }],
    });

    expect(resolveModelSelection('flovart:gpt-image-2', [key], 'image', 'google')).toBeNull();
  });

  it('lists Doubao Seedance 2.0 as a video model owned by a Volcengine key', () => {
    const key = makeKey({
      id: 'volc-key',
      provider: 'volcengine',
      name: 'Seedance Ark',
      capabilities: ['video'],
      defaultModel: 'doubao-seedance-2.0',
      routeBindings: [{ productModelId: 'flovart:seedance-2', mode: 'text-to-video' as const, routeId: 'doubao-seedance-2.0', priority: 0, enabled: true, confirmed: true }],
    });

    const options = buildCapabilityModelOptions([key], 'video', [], '');

    expect(options).toContain('flovart:seedance-2');
    expect(resolveModelSelection(options[0], [key], 'video')).toMatchObject({
      routeId: 'doubao-seedance-2.0',
      provider: 'volcengine',
    });
  });
});
