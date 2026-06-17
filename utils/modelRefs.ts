import type { AICapability, AIProvider, UserApiKey } from '../types';
import {
  DEFAULT_PROVIDER_MODELS,
  inferCapabilitiesByProvider,
  inferCapabilityFromModel,
  inferProviderFromModel,
  PROVIDER_LABELS,
} from '../services/aiGateway';

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
    const inferred = inferCapabilityFromModel(model);
    return !inferred || inferred === capability;
  });
}

export function keyOwnsBareModel(key: UserApiKey, model?: string): boolean {
  const bareModel = modelRefModelId(model);
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
): { model: string; provider: AIProvider; key: UserApiKey } | null {
  const decoded = decodeModelRef(value);
  const healthyKeys = keys.filter(key => key.status !== 'error');

  if (decoded) {
    const key = healthyKeys.find(item => item.id === decoded.keyId);
    if (key && getKeyCapabilities(key).includes(capability)) {
      return { model: decoded.modelId, provider: key.provider, key };
    }
    return null;
  }

  const bareModel = modelRefModelId(value);
  const inferredProvider = requestedProvider || inferProviderFromModel(bareModel);
  const direct = healthyKeys.find(key => {
    const caps = getKeyCapabilities(key);
    if (!caps.includes(capability)) return false;
    if (key.provider === inferredProvider) return true;
    return key.provider === 'custom' && keyOwnsBareModel(key, bareModel);
  });

  return direct ? { model: bareModel, provider: direct.provider, key: direct } : null;
}

export function findBestModelSelection(
  keys: UserApiKey[],
  capability: 'text' | 'image' | 'video',
): string | null {
  for (const key of keys) {
    if (key.status === 'error') continue;
    if (!getKeyCapabilities(key).includes(capability)) continue;
    const model = getKeyModelIds(key, capability)[0];
    if (model) return encodeModelRef(key.id, model);
  }
  return null;
}

export function modelRefProvider(value: string, keys: UserApiKey[]): AIProvider {
  const keyId = modelRefKeyId(value);
  const key = keyId ? keys.find(item => item.id === keyId) : undefined;
  return key?.provider || inferProviderFromModel(modelRefModelId(value));
}

export function modelRefLabel(value: string, keys: UserApiKey[] = []): string {
  const bareModel = modelRefModelId(value);
  const keyId = modelRefKeyId(value);
  const key = keyId ? keys.find(item => item.id === keyId) : undefined;
  const owner = key?.name?.trim() || (key ? PROVIDER_LABELS[key.provider] || key.provider : undefined);
  return owner ? `${bareModel} · ${owner}` : bareModel;
}

export function modelRefSearchText(value: string, keys: UserApiKey[] = []): string {
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
