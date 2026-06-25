import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { UserApiKey, ModelPreference, AIProvider, AICapability, ModelItem } from '../types';
import { saveKeysEncrypted, loadKeysDecrypted, clearAllKeyData, migrateLegacyKeys } from '../utils/keyVault';
import { getUsageSummary } from '../utils/usageMonitor';
import {
    DEFAULT_PROVIDER_MODELS,
    inferCapabilitiesByProvider,
    inferCapabilityFromModel,
    inferProviderFromModel,
    isGoogleImageEditModel,
    isGoogleTextToImageModel,
    PROVIDER_LABELS,
} from '../services/aiGateway';
import { normalizeProviderBaseUrl } from '../services/baseUrl';
import { setGeminiRuntimeConfig } from '../services/geminiService';
import { refreshAllProviderModels } from '../services/modelFetcher';
import {
    isLikelyRunningHubModelEndpoint,
    normalizeRunningHubModelEndpoint,
} from '../services/runningHubService';
import { getGenerationCapability } from '../services/generationCapabilities';
import {
    findBestModelSelection,
    keyOwnsBareModel,
    modelRefModelId,
    modelRefProvider,
    normalizeModelSelectionWithKeys,
    resolveModelSelection,
} from '../utils/modelRefs';

const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const DEFAULT_MODEL_PREFS: ModelPreference = {
    textModel: 'gemini-3-flash-preview',
    imageModel: 'gpt-image-2',
    videoModel: 'dreamina-seedance-2-0-260128',
};

const PROVIDER_MODELS = DEFAULT_PROVIDER_MODELS;

const ensureModelOption = (options: string[], model?: string) => {
    const trimmed = model?.trim();
    if (!trimmed) return options;
    return options.includes(trimmed) ? options : [trimmed, ...options];
};

const buildApiKeyFingerprint = (item: Pick<Partial<UserApiKey>, 'provider' | 'key' | 'baseUrl'>) => {
    const provider = item.provider || '';
    const key = item.key || '';
    const baseUrl = item.baseUrl?.trim().replace(/\/+$/, '') || '';
    return `${provider}::${key}::${baseUrl}`;
};

const normalizeModelId = (model?: string) => model?.trim().toLowerCase() || '';

const keyOwnsModel = (key: UserApiKey, model?: string) => {
    const normalizedModel = normalizeModelId(modelRefModelId(model));
    if (!normalizedModel) return false;
    return keyOwnsBareModel(key, model);
};

const getRequestedModelByCapability = (modelPreference: ModelPreference, capability: AICapability) => {
    if (capability === 'text') return modelPreference.textModel;
    if (capability === 'image') return modelPreference.imageModel;
    if (capability === 'video') return modelPreference.videoModel;
    return '';
};

const FALLBACK_TEXT_OPTIONS = ensureModelOption([...(PROVIDER_MODELS.google?.text || [])], DEFAULT_MODEL_PREFS.textModel);
const FALLBACK_IMAGE_OPTIONS = ensureModelOption([
    ...(PROVIDER_MODELS.openai?.image || []),
    ...(PROVIDER_MODELS.google?.image || []),
], DEFAULT_MODEL_PREFS.imageModel);
const FALLBACK_VIDEO_OPTIONS = ensureModelOption([
    ...(PROVIDER_MODELS.volcengine?.video || []),
    ...(PROVIDER_MODELS.google?.video || []),
], DEFAULT_MODEL_PREFS.videoModel);

const sanitizeRunningHubModelId = (model?: string) => {
    const normalized = normalizeRunningHubModelEndpoint(model);
    if (!normalized) return '';
    return isLikelyRunningHubModelEndpoint(normalized) ? normalized : '';
};

const sanitizeRunningHubModelItems = (models?: ModelItem[]) => (models || [])
    .map(model => {
        const id = sanitizeRunningHubModelId(model.id);
        return id ? { ...model, id, name: model.name || id } : null;
    })
    .filter((model): model is ModelItem => Boolean(model));

const mergeFetchedModelsIntoKey = (key: UserApiKey, modelItems: ModelItem[]) => {
    if (modelItems.length === 0) return key;
    if (key.provider !== 'runningHub') {
        return { ...key, models: modelItems, updatedAt: Date.now() };
    }
    const fetchedIds = new Set(modelItems.map(model => model.id));
    const preservedCustomModels = (key.customModels || [])
        .map(sanitizeRunningHubModelId)
        .filter((model): model is string => Boolean(model) && !fetchedIds.has(model));
    const mergedModels = [
        ...modelItems,
        ...preservedCustomModels.map(id => ({ id, name: id })),
    ];
    const validIds = new Set(mergedModels.map(model => model.id));
    const defaultModel = key.defaultModel && validIds.has(key.defaultModel)
        ? key.defaultModel
        : mergedModels[0]?.id;
    return {
        ...key,
        models: mergedModels,
        customModels: mergedModels.map(model => model.id),
        defaultModel,
        updatedAt: Date.now(),
    };
};

