import { describe, expect, it } from 'vitest';
import { resolveRouteMapping, resolveRouteMappingForSubmit } from '../services/routeMapping';
import type { UserApiKey } from '../types';

const textKey: UserApiKey = {
  id: 'text-primary',
  provider: 'google',
  capabilities: ['text'],
  key: 'secret',
  models: [{ id: 'gemini-3-flash', name: 'Gemini 3 Flash' }],
  routeMappings: [{
    target: { kind: 'runtime-capability', capability: 'prompt-enhancement' },
    routeId: 'gemini-3-flash',
    order: 0,
  }],
  createdAt: 1,
  updatedAt: 1,
};

describe('route mapping', () => {
  it('resolves a runtime capability only from its explicit mapping', () => {
    expect(resolveRouteMapping(
      { kind: 'runtime-capability', capability: 'prompt-enhancement' },
      [textKey],
    )).toMatchObject({
      status: 'ready',
      routeId: 'gemini-3-flash',
      key: { id: 'text-primary' },
    });
  });

  it('requires confirmation before using a healthy backup route', () => {
    const failedPrimary: UserApiKey = { ...textKey, status: 'error' };
    const backup: UserApiKey = {
      ...textKey,
      id: 'text-backup',
      provider: 'openrouter',
      models: [{ id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' }],
      routeMappings: [{
        target: { kind: 'runtime-capability', capability: 'prompt-enhancement' },
        routeId: 'anthropic/claude-sonnet-4.5',
        order: 1,
      }],
    };

    expect(resolveRouteMapping(
      { kind: 'runtime-capability', capability: 'prompt-enhancement' },
      [backup, failedPrimary],
    )).toMatchObject({
      status: 'confirmation-required',
      routeId: 'anthropic/claude-sonnet-4.5',
      key: { id: 'text-backup' },
      unavailablePrimary: { key: { id: 'text-primary' } },
    });
  });

  it('resolves a media route from the exact product model and generation mode', () => {
    const imageKey: UserApiKey = {
      ...textKey,
      id: 'image-primary',
      provider: 'openai',
      capabilities: ['image'],
      models: [{ id: 'gpt-image-2', name: 'GPT Image 2' }],
      routeMappings: [{
        target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'image-to-image' },
        routeId: 'gpt-image-2',
        order: 0,
      }],
    };

    expect(resolveRouteMapping(
      { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'image-to-image' },
      [imageKey],
    )).toMatchObject({ status: 'ready', routeId: 'gpt-image-2', key: { id: 'image-primary' } });
    expect(resolveRouteMapping(
      { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' },
      [imageKey],
    )).toBeNull();
  });

  it('does not release a backup route for submission until the user confirms it', async () => {
    const failedPrimary: UserApiKey = { ...textKey, status: 'error' };
    const backup: UserApiKey = {
      ...textKey,
      id: 'text-backup',
      models: [{ id: 'gemini-3-pro', name: 'Gemini 3 Pro' }],
      routeMappings: [{
        target: { kind: 'runtime-capability', capability: 'prompt-enhancement' },
        routeId: 'gemini-3-pro',
        order: 1,
      }],
    };
    const target = { kind: 'runtime-capability', capability: 'prompt-enhancement' } as const;

    await expect(resolveRouteMappingForSubmit(target, [failedPrimary, backup], async () => false))
      .rejects.toThrow('尚未确认备用线路');
    await expect(resolveRouteMappingForSubmit(target, [failedPrimary, backup], async () => true))
      .resolves.toMatchObject({ routeId: 'gemini-3-pro', key: { id: 'text-backup' } });
  });
});
