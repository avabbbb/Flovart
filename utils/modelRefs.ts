import type { AICapability, AIProvider, ProductModelMode, UserApiKey } from '../types';
import {
  DEFAULT_PROVIDER_MODELS,
  inferCapabilitiesByProvider,
  inferCapabilityFromModel,
  inferProviderFromModel,
  PROVIDER_LABELS,
} from '../services/aiGateway';
import {
  getProductModel,
  getProductModels,
  productModelLabel,
  resolveProductModelRoute,
  resolveAnyProductRoute,
} from '../services/productModelCatalog';

export const MODEL_REF_SEPARATOR = '::';

export type ModelRef = {
  keyId: string;
  modelId: string;
};

const normalizeModelId = (model?: string) => model?.trim().toLowerCase() || '';

const addUniqueModel = (models: string[], seen: Set<string>, model?: string) => {
  const trimmed = model?.trim();
  const normalized = normalizeModelId(trimmed);
  if (!trimmed || seen.has(normalized)) return;
  seen.add(normalized);
  models.push(trimmed);
};

export function encodeModelRef(keyId: string, modelId: string): string {
  return `${keyId}${MODEL_REF_SEPARATOR}${modelId}`;
}

export function decodeModelRef(value?: string | null): ModelRef | null {
  const raw = value?.trim();
  if (!raw) return null;
  const index = raw.indexOf(MODEL_REF_SEPARATOR);
  if (index <= 0) return null;
  const keyId = raw.slice(0, index).trim();
  const modelId = raw.slice(index + MODEL_REF_SEPARATOR.length).trim();
  return keyId && modelId ? { keyId, modelId } : null;
}

export function modelRefModelId(value?: string | null): string {
  const decoded = decodeModelRef(value);
  return decoded?.modelId || value?.trim() || '';
}

export function modelRefKeyId(value?: string | null): string | undefined {
  return decodeModelRef(value)?.keyId;
}

export function getKeyCapabilities(key: UserApiKey): AICapability[] {
  return key.capabilities?.length ? key.capabilities : inferCapabilitiesByProvider(key.provider);
}

export function getKeyModelIds(key: UserApiKey, capability?: 'text' | 'image' | 'video'): string[] {
  const models: string[] = [];
  const seen = new Set<string>();
  const providerModels = DEFAULT_PROVIDER_MODELS[key.provider];

  addUniqueModel(models, seen, key.defaultModel);
  key.models?.forEach(model => addUniqueModel(models, seen, model.id));
  key.customModels?.forEach(model => addUniqueModel(models, seen, model));

  if (capability && providerModels?.[capability]) {
    providerModels[capability].forEach(model => addUniqueModel(models, seen, model));
  } else if (providerModels) {
    providerModels.text.forEach(model => addUniqueModel(models, seen, model));
    providerModels.image.forEach(model => addUniqueModel(models, seen, model));
    providerModels.video.forEach(model => addUniqueModel(models, seen, model));
  }

  return models.filter(model => {
    if (!capability) return true;
    const normalized = normalizeModelId(model);
    const declared = key.models?.find(item => normalizeModelId(item.id) === normalized)?.capability;
    const inferred = declared || inferCapabilityFromModel(model);
    if (inferred) return inferred === capability;
    const creativeCapabilities = getKeyCapabilities(key).filter(item => item === 'text' || item === 'image' || item === 'video');
    return creativeCapabilities.length === 1 && creativeCapabilities[0] === capability;
  });
}

export function keyOwnsBareModel(key: UserApiKey, model?: string): boolean {
  const bareModel = modelRefModelId(model);
  const product = bareModel.startsWith('flovart:') ? getProductModel(bareModel) : undefined;
  if (product) return (key.routeMappings || []).some(mapping => mapping.target.kind === 'product-mode' && mapping.target.productModelId === product.id);
  const normalizedModel = normalizeModelId(bareModel);
  if (!normalizedModel) return false;
  return getKeyModelIds(key).some(candidate => normalizeModelId(candidate) === normalizedModel);
}

export function buildCapabilityModelOptions(
  keys: UserApiKey[],
  capability: 'text' | 'image' | 'video',
  fallbackModels: string[],
  currentModel?: string,
): string[] {
  if (capability === 'image' || capability === 'video') {
    const models = getProductModels(capability).map(model => model.id);
    const product = getProductModel(currentModel);
    if (product?.capability === capability && !models.includes(product.id)) models.unshift(product.id);
    return models;
  }
  const options: string[] = [];
  const seen = new Set<string>();

  for (const key of keys) {
    if (key.status === 'error') continue;
    const caps = getKeyCapabilities(key);
    if (!caps.includes(capability)) continue;
    for (const model of getKeyModelIds(key, capability)) {
      addUniqueModel(options, seen, encodeModelRef(key.id, model));
    }
  }

  const current = currentModel?.trim();
  if (current && !options.includes(current)) {
    options.unshift(current);
    seen.add(normalizeModelId(current));
  }

  if (options.length === 0) {
    return fallbackModels.slice();
  }

  for (const model of fallbackModels) {
    addUniqueModel(options, seen, model);
  }

  return options;
}