export const normalizeApiKeyEntry = (item: Partial<UserApiKey>): UserApiKey | null => {
    if (!item || !item.id || !item.provider || !item.key) return null;
    const runningHubModels = item.provider === 'runningHub' ? sanitizeRunningHubModelItems(item.models) : item.models;
    const runningHubCustomModels = item.provider === 'runningHub'
        ? (item.customModels || []).map(sanitizeRunningHubModelId).filter((model): model is string => Boolean(model))
        : item.customModels;
    const runningHubDefaultModel = item.provider === 'runningHub'
        ? sanitizeRunningHubModelId(item.defaultModel) || runningHubModels?.[0]?.id || runningHubCustomModels?.[0]
        : item.defaultModel;
    return {
        id: item.id,
        provider: item.provider,
        capabilities:
            Array.isArray(item.capabilities) && item.capabilities.length > 0
                ? item.capabilities
                : inferCapabilitiesByProvider(item.provider),
        key: item.key,
        baseUrl: item.provider === 'runningHub' ? normalizeProviderBaseUrl('runningHub', item.baseUrl) : item.baseUrl,
        name: item.name,
        isDefault: item.isDefault,
        status: item.status,
        customModels: runningHubCustomModels,
        defaultModel: runningHubDefaultModel,
        models: runningHubModels,
        extraConfig: item.extraConfig,
        createdAt: item.createdAt || Date.now(),
        updatedAt: item.updatedAt || Date.now(),
    };
};

const hasCapabilityOverlap = (left: AICapability[], right: AICapability[]) =>
    left.some(capability => right.includes(capability));

/**
 * Distinguishes generic multi-agent discussion support from provider-bound image tool endpoint availability.
 */
export function buildAgentRuntimeSummary(input: {
    textModel: string;
    keys: Array<Pick<UserApiKey, 'provider' | 'key' | 'capabilities'>>;
}) {
    const discussionProvider = inferProviderFromModel(modelRefModelId(input.textModel));
    const discussionSupported = input.keys.some(
        k => !!k.key && (
            k.provider === discussionProvider ||
            (k.capabilities ?? inferCapabilitiesByProvider(k.provider as AIProvider)).includes('text')
        ),
    );
    const imageToolSupported = input.keys.some(k => !!k.key && (k.capabilities ?? inferCapabilitiesByProvider(k.provider as AIProvider)).includes('agent'));
    return { discussionSupported, imageToolSupported };
}

