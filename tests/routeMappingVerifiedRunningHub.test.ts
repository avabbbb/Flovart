import { describe, expect, it } from 'vitest';
import { resolveRouteMapping } from '../services/routeMapping';
import type { UserApiKey } from '../types';

const key = (models: string[]): UserApiKey => ({
  id: 'rh', provider: 'runningHub', name: 'RH', key: 'x', capabilities: ['image', 'video'], status: 'ok',
  models: models.map(id => ({ id, name: id })),
  routeMappings: [{ target: { kind: 'product-mode', productModelId: 'flovart:seedream-5-flash', mode: 'text-to-image' }, routeId: 'seedream-v5-flash/text-to-image', order: 0 }],
} as unknown as UserApiKey);

describe('RunningHub 核验线路映射', () => {
  it('自动拉取的模型列表里没有核验线路时仍可解析（列表会覆盖手填 id）', () => {
    const resolved = resolveRouteMapping({ kind: 'product-mode', productModelId: 'flovart:seedream-5-flash', mode: 'text-to-image' }, [key(['some/other-model'])]);
    expect(resolved).toMatchObject({ status: 'ready', routeId: 'seedream-v5-flash/text-to-image' });
  });
  it('未核验线路仍需出现在模型列表中', () => {
    const k = key(['some/other-model']);
    k.routeMappings = [{ target: { kind: 'product-mode', productModelId: 'flovart:seedream-5-flash', mode: 'text-to-image' }, routeId: 'not-in-catalog/x', order: 0 }];
    expect(resolveRouteMapping({ kind: 'product-mode', productModelId: 'flovart:seedream-5-flash', mode: 'text-to-image' }, [k])).toBeNull();
  });
});
