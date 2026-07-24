import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { UserApiKey, AIProvider, AICapability, ModelItem } from '../types';
import { saveKeysEncrypted, loadKeysDecrypted, clearAllKeyData, migrateLegacyKeys } from '../utils/keyVault';
import { getUsageSummary } from '../utils/usageMonitor';
import {
    inferCapabilitiesByProvider,
    inferProviderFromModel,
    isGoogleImageEditModel,
    isGoogleTextToImageModel,
} from '../services/aiGateway';
import { normalizeProviderBaseUrl } from '../services/baseUrl';
import { refreshAllProviderModels } from '../services/modelFetcher';
import {
    isLikelyRunningHubModelEndpoint,
    normalizeRunningHubModelEndpoint,
} from '../services/runningHubService';
import { modelRefModelId } from '../utils/modelRefs';
import { getProductModels } from '../services/productModelCatalog';
import {
    deleteRuntimeCredential,
    reportRuntimeCredentialVault,
    syncRuntimeCredentials,
} from '../services/runtimeCredentials';

const generateId = () => `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const buildApiKeyFingerprint = (item: Pick<Partial<UserApiKey>, 'provider' | 'key' | 'baseUrl'>) => {
    const provider = item.provider || '';
    const key = item.key || '';
    const baseUrl = item.baseUrl?.trim().replace(/\/+$/, '') || '';
    return `${provider}::${key}::${baseUrl}`;
};

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
        routeMappings: item.routeMappings,
        pricingRules: item.pricingRules,
        budgetPolicy: item.budgetPolicy,
        createdAt: item.createdAt || Date.now(),
        updatedAt: item.updatedAt || Date.now(),
    };
};

export function mergeExtensionApiKeys(current: UserApiKey[], incoming: Array<Partial<UserApiKey>>): UserApiKey[] {
    const next = [...current];
    for (const item of incoming) {
        if (!item.provider || !item.key) continue;
        const fingerprint = buildApiKeyFingerprint(item);
        const idIndex = item.id ? next.findIndex(existing => existing.id === item.id) : -1;
        const index = idIndex >= 0
            ? idIndex
            : next.findIndex(existing => buildApiKeyFingerprint(existing) === fingerprint);
        const existing = index >= 0 ? next[index] : undefined;
        const definedItem = Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
        const merged: Partial<UserApiKey> = { ...existing, ...definedItem };
        merged.id = existing?.id || item.id || crypto.randomUUID();
        merged.createdAt = existing?.createdAt || item.createdAt || Date.now();
        merged.updatedAt = item.updatedAt || Date.now();
        const normalized = normalizeApiKeyEntry(merged);
        if (!normalized) continue;
        if (index >= 0) next[index] = normalized;
        else next.push(normalized);
    }
    return next;
}

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
    // PromptBar 只展示稳定 Product Model；文本执行模型由 Runtime Capability 映射决定。
    const dynamicModelOptions = useMemo(() => {
        return {
            text: [],
            image: getProductModels('image').map(model => model.id),
            video: getProductModels('video').map(model => model.id),
        };
    }, []);

    const [usageSummaryMap, setUsageSummaryMap] = useState<Awaited<ReturnType<typeof getUsageSummary>> | undefined>();
    useEffect(() => {
        if (!isSettingsPanelOpen || userApiKeys.length === 0) {
            setUsageSummaryMap(undefined);
            return;
        }
        let cancelled = false;
        void getUsageSummary(userApiKeys).then(summary => { if (!cancelled) setUsageSummaryMap(summary); });
        return () => { cancelled = true; };
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

    // 持久化 API Key（加密写入 localforage）；“退出时清除”开启后只保留内存态。
    useEffect(() => {
        if (!apiKeysLoaded) return;
        void reportRuntimeCredentialVault(userApiKeys.length, !clearKeysOnExit)
            .catch(() => { /* Runtime may be unavailable in web builds. */ });
        if (clearKeysOnExit) {
            void clearAllKeyData();
            return;
        }
        void saveKeysEncrypted(userApiKeys);
        void syncRuntimeCredentials(userApiKeys).catch(() => { /* Runtime may be unavailable in web builds. */ });
    }, [userApiKeys, apiKeysLoaded, clearKeysOnExit]);

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

                setUserApiKeys(prev => mergeExtensionApiKeys(prev, extKeys));
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
                const modelItems = fetched.map(m => ({ id: m.id, name: m.name || m.id, capability: m.capability }));
                return mergeFetchedModelsIntoKey(k, modelItems);
            }));
        }).catch(() => { /* silent background refresh failure */ });
    }, [apiKeysLoaded, userApiKeys.length]);

    const handleAddApiKey = useCallback((payload: Omit<UserApiKey, 'id' | 'createdAt' | 'updatedAt'>) => {
        const now = Date.now();
        const capabilities = payload.capabilities?.length ? payload.capabilities : inferCapabilitiesByProvider(payload.provider);
        const initialKey: UserApiKey = {
            ...payload,
            capabilities,
            id: generateId(),
            createdAt: now,
            updatedAt: now,
        };
        const nextKey = initialKey;
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
                    const modelItems = fetched.map(m => ({ id: m.id, name: m.name || m.id, capability: m.capability }));
                    setUserApiKeys(prev => prev.map(k =>
                        k.id === nextKey.id ? mergeFetchedModelsIntoKey(k, modelItems) : k
                    ));
                }
            })
            .catch(() => {});
    }, []);

    const handleDeleteApiKey = useCallback((id: string) => {
        setUserApiKeys(prev => {
            const removed = prev.find(k => k.id === id);
            if (removed) void deleteRuntimeCredential(removed).catch(() => { /* Local vault remains authoritative. */ });
            return prev.filter(k => k.id !== id);
        });
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
        dynamicModelOptions,
        usageSummaryMap,
        handleAddApiKey,
        handleDeleteApiKey,
        handleUpdateApiKey,
        handleSetDefaultApiKey,
    };
}