export function useApiKeys(isSettingsPanelOpen: boolean) {
    const [userApiKeys, setUserApiKeys] = useState<UserApiKey[]>([]);
    const [apiKeysLoaded, setApiKeysLoaded] = useState(false);
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [clearKeysOnExit, setClearKeysOnExit] = useState<boolean>(() => {
        try { return localStorage.getItem('security.clearKeysOnExit') === 'true'; } catch { return false; }
    });
    const [modelPreference, setModelPreference] = useState<ModelPreference>(() => {
        try {
            const raw = localStorage.getItem('modelPreference.v1');
            return raw ? { ...DEFAULT_MODEL_PREFS, ...JSON.parse(raw) } : DEFAULT_MODEL_PREFS;
        } catch {
            return DEFAULT_MODEL_PREFS;
        }
    });
    const [modelPreferenceSavedAt, setModelPreferenceSavedAt] = useState<number | null>(null);
    const [modelPreferenceSaveError, setModelPreferenceSaveError] = useState<string | null>(null);
    const [activeUserKeyId, setActiveUserKeyId] = useState<string | null>(null);
    const [activeUserModelId, setActiveUserModelId] = useState<string | null>(null);

    const handleUserKeyChange = useCallback((id: string) => {
        setActiveUserKeyId(id);
        const key = userApiKeys.find(k => k.id === id);
        if (key) {
            setActiveUserModelId(key.defaultModel || key.customModels?.[0] || null);
        }
    }, [userApiKeys]);

    // 根据用户已配置的 API Key 动态计算可选模型列表
    const dynamicModelOptions = useMemo(() => {
        return {
            text: getGenerationCapability(userApiKeys, 'text', modelPreference.textModel, FALLBACK_TEXT_OPTIONS).models,
            image: getGenerationCapability(userApiKeys, 'image', modelPreference.imageModel, FALLBACK_IMAGE_OPTIONS).models,
            video: getGenerationCapability(userApiKeys, 'video', modelPreference.videoModel, FALLBACK_VIDEO_OPTIONS).models,
        };
    }, [modelPreference.imageModel, modelPreference.textModel, modelPreference.videoModel, userApiKeys]);

    // 自动适配：当已配置的 API Key 不覆盖当前选中模型的 provider 时，自动切换到有 Key 的 provider 的模型
    const [modelAutoSwitchNotice, setModelAutoSwitchNotice] = useState<string | null>(null);

    useEffect(() => {
        if (!apiKeysLoaded || userApiKeys.length === 0) return;

        // 仅考虑健康状态的 key（跳过 status === 'error'）
        const healthyKeys = userApiKeys.filter(k => k.status !== 'error');
        if (healthyKeys.length === 0) return;

        const findBestModel = (capability: 'text' | 'image' | 'video', currentModel: string): string | null => {
            const normalized = normalizeModelSelectionWithKeys(currentModel, healthyKeys, capability);
            if (resolveModelSelection(normalized, healthyKeys, capability)) return normalized !== currentModel ? normalized : null;
            return findBestModelSelection(healthyKeys, capability);
        };

        setModelPreference(prev => {
            const updates: Partial<ModelPreference> = {};
            const betterText = findBestModel('text', prev.textModel);
            if (betterText) updates.textModel = betterText;
            const betterImage = findBestModel('image', prev.imageModel);
            if (betterImage) updates.imageModel = betterImage;
            const betterVideo = findBestModel('video', prev.videoModel);
            if (betterVideo) updates.videoModel = betterVideo;

            if (Object.keys(updates).length > 0) {
                const switched: string[] = [];
                if (updates.imageModel) {
                    const p = PROVIDER_LABELS[modelRefProvider(updates.imageModel, healthyKeys)] || modelRefProvider(updates.imageModel, healthyKeys);
                    switched.push(`图片 → ${p}`);
                }
                if (updates.videoModel) {
                    const p = PROVIDER_LABELS[modelRefProvider(updates.videoModel, healthyKeys)] || modelRefProvider(updates.videoModel, healthyKeys);
                    switched.push(`视频 → ${p}`);
                }
                if (updates.textModel) {
                    const p = PROVIDER_LABELS[modelRefProvider(updates.textModel, healthyKeys)] || modelRefProvider(updates.textModel, healthyKeys);
                    switched.push(`文本 → ${p}`);
                }
                setModelAutoSwitchNotice(`已自动切换模型：${switched.join('，')}`);
                setTimeout(() => setModelAutoSwitchNotice(null), 5000);
                return { ...prev, ...updates };
            }
            return prev;
        });
    }, [apiKeysLoaded, userApiKeys]);

    // Usage monitoring summary (recomputed when settings panel opens or keys change)
    const usageSummaryMap = useMemo(() => {
        if (!isSettingsPanelOpen || userApiKeys.length === 0) return undefined;
        return getUsageSummary(userApiKeys.map(k => k.id));
    }, [isSettingsPanelOpen, userApiKeys]);

    // 从加密存储异步加载 API Key（首次挂载 + 兼容迁移旧明文）
    useEffect(() => {
        let cancelled = false;
        (async () => {
            await migrateLegacyKeys();
            const keys = await loadKeysDecrypted<Partial<UserApiKey>[]>();
            if (cancelled) return;
            const normalized = (keys || [])
                .map(normalizeApiKeyEntry)
                .filter((item): item is UserApiKey => !!item);
            setUserApiKeys(normalized);
            setApiKeysLoaded(true);
        })();
        return () => { cancelled = true; };
    }, []);

    // 持久化 API Key（加密写入）
    useEffect(() => {
        if (!apiKeysLoaded) return;
        saveKeysEncrypted(userApiKeys);
    }, [userApiKeys, apiKeysLoaded]);

    // 新用户引导：API Key 异步加载完成后，如果没有任何 Key 且用户未主动跳过，自动弹出引导
    useEffect(() => {
        if (!apiKeysLoaded) return;
        const hasSkipped = localStorage.getItem('onboarding.skipped') === 'true';
        if (userApiKeys.length === 0 && !hasSkipped) {
            setShowOnboarding(true);
        } else if (userApiKeys.length > 0) {
            setShowOnboarding(false);
        }
    }, [apiKeysLoaded, userApiKeys.length]);

    // 持久化 clearKeysOnExit 设置
    useEffect(() => {
        try { localStorage.setItem('security.clearKeysOnExit', clearKeysOnExit.toString()); } catch { /* non-critical */ }
    }, [clearKeysOnExit]);

    // 退出时清除 API Key
    useEffect(() => {
        if (!clearKeysOnExit) return;
        const handleBeforeUnload = () => { clearAllKeyData(); };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [clearKeysOnExit]);

    // ─── Chrome Extension bridge V3: AES-GCM encrypted shared storage ───
    // Storage key and encryption scheme must match extension/popup/popup.js
    const STORAGE_KEY_V2 = 'flovart_api_keys_v2';
    const EXT_ENC_SALT = 'flovart-ext-v3';

    const getExtensionEncryptionKey = async (): Promise<CryptoKey | null> => {
        try {
            // In extension context, chrome.runtime.id is available as key material
            const runtimeId = chrome?.runtime?.id;
            if (!runtimeId) return null;
            const enc = new TextEncoder();
            const keyMaterial = await crypto.subtle.importKey(
                'raw', enc.encode(runtimeId), 'PBKDF2', false, ['deriveKey']
            );
            return crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt: enc.encode(EXT_ENC_SALT), iterations: 100000, hash: 'SHA-256' },
                keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
            );
        } catch { return null; }
    };

    const encodeKeysForStorage = async (data: unknown): Promise<{ iv: number[]; ct: number[] } | string> => {
        const aesKey = await getExtensionEncryptionKey();
        if (aesKey) {
            const enc = new TextEncoder();
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const ct = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv }, aesKey, enc.encode(JSON.stringify(data))
            );
            return { iv: Array.from(iv), ct: Array.from(new Uint8Array(ct)) };
        }
        // Fallback: base64 when not in extension context (shouldn't happen but safe)
        const bytes = new TextEncoder().encode(JSON.stringify(data));
        let s = '';
        for (const b of bytes) s += String.fromCharCode(b);
        return btoa(s);
    };

    const decodeKeysFromStorage = async (encoded: unknown): Promise<unknown> => {
        try {
            // V3: AES-GCM encrypted object { iv, ct }
            if (encoded && typeof encoded === 'object' && 'iv' in encoded && 'ct' in encoded) {
                const aesKey = await getExtensionEncryptionKey();
                if (aesKey) {
                    const obj = encoded as { iv: number[]; ct: number[] };
                    const iv = new Uint8Array(obj.iv);
                    const ct = new Uint8Array(obj.ct);
                    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
                    return JSON.parse(new TextDecoder().decode(pt));
                }
            }
            // V2 fallback: base64 string
            if (typeof encoded === 'string') {
                const s = atob(encoded);
                const bytes = new Uint8Array(s.length);
                for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
                return JSON.parse(new TextDecoder().decode(bytes));
            }
            return null;
        } catch { return null; }
    };

    // Chrome Extension bridge: sync API keys to chrome.storage.local (V3 encrypted) for content script access
    const isWritingToChromeStorage = useRef(false);
    useEffect(() => {
        if (!apiKeysLoaded || typeof chrome === 'undefined' || !chrome?.storage?.local) return;
        isWritingToChromeStorage.current = true;
        encodeKeysForStorage(userApiKeys).then(encrypted => {
            chrome.storage.local.set({
                [STORAGE_KEY_V2]: { d: encrypted, v: 3 },
            }, () => {
                // 短暂延迟后重置标志，避免自己触发的 onChanged 导致循环
                setTimeout(() => { isWritingToChromeStorage.current = false; }, 100);
            });
        }).catch(() => {
            isWritingToChromeStorage.current = false;
        });
    }, [userApiKeys, apiKeysLoaded]);

    // Chrome Extension bridge: listen for keys added from extension popup → merge into app (V3 encrypted)
    useEffect(() => {
        if (typeof chrome === 'undefined' || !chrome?.storage?.onChanged) return;
        const handleStorageChange = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, areaName: string) => {
            if (areaName !== 'local' || !changes[STORAGE_KEY_V2]) return;
            // 忽略自身写入触发的变更
            if (isWritingToChromeStorage.current) return;

            const newVal = changes[STORAGE_KEY_V2].newValue as { d?: unknown; v?: number } | undefined;
            if (!newVal?.d) return;
            decodeKeysFromStorage(newVal.d).then(extKeysRaw => {
                const extKeys = extKeysRaw as Array<Partial<UserApiKey>> | null;
                if (!Array.isArray(extKeys)) return;

                setUserApiKeys(prev => {
                    const existingFingerprints = new Set(prev.map(buildApiKeyFingerprint));
                    const newKeys: UserApiKey[] = [];
                    for (const ek of extKeys) {
                        if (!ek.provider || !ek.key) continue;
                        const fp = buildApiKeyFingerprint(ek);
                        if (existingFingerprints.has(fp)) continue;
                        newKeys.push(normalizeApiKeyEntry({
                            id: ek.id || crypto.randomUUID(),
                            provider: ek.provider,
                            key: ek.key,
                            baseUrl: ek.baseUrl,
                            capabilities: ek.capabilities,
                            models: ek.models,
                            name: ek.name,
                            defaultModel: ek.defaultModel,
                            customModels: ek.customModels,
                            extraConfig: ek.extraConfig,
                            createdAt: ek.createdAt || Date.now(),
                            updatedAt: ek.updatedAt || Date.now(),
                        }) as UserApiKey);
                    }
                    return newKeys.length > 0 ? [...prev, ...newKeys.filter(Boolean)] : prev;
                });
            });
        };
        chrome.storage.onChanged.addListener(handleStorageChange);
        return () => chrome.storage.onChanged.removeListener(handleStorageChange);
    }, []);

    // 启动时后台自动刷新所有 Provider 的模型列表（带缓存 TTL）
    const autoRefreshRan = useRef(false);
    useEffect(() => {
        if (!apiKeysLoaded || userApiKeys.length === 0 || autoRefreshRan.current) return;
        autoRefreshRan.current = true;
        const keysToFetch = userApiKeys
            .filter(k => k.key && k.status !== 'error')
            .map(k => ({ id: k.id, provider: k.provider, key: k.key, baseUrl: k.baseUrl }));
        if (keysToFetch.length === 0) return;
        refreshAllProviderModels(keysToFetch).then(results => {
            if (results.size === 0) return;
            setUserApiKeys(prev => prev.map(k => {
                const fetched = results.get(k.id);
                if (!fetched || fetched.length === 0) return k;
                const modelItems = fetched.map(m => ({ id: m.id, name: m.name || m.id }));
                return mergeFetchedModelsIntoKey(k, modelItems);
            }));
        }).catch(() => { /* silent background refresh failure */ });
    }, [apiKeysLoaded, userApiKeys.length]);

    // 持久化 modelPreference
    useEffect(() => {
        try {
            localStorage.setItem('modelPreference.v1', JSON.stringify(modelPreference));
            setModelPreferenceSavedAt(Date.now());
            setModelPreferenceSaveError(null);
        } catch (error) {
            setModelPreferenceSaveError(error instanceof Error ? error.message : '本机存储不可用');
        }
    }, [modelPreference]);

    const getPreferredApiKey = useCallback((capability: AICapability, provider?: AIProvider) => {
        const requestedModel = getRequestedModelByCapability(modelPreference, capability);
        if (capability === 'text' || capability === 'image' || capability === 'video') {
            const resolved = resolveModelSelection(requestedModel, userApiKeys, capability, provider);
            if (resolved?.key) return resolved.key;
        }
        const matches = userApiKeys.filter(key => {
            if (key.status === 'error') return false;
            const capabilities = key.capabilities?.length ? key.capabilities : inferCapabilitiesByProvider(key.provider);
            if (!capabilities.includes(capability)) return false;
            if (!provider) return true;
            if (key.provider === provider) return true;
            return key.provider === 'custom' && keyOwnsModel(key, requestedModel);
        });
        return matches.find(key => key.isDefault) || matches[0];
    }, [modelPreference, userApiKeys]);

    // Sync runtime config for Gemini services
    useEffect(() => {
        const textModel = modelRefModelId(modelPreference.textModel);
        const imageModel = modelRefModelId(modelPreference.imageModel);
        const videoModel = modelRefModelId(modelPreference.videoModel);
        const textProvider = modelRefProvider(modelPreference.textModel, userApiKeys);
        const imageProvider = modelRefProvider(modelPreference.imageModel, userApiKeys);
        const videoProvider = modelRefProvider(modelPreference.videoModel, userApiKeys);

        const googleTextKey = getPreferredApiKey('text', 'google');
        const googleImageKey = getPreferredApiKey('image', 'google');
        const googleVideoKey = getPreferredApiKey('video', 'google');

        setGeminiRuntimeConfig({
            textApiKey: googleTextKey?.key,
            imageApiKey: googleImageKey?.key || googleTextKey?.key,
            videoApiKey: googleVideoKey?.key || googleImageKey?.key || googleTextKey?.key,
            baseUrl: googleTextKey?.baseUrl,
            textModel: textProvider === 'google' ? textModel : undefined,
            imageModel:
                imageProvider === 'google' && isGoogleImageEditModel(imageModel)
                    ? imageModel
                    : undefined,
            textToImageModel:
                imageProvider === 'google' && isGoogleTextToImageModel(imageModel)
                    ? imageModel
                    : undefined,
            videoModel: videoProvider === 'google' ? videoModel : undefined,
        });
    }, [getPreferredApiKey, modelPreference, userApiKeys]);

    const handleAddApiKey = useCallback((payload: Omit<UserApiKey, 'id' | 'createdAt' | 'updatedAt'>) => {
        const now = Date.now();
        const capabilities = payload.capabilities?.length ? payload.capabilities : inferCapabilitiesByProvider(payload.provider);
        const nextKey: UserApiKey = {
            ...payload,
            capabilities,
            id: generateId(),
            createdAt: now,
            updatedAt: now,
        };
        setUserApiKeys(prev => {
            const isFirstOfCapabilities = !prev.some(k =>
                hasCapabilityOverlap(
                    k.capabilities?.length ? k.capabilities : inferCapabilitiesByProvider(k.provider),
                    capabilities
                )
            );
            const shouldSetDefault = payload.isDefault || isFirstOfCapabilities;
            const withDefault = shouldSetDefault
                ? prev.map(k => {
                    const existingCaps = k.capabilities?.length ? k.capabilities : inferCapabilitiesByProvider(k.provider);
                    return hasCapabilityOverlap(existingCaps, capabilities)
                        ? { ...k, isDefault: false }
                        : k;
                })
                : prev;
            return [{ ...nextKey, isDefault: shouldSetDefault }, ...withDefault];
        });
        // 新增 Key 后自动拉取模型列表（后台静默）
        refreshAllProviderModels([{ id: nextKey.id, provider: payload.provider, key: payload.key, baseUrl: payload.baseUrl }], true)
            .then(results => {
                const fetched = results.get(nextKey.id);
                if (fetched && fetched.length > 0) {
                    const modelItems = fetched.map(m => ({ id: m.id, name: m.name || m.id }));
                    setUserApiKeys(prev => prev.map(k =>
                        k.id === nextKey.id ? mergeFetchedModelsIntoKey(k, modelItems) : k
                    ));
                }
            })
            .catch(() => {});
    }, []);

    const handleDeleteApiKey = useCallback((id: string) => {
        setUserApiKeys(prev => prev.filter(k => k.id !== id));
    }, []);

    const handleUpdateApiKey = useCallback((id: string, patch: Partial<Omit<UserApiKey, 'id' | 'createdAt'>>) => {
        setUserApiKeys(prev => prev.map(k =>
            k.id === id ? { ...k, ...patch, updatedAt: Date.now() } : k
        ));
    }, []);

    const handleSetDefaultApiKey = useCallback((id: string) => {
        setUserApiKeys(prev => {
            const target = prev.find(k => k.id === id);
            if (!target) return prev;
            const targetCaps = target.capabilities?.length ? target.capabilities : inferCapabilitiesByProvider(target.provider);
            return prev.map(k => {
                const existingCaps = k.capabilities?.length ? k.capabilities : inferCapabilitiesByProvider(k.provider);
                return hasCapabilityOverlap(existingCaps, targetCaps)
                    ? { ...k, isDefault: k.id === id }
                    : k;
            });
        });
    }, []);

    return {
        userApiKeys,
        setUserApiKeys,
        apiKeysLoaded,
        showOnboarding,
        setShowOnboarding,
        clearKeysOnExit,
        setClearKeysOnExit,
        modelPreference,
        setModelPreference,
        modelPreferenceSavedAt,
        modelPreferenceSaveError,
        activeUserKeyId,
        activeUserModelId,
        setActiveUserModelId,
        handleUserKeyChange,
        dynamicModelOptions,
        usageSummaryMap,
        getPreferredApiKey,
        handleAddApiKey,
        handleDeleteApiKey,
        handleUpdateApiKey,
        handleSetDefaultApiKey,
        modelAutoSwitchNotice,
    };
}
