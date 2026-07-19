import type { RouteMappingTarget, UserApiKey } from '../types';

export type RouteMappingResolution =
  | { status: 'ready'; routeId: string; key: UserApiKey }
  | {
      status: 'confirmation-required';
      routeId: string;
      key: UserApiKey;
      unavailablePrimary: { routeId: string; key: UserApiKey };
    };

export type RouteFallbackResolution = Extract<RouteMappingResolution, { status: 'confirmation-required' }>;

const targetKey = (target: RouteMappingTarget) => target.kind === 'product-mode'
  ? `${target.kind}:${target.productModelId}:${target.mode}`
  : `${target.kind}:${target.capability}`;

const keyExposesRoute = (key: UserApiKey, routeId: string) => {
  const routes = [key.defaultModel, ...(key.models || []).map(model => model.id), ...(key.customModels || [])]
    .map(value => value?.trim().toLowerCase())
    .filter(Boolean);
  return routes.length === 0 || routes.includes(routeId.trim().toLowerCase());
};

const keySupportsTarget = (key: UserApiKey, target: RouteMappingTarget) => {
  if (target.kind === 'runtime-capability') return key.capabilities.includes('text');
  const capability = target.mode === 'text-to-image' || target.mode === 'image-to-image' ? 'image' : 'video';
  return key.capabilities.includes(capability);
};

const routeAvailable = (key: UserApiKey, target: RouteMappingTarget, routeId: string) => (
  key.status !== 'error'
  && Boolean(routeId.trim())
  && keySupportsTarget(key, target)
  && keyExposesRoute(key, routeId)
);

export function resolveRouteMapping(
  target: RouteMappingTarget,
  keys: UserApiKey[],
): RouteMappingResolution | null {
  const expected = targetKey(target);
  const candidates = keys
    .flatMap(key => (key.routeMappings || []).map(mapping => ({ key, mapping })))
    .filter(({ mapping }) => targetKey(mapping.target) === expected)
    .sort((left, right) => (
      left.mapping.order - right.mapping.order
      || Number(Boolean(right.key.isDefault)) - Number(Boolean(left.key.isDefault))
      || left.key.id.localeCompare(right.key.id)
    ));
  const primary = candidates[0];
  const selected = candidates.find(({ key, mapping }) => routeAvailable(key, target, mapping.routeId));
  if (!primary || !selected) return null;
  const routeId = selected.mapping.routeId.trim();
  if (selected === primary) return { status: 'ready', routeId, key: selected.key };
  return {
    status: 'confirmation-required',
    routeId,
    key: selected.key,
    unavailablePrimary: { routeId: primary.mapping.routeId.trim(), key: primary.key },
  };
}

export async function resolveRouteMappingForSubmit(
  target: RouteMappingTarget,
  keys: UserApiKey[],
  confirmFallback?: (resolution: RouteFallbackResolution) => boolean | Promise<boolean>,
): Promise<{ routeId: string; key: UserApiKey }> {
  const resolution = resolveRouteMapping(target, keys);
  if (!resolution) throw new Error('尚未配置可用的模型映射。');
  if (resolution.status === 'confirmation-required' && !await confirmFallback?.(resolution)) {
    throw new Error('尚未确认备用线路，已停止提交。');
  }
  return { routeId: resolution.routeId, key: resolution.key };
}
