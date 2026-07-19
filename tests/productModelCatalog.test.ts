import { describe, expect, it } from 'vitest';
import type { UserApiKey } from '../types';
import {
  getProductModels,
  getRoutedVideoModes,
  resolveProductModelRoute,
  sanitizeProductGenerationParams,
  suggestProductRouteMappings,
} from '../services/productModelCatalog';

const key = (id: string, priority = 0): UserApiKey => ({
  id,
  provider: 'volcengine',
  capabilities: ['video'],
  key: 'secret',
  models: [{ id: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0' }],
  routeMappings: [{ target: { kind: 'product-mode', productModelId: 'flovart:seedance-2', mode: 'text-to-video' as const }, routeId: 'doubao-seedance-2-0-260128', order: priority }],
  createdAt: 1,
  updatedAt: 1,
});

describe('fixed product model catalog', () => {
  it('keeps product cards stable instead of exposing fetched upstream ids', () => {
    expect(getProductModels('image').map(model => model.id)).toContain('flovart:gpt-image-2');
    expect(getProductModels('video').map(model => model.id)).toContain('flovart:seedance-2');
    expect(getProductModels('video').map(model => model.id)).toContain('flovart:veo-3.1-lite');
  });

  it('suggests exact official mappings and resolves the lowest-priority route', () => {
    expect(suggestProductRouteMappings(key('suggested'))).toContainEqual(expect.objectContaining({ target: expect.objectContaining({ productModelId: 'flovart:seedance-2' }) }));
    expect(resolveProductModelRoute('flovart:seedance-2', 'text-to-video', [key('backup', 10), key('primary', 0)])?.key.id).toBe('primary');
  });

  it('rejects mappings owned by a key without the product capability', () => {
    const textOnly: UserApiKey = { ...key('text-only'), capabilities: ['text'] };
    expect(resolveProductModelRoute('flovart:seedance-2', 'text-to-video', [textOnly])).toBeNull();
  });

  it('rejects a stale mapping when the provider model list no longer contains its upstream id', () => {
    const stale = {
      ...key('stale'),
      models: [{ id: 'another-video-model', name: 'Another video model' }],
      customModels: ['another-video-model'],
      defaultModel: 'another-video-model',
    };
    expect(resolveProductModelRoute('flovart:seedance-2', 'text-to-video', [stale])).toBeNull();
  });

  it('uses the default key as a stable tie-breaker for equal mapping priorities', () => {
    const secondary = { ...key('secondary'), isDefault: false };
    const primary = { ...key('default'), isDefault: true };
    expect(resolveProductModelRoute('flovart:seedance-2', 'text-to-video', [secondary, primary])?.key.id).toBe('default');
    expect(resolveProductModelRoute('flovart:seedance-2', 'text-to-video', [primary, secondary])?.key.id).toBe('default');
  });

  it('does not auto-map Google preview ids that have already shut down', () => {
    const googleKey: UserApiKey = { ...key('google'), provider: 'google', capabilities: ['image'], models: [{ id: 'gemini-3-pro-image-preview', name: 'Gemini preview' }] };
    expect(suggestProductRouteMappings(googleKey).some(mapping => mapping.target.kind === 'product-mode' && mapping.target.productModelId === 'flovart:gemini-3-pro-image')).toBe(false);
  });

  it('normalizes invalid params and applies Veo 4K/reference duration constraints', () => {
    expect(sanitizeProductGenerationParams('flovart:seedance-2-fast', { resolution: '1080p', durationSec: 7 }).resolution).toBe('720p');
    const veo = sanitizeProductGenerationParams('flovart:veo-3.1', { mode: 'reference-to-video', resolution: '4K', durationSec: 4, referenceCount: 1, generateAudio: false });
    expect(veo.durationSec).toBe(8);
    expect(veo.generateAudio).toBe(true);
  });

  it('keeps ordinary Veo image-to-video short while constraining reference and extension payloads', () => {
    expect(sanitizeProductGenerationParams('flovart:veo-3.1', {
      mode: 'image-to-video', resolution: '720p', durationSec: 4, referenceCount: 1,
    }).durationSec).toBe(4);
    expect(sanitizeProductGenerationParams('flovart:veo-3.1-fast', {
      mode: 'reference-to-video', resolution: '720p', durationSec: 4, referenceCount: 1,
    }).durationSec).toBe(8);
    expect(sanitizeProductGenerationParams('flovart:veo-3.1-fast', {
      mode: 'video-extension', resolution: '4K', durationSec: 4,
    })).toMatchObject({ resolution: '720p', durationSec: 8 });
  });

  it('exposes only Veo modes that are both documented and wired in Flovart', () => {
    const fast = getProductModels('video').find(model => model.id === 'flovart:veo-3.1-fast');
    const lite = getProductModels('video').find(model => model.id === 'flovart:veo-3.1-lite');
    expect(fast?.capabilities.modes).toEqual(expect.arrayContaining(['reference-to-video', 'first-last-frame']));
    expect(fast?.capabilities.modes).not.toContain('video-extension');
    expect(lite?.capabilities.modes).toContain('first-last-frame');
    expect(lite?.capabilities.modes).not.toEqual(expect.arrayContaining(['reference-to-video', 'video-extension']));
  });

  it('intersects fixed product capabilities with the actual mapped Provider adapter', () => {
    expect(getRoutedVideoModes('flovart:seedance-2', 'volcengine', 'doubao-seedance-2-0-260128')).toEqual([
      'text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame',
    ]);
    expect(getRoutedVideoModes('flovart:kling-video-3', 'keling', 'kling-video-3.0')).toEqual([
      'text-to-video', 'image-to-video',
    ]);
    expect(getRoutedVideoModes('flovart:kling-video-3-omni', 'runningHub', 'kling-video-o3-std/reference-to-video')).toEqual([
      'reference-to-video',
    ]);
  });
});