export function normalizeModelSelectionWithKeys(
  value: string,
  keys: UserApiKey[],
  capability: 'text' | 'image' | 'video',
): string {
  const product = value.startsWith('flovart:') ? getProductModel(value) : undefined;
  if (product?.capability === capability) return product.id;
  const decoded = decodeModelRef(value);
  if (decoded) {
    const key = keys.find(item => item.id === decoded.keyId);
    if (key && key.status !== 'error' && getKeyCapabilities(key).includes(capability)) {
      return value;
    }
    return decoded.modelId;
  }

  const normalized = normalizeModelId(value);
  if (!normalized) return value;
  const matches = keys.filter(key => (
    key.status !== 'error'
    && getKeyCapabilities(key).includes(capability)
    && keyOwnsBareModel(key, value)
  ));

  return matches.length === 1 ? encodeModelRef(matches[0].id, value.trim()) : value;
}

export function resolveModelSelection(
  value: string,
  keys: UserApiKey[],
  capability: 'text' | 'image' | 'video',
  requestedProvider?: AIProvider,
  submode?: ProductModelMode,
): { routeId: string; provider: AIProvider; key: UserApiKey } | null {
  const product = value.startsWith('flovart:') ? getProductModel(value) : undefined;
  if (product?.capability === capability) {
    const effectiveMode = submode
      || (capability === 'image' ? 'text-to-image' : capability === 'video' ? 'text-to-video' : 'text-to-image');
    const route = resolveProductModelRoute(product.id, effectiveMode, keys);
    return route && (!requestedProvider || route.key.provider === requestedProvider)
      ? { routeId: route.routeId, provider: route.key.provider, key: route.key }
      : null;
  }
  const decoded = decodeModelRef(value);
  const healthyKeys = keys.filter(key => key.status !== 'error');

  if (decoded) {
    const key = healthyKeys.find(item => item.id === decoded.keyId);
    if (key && getKeyCapabilities(key).includes(capability)) {
      return { routeId: decoded.modelId, provider: key.provider, key };
    }
    return null;
  }

  const bareModel = modelRefModelId(value);
  const inferredProvider = requestedProvider || inferProviderFromModel(bareModel);
  const direct = healthyKeys.find(key => {
    const caps = getKeyCapabilities(key);
    if (!caps.includes(capability)) return false;
    if (keyOwnsBareModel(key, bareModel)) return true;
    if (key.provider === inferredProvider) return true;
    return key.provider === 'custom' && keyOwnsBareModel(key, bareModel);
  });

  return direct ? { routeId: bareModel, provider: direct.provider, key: direct } : null;
}

export function findBestModelSelection(
  keys: UserApiKey[],
  capability: 'text' | 'image' | 'video',
): string | null {
  if (capability === 'image' || capability === 'video') {
    const configured = getProductModels(capability).find(model => resolveAnyProductRoute(model.id, keys));
    if (configured) return configured.id;
  }
  for (const key of keys) {
    if (key.status === 'error') continue;
    if (!getKeyCapabilities(key).includes(capability)) continue;
    const model = getKeyModelIds(key, capability)[0];
    if (model) return encodeModelRef(key.id, model);
  }
  return null;
}

export function modelRefProvider(value: string, keys: UserApiKey[]): AIProvider {
  const product = getProductModel(value);
  if (product) return resolveAnyProductRoute(product.id, keys)?.key.provider || product.provider;
  const keyId = modelRefKeyId(value);
  const key = keyId ? keys.find(item => item.id === keyId) : undefined;
  return key?.provider || inferProviderFromModel(modelRefModelId(value));
}

export function modelRefLabel(value: string, keys: UserApiKey[] = []): string {
  const product = getProductModel(value);
  if (product) return product.name;
  return modelRefModelId(value);
}

export function modelRefSearchText(value: string, keys: UserApiKey[] = []): string {
  const product = getProductModel(value);
  if (product) {
    const route = resolveAnyProductRoute(product.id, keys);
    return [product.id, product.name, product.shortName, product.company, product.description, productModelLabel(value), route?.key.name, route?.key.provider].filter(Boolean).join(' ').toLowerCase();
  }
  const keyId = modelRefKeyId(value);
  const key = keyId ? keys.find(item => item.id === keyId) : undefined;
  return [
    value,
    modelRefModelId(value),
    key?.name,
    key?.provider,
    key ? PROVIDER_LABELS[key.provider] : undefined,
    key?.baseUrl,
  ].filter(Boolean).join(' ').toLowerCase();
}
