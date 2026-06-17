import React from 'react';
import type { WheelAction, UserApiKey, ModelPreference, AIProvider, AICapability, ThemeMode, ModelItem } from '../types';
import {
    DEFAULT_PROVIDER_MODELS,
    validateApiKey,
    inferProviderFromKey,
    inferCapabilitiesByProvider,
    PROVIDER_LABELS,
} from '../services/aiGateway';
import { formatCost, type KeyUsageSummary } from '../utils/usageMonitor';
import { fetchModelsForProvider, type FetchedModel } from '../services/modelFetcher';
import { normalizeProviderBaseUrl } from '../services/baseUrl';
import { modelRefLabel, modelRefSearchText } from '../utils/modelRefs';

interface CanvasSettingsProps {
    isOpen: boolean;
    onClose: () => void;
    language: 'en' | 'zho';
    setLanguage: (lang: 'en' | 'zho') => void;
    themeMode: ThemeMode;
    resolvedTheme: 'light' | 'dark';
    setThemeMode: (mode: ThemeMode) => void;
    wheelAction: WheelAction;
    setWheelAction: (action: WheelAction) => void;
    userApiKeys: UserApiKey[];
    onAddApiKey: (payload: Omit<UserApiKey, 'id' | 'createdAt' | 'updatedAt'>) => void;
    onDeleteApiKey: (id: string) => void;
    onUpdateApiKey: (id: string, patch: Partial<Omit<UserApiKey, 'id' | 'createdAt'>>) => void;
    onSetDefaultApiKey: (id: string) => void;
    modelPreference: ModelPreference;
    setModelPreference: (prefs: ModelPreference) => void;
    t: (key: string) => string;
    clearKeysOnExit: boolean;
    setClearKeysOnExit: (v: boolean) => void;
    /** Per-key usage summary (optional) */
    usageSummary?: Map<string, KeyUsageSummary>;
    /** 动态模型选项（从 App.tsx 传入，基于用户 Key 计算） */
    dynamicModelOptions?: { text: string[]; image: string[]; video: string[] };
}

const providerBaseUrl: Record<AIProvider, string> = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    deepseek: 'https://api.deepseek.com/v1',
    siliconflow: 'https://api.siliconflow.cn/v1',
    keling: 'https://api.klingai.com/v1',
    flux: 'https://api.bfl.ml/v1',
    midjourney: 'https://api.midjourney.com/v1',
    runningHub: 'https://www.runninghub.cn/openapi/v2',
    minimax: 'https://api.minimax.chat/v1',
    volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
    openrouter: 'https://openrouter.ai/api/v1',
    openai_compatible: '',
    custom: '',
};

const capabilityLabels: Record<AICapability, string> = {
    text: 'LLM',
    image: '图片',
    video: '视频',
    agent: 'Agent',
};

const CREATIVE_CAPABILITIES: AICapability[] = ['text', 'image', 'video'];

type ProviderPreset = {
    id: string;
    name: string;
    shortName: string;
    provider: AIProvider;
    websiteUrl: string;
    baseUrl: string;
    capabilities: AICapability[];
    requestFormat: 'openai' | 'anthropic' | 'google' | 'native';
    authHeaderName?: string;
    authScheme?: string;
    defaultModel?: string;
    models?: string[];
    featured?: boolean;
};

const PROVIDER_PRESETS: ProviderPreset[] = [
    {
        id: 'custom',
        name: '自定义配置',
        shortName: '自',
        provider: 'custom',
        websiteUrl: '',
        baseUrl: '',
        capabilities: ['text', 'image'],
        requestFormat: 'openai',
        authHeaderName: 'Authorization',
        authScheme: 'Bearer',
        featured: true,
    },
    {
        id: 'claude-official',
        name: 'Claude Official',
        shortName: 'AI',
        provider: 'anthropic',
        websiteUrl: 'https://www.anthropic.com/claude-code',
        baseUrl: providerBaseUrl.anthropic,
        capabilities: ['text'],
        requestFormat: 'anthropic',
        authHeaderName: 'x-api-key',
        authScheme: '',
        defaultModel: 'claude-sonnet-4-6',
        models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    },
    {
        id: 'deepseek',
        name: 'DeepSeek',
        shortName: 'DS',
        provider: 'deepseek',
        websiteUrl: 'https://platform.deepseek.com',
        baseUrl: providerBaseUrl.deepseek,
        capabilities: ['text'],
        requestFormat: 'openai',
        defaultModel: 'deepseek-chat',
        models: ['deepseek-chat', 'deepseek-reasoner'],
    },
    {
        id: 'openai-gpt-image',
        name: 'OpenAI GPT Image 2',
        shortName: 'GI',
        provider: 'openai',
        websiteUrl: 'https://platform.openai.com/docs/guides/image-generation',
        baseUrl: providerBaseUrl.openai,
        capabilities: ['image'],
        requestFormat: 'openai',
        defaultModel: 'gpt-image-2',
        models: ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1'],
        featured: true,
    },
    {
        id: 'seedance-2',
        name: 'Seedance 2.0',
        shortName: 'S2',
        provider: 'volcengine',
        websiteUrl: 'https://console.volcengine.com/ark',
        baseUrl: providerBaseUrl.volcengine,
        capabilities: ['video'],
        requestFormat: 'openai',
        defaultModel: 'doubao-seedance-2.0',
        models: ['doubao-seedance-2.0', 'seedance-2.0', 'dreamina-seedance-2-0-260128', 'doubao-seedance-2-0-260128'],
        featured: true,
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        shortName: 'OR',
        provider: 'openrouter',
        websiteUrl: 'https://openrouter.ai',
        baseUrl: providerBaseUrl.openrouter,
        capabilities: ['text', 'image'],
        requestFormat: 'openai',
        defaultModel: 'openrouter/auto',
        models: ['openrouter/auto', 'anthropic/claude-sonnet-4-6', 'openai/gpt-image-2', 'openai/gpt-image-1', 'google/gemini-3-flash-preview'],
        featured: true,
    },
    {
        id: 'siliconflow',
        name: 'SiliconFlow',
        shortName: 'SF',
        provider: 'siliconflow',
        websiteUrl: 'https://siliconflow.cn',
        baseUrl: providerBaseUrl.siliconflow,
        capabilities: ['text', 'image'],
        requestFormat: 'openai',
        defaultModel: 'deepseek-ai/DeepSeek-V3',
        models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
    },
];

const ensureModelOption = (options: string[], model?: string) => {
    const trimmed = model?.trim();
    if (!trimmed) return options;
    return options.includes(trimmed) ? options : [trimmed, ...options];
};

export const CanvasSettings: React.FC<CanvasSettingsProps> = ({
    isOpen,
    onClose,
    language,
    setLanguage,
    themeMode,
    resolvedTheme,
    setThemeMode,
    wheelAction,
    setWheelAction,
    userApiKeys,
    onAddApiKey,
    onDeleteApiKey,
    onUpdateApiKey,
    onSetDefaultApiKey,
    modelPreference,
    setModelPreference,
    clearKeysOnExit,
    setClearKeysOnExit,
    usageSummary,
    dynamicModelOptions,
}) => {
    const [provider, setProvider] = React.useState<AIProvider>('openai');
    const [apiKey, setApiKey] = React.useState('');
    const [baseUrl, setBaseUrl] = React.useState(providerBaseUrl.openai);
    const [displayName, setDisplayName] = React.useState('');
    const [showKey, setShowKey] = React.useState(false);
    const [capabilities, setCapabilities] = React.useState<AICapability[]>(['image']);
    const [isValidating, setIsValidating] = React.useState(false);
    const [validationResult, setValidationResult] = React.useState<Awaited<ReturnType<typeof validateApiKey>> | null>(null);
    // 当前正在编辑的 API Key（null = 新增模式）
    const [editingKeyId, setEditingKeyId] = React.useState<string | null>(null);
    // 控制 API Key 添加/编辑弹窗
    const [showKeyModal, setShowKeyModal] = React.useState(false);
    // 模型管理
    const [editModels, setEditModels] = React.useState<ModelItem[]>([]);
    const [editDefaultModel, setEditDefaultModel] = React.useState('');
    const [newModelId, setNewModelId] = React.useState('');
    const [extraConfig, setExtraConfig] = React.useState<Record<string, string>>({});
    // 批量测试状态
    const [batchTestResults, setBatchTestResults] = React.useState<Record<string, { ok: boolean; message?: string }>>({});
    const [isBatchTesting, setIsBatchTesting] = React.useState(false);
    // 联网拉取模型
    const [fetchedModels, setFetchedModels] = React.useState<FetchedModel[]>([]);
    const [isFetchingModels, setIsFetchingModels] = React.useState(false);
    const [fetchError, setFetchError] = React.useState<string | null>(null);
    const [autoDetectedProvider, setAutoDetectedProvider] = React.useState<AIProvider | null>(null);
    const [endpointFlavor, setEndpointFlavor] = React.useState<'google' | 'openai-compatible' | 'openrouter-compatible' | null>(null);
    const [detectedCapabilities, setDetectedCapabilities] = React.useState<AICapability[]>([]);
    const [modelSearch, setModelSearch] = React.useState({ text: '', image: '', video: '' });

    const modelOptions = React.useMemo(() => ({
        text: ensureModelOption(
            dynamicModelOptions?.text?.length ? dynamicModelOptions.text : [
                ...(DEFAULT_PROVIDER_MODELS.google?.text || []),
                ...(DEFAULT_PROVIDER_MODELS.openai?.text || []),
                ...(DEFAULT_PROVIDER_MODELS.anthropic?.text || []),
                ...(DEFAULT_PROVIDER_MODELS.qwen?.text || []),
            ],
            modelPreference.textModel
        ),
        image: ensureModelOption(
            dynamicModelOptions?.image?.length ? dynamicModelOptions.image : [
                ...(DEFAULT_PROVIDER_MODELS.openai?.image || []),
                ...(DEFAULT_PROVIDER_MODELS.google?.image || []),
            ],
            modelPreference.imageModel
        ),
        video: ensureModelOption(
            dynamicModelOptions?.video?.length ? dynamicModelOptions.video : [
                ...(DEFAULT_PROVIDER_MODELS.volcengine?.video || []),
                ...(DEFAULT_PROVIDER_MODELS.google?.video || []),
            ],
            modelPreference.videoModel
        ),
    }), [dynamicModelOptions, modelPreference.imageModel, modelPreference.textModel, modelPreference.videoModel]);

    if (!isOpen) return null;

    const isDark = resolvedTheme === 'dark';
    const inputClass = 'isl-well w-full px-3 py-2.5 text-sm text-[var(--isl-ink)] outline-none placeholder:text-[var(--isl-ink-ghost)]';
    const chipClass = 'isl-chip px-3 py-2 text-sm';
    const sectionPanelClass = 'rounded-2xl border-[1.5px] border-[var(--isl-border)] bg-[var(--isl-surface-2)] p-3';

    const toggleCapability = (capability: AICapability) => {
        setCapabilities(prev =>
            prev.includes(capability)
                ? prev.filter(item => item !== capability)
                : [...prev, capability]
        );
    };

    const maskKey = (key: string) => {
        if (key.length < 10) return '****';
        return `${key.slice(0, 4)}****${key.slice(-4)}`;
    };

    const applyProviderPreset = (preset: ProviderPreset, options: { resetKey?: boolean; fillName?: boolean } = {}) => {
        const modelItems: ModelItem[] = (preset.models || []).map(id => ({ id, name: id }));
        const presetExtra: Record<string, string> = {
            requestFormat: preset.requestFormat,
            ...(preset.websiteUrl ? { websiteUrl: preset.websiteUrl } : {}),
            ...(preset.authHeaderName ? { authHeaderName: preset.authHeaderName } : {}),
            ...(preset.authScheme !== undefined ? { authScheme: preset.authScheme } : {}),
            ...(preset.provider === 'openrouter' ? { endpointFlavor: 'openrouter-compatible' } : {}),
            ...(preset.provider === 'custom' ? { endpointFlavor: 'openai-compatible' } : {}),
        };

        setProvider(preset.provider);
        setBaseUrl(preset.baseUrl);
        setCapabilities([...preset.capabilities]);
        setEditModels(modelItems);
        setEditDefaultModel(preset.defaultModel || modelItems[0]?.id || '');
        setExtraConfig(presetExtra);
        setEndpointFlavor(
            preset.provider === 'openrouter'
                ? 'openrouter-compatible'
                : preset.provider === 'custom'
                    ? 'openai-compatible'
                    : null
        );
        setDetectedCapabilities([...preset.capabilities]);
        setFetchedModels([]);
        setFetchError(null);
        setValidationResult(null);
        if (options.fillName) setDisplayName(preset.id === 'custom' ? '' : preset.name);
        if (options.resetKey) setApiKey('');
    };

    const handleProviderChange = (next: AIProvider) => {
        const preset = PROVIDER_PRESETS.find(item => item.provider === next && item.id !== 'custom');
        if (preset) {
            applyProviderPreset(preset);
            return;
        }
        setProvider(next);
        setBaseUrl(providerBaseUrl[next]);
        setCapabilities(inferCapabilitiesByProvider(next));
        setExtraConfig(prev => ({
            ...prev,
            requestFormat: next === 'anthropic' ? 'anthropic' : next === 'google' ? 'google' : 'openai',
            authHeaderName: next === 'anthropic' ? 'x-api-key' : 'Authorization',
            authScheme: next === 'anthropic' ? '' : 'Bearer',
        }));
        setEndpointFlavor(null);
        setDetectedCapabilities([]);
        setFetchError(null);
        // 自动填充该 provider 的预设模型
        const pm = DEFAULT_PROVIDER_MODELS[next];
        if (pm) {
            const models: ModelItem[] = [
                ...(pm.text || []).map(id => ({ id, name: id })),
                ...(pm.image || []).map(id => ({ id, name: id })),
                ...(pm.video || []).map(id => ({ id, name: id })),
                ...(pm.agent || []).map(id => ({ id, name: id })),
            ];
            setEditModels(models);
            setEditDefaultModel(models[0]?.id || '');
        } else {
            setEditModels([]);
            setEditDefaultModel('');
        }
    };

    const handleSaveKey = async () => {
        if (!apiKey.trim() || capabilities.length === 0) return;
        const requestedBaseUrl = baseUrl.trim() || undefined;

        // 先验证 key 是否有效
        setIsValidating(true);
        setValidationResult(null);
        const result = await validateApiKey(provider, apiKey.trim(), requestedBaseUrl, extraConfig);
        setIsValidating(false);
        setValidationResult(result);

        if (!result.ok) return; // 验证失败不保存

        const effectiveBaseUrl = result.effectiveBaseUrl
            || normalizeProviderBaseUrl(provider, requestedBaseUrl || providerBaseUrl[provider])
            || requestedBaseUrl;
        if (result.effectiveBaseUrl && result.effectiveBaseUrl !== baseUrl.trim()) {
            setBaseUrl(result.effectiveBaseUrl);
        }

        if (result.endpointFlavor) {
            setEndpointFlavor(result.endpointFlavor);
        }
        if (result.capabilitySummary?.length) {
            setDetectedCapabilities(result.capabilitySummary);
        }

        const detectedCaps = result.capabilitySummary || detectedCapabilities;
        const unsupportedCapabilities = detectedCaps.length > 0
            ? capabilities.filter(capability => !detectedCaps.includes(capability))
            : [];
        if (unsupportedCapabilities.length > 0) {
            setValidationResult({
                ok: false,
                message: `当前端点不支持：${unsupportedCapabilities.map(cap => capabilityLabels[cap]).join(' / ')}。可用能力只有：${detectedCaps.map(cap => capabilityLabels[cap]).join(' / ')}`,
            });
            return;
        }

        const modelsToSave = editModels.length > 0 ? editModels : undefined;
        const customModelsToSave = editModels.map(m => m.id);
        const fallbackEndpointFlavor = provider === 'custom'
            ? (result.endpointFlavor || endpointFlavor || (/openrouter/i.test(baseUrl) ? 'openrouter-compatible' : 'openai-compatible'))
            : undefined;
        const extraToSave = Object.keys(extraConfig).length > 0 || fallbackEndpointFlavor
            ? { ...extraConfig, ...(fallbackEndpointFlavor && !extraConfig.endpointFlavor ? { endpointFlavor: fallbackEndpointFlavor } : {}) }
            : undefined;

        if (editingKeyId) {
            // 编辑模式：更新已有 Key
            onUpdateApiKey(editingKeyId, {
                provider,
                capabilities,
                key: apiKey.trim(),
                baseUrl: effectiveBaseUrl || undefined,
                name: displayName.trim() || undefined,
                status: 'ok',
                models: modelsToSave,
                customModels: customModelsToSave.length > 0 ? customModelsToSave : undefined,
                defaultModel: editDefaultModel || undefined,
                extraConfig: extraToSave,
            });
        } else {
            // 新增模式
            onAddApiKey({
                provider,
                capabilities,
                key: apiKey.trim(),
                baseUrl: effectiveBaseUrl || undefined,
                name: displayName.trim() || undefined,
                status: 'ok',
                isDefault: false,
                models: modelsToSave,
                customModels: customModelsToSave.length > 0 ? customModelsToSave : undefined,
                defaultModel: editDefaultModel || undefined,
                extraConfig: extraToSave,
            });
        }
        handleCancelEdit();
    };

    /** 点击已有 Key 的"编辑"按钮 — 将其字段填入表单并打开弹窗 */
    const handleStartEdit = (item: UserApiKey) => {
        setEditingKeyId(item.id);
        setProvider(item.provider);
        setApiKey(item.key);
        setBaseUrl(item.baseUrl || providerBaseUrl[item.provider]);
        setDisplayName(item.name || '');
        setCapabilities(item.capabilities?.length ? [...item.capabilities] : inferCapabilitiesByProvider(item.provider));
        setEditModels(item.models || (item.customModels || []).map(id => ({ id, name: id })));
        setEditDefaultModel(item.defaultModel || '');
        setExtraConfig(item.extraConfig || {});
        setEndpointFlavor((item.extraConfig?.endpointFlavor as 'google' | 'openai-compatible' | 'openrouter-compatible' | undefined) || null);
        setDetectedCapabilities(item.capabilities?.length ? [...item.capabilities] : []);
        setValidationResult(null);
        setShowKeyModal(true);
    };

    /** 取消编辑 / 重置表单并关闭弹窗 */
    const handleCancelEdit = () => {
        setEditingKeyId(null);
        setApiKey('');
        setDisplayName('');
        setEditModels([]);
        setEditDefaultModel('');
        setNewModelId('');
        setExtraConfig({});
        setValidationResult(null);
        setFetchedModels([]);
        setFetchError(null);
        setAutoDetectedProvider(null);
        setEndpointFlavor(null);
        setDetectedCapabilities([]);
        setShowKeyModal(false);
    };

    /** 联网拉取当前 Provider 可用的模型列表 */
    const handleFetchModels = async (targetProvider: AIProvider, targetKey: string, targetBaseUrl?: string) => {
        if (!targetKey.trim()) return;
        setIsFetchingModels(true);
        setFetchError(null);
        const requestFormat = targetProvider === 'custom' ? extraConfig.requestFormat : undefined;
        if (requestFormat === 'anthropic' || requestFormat === 'native') {
            setFetchedModels([]);
            setFetchError(requestFormat === 'native'
                ? '供应商原生接口通常不提供公开模型列表，请手动添加模型 ID。'
                : 'Anthropic Messages 格式通常不提供公开模型列表，请手动添加模型 ID。');
            setIsFetchingModels(false);
            return;
        }
        const fetchProvider: AIProvider = requestFormat === 'google' ? 'google' : targetProvider;
        try {
            const result = await fetchModelsForProvider(fetchProvider, targetKey.trim(), targetBaseUrl?.trim() || undefined);
            if (result.ok && result.models.length > 0) {
                setFetchedModels(result.models);
                setEndpointFlavor(result.endpointFlavor || null);
                setDetectedCapabilities(result.capabilitySummary || []);
                if (result.effectiveBaseUrl) {
                    setBaseUrl(result.effectiveBaseUrl);
                }
                // 自动填充到编辑模型列表
                const modelItems: ModelItem[] = result.models.map(m => ({ id: m.id, name: m.name || m.id }));
                setEditModels(modelItems);
                if (modelItems.length > 0) setEditDefaultModel(modelItems[0].id);
                // 自动推断 capabilities
                const caps = new Set<AICapability>();
                for (const m of result.models) caps.add(m.capability);
                if (caps.size > 0) setCapabilities(Array.from(caps));
                if (result.endpointFlavor) {
                    setExtraConfig(prev => ({ ...prev, endpointFlavor: result.endpointFlavor }));
                }
            } else if (!result.ok) {
                setFetchError(result.error || '拉取失败');
            }
        } catch {
            setFetchError('网络错误');
        }
        setIsFetchingModels(false);
    };

    /** API Key 粘贴自动检测 Provider + 拉取模型 */
    const handleKeyPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        const pasted = e.clipboardData.getData('text');
        if (pasted) {
            const detected = inferProviderFromKey(pasted);
            if (detected) {
                setAutoDetectedProvider(detected);
                if (detected !== provider) {
                    handleProviderChange(detected);
                }
                // 自动拉取模型
                const targetBaseUrl = detected !== provider ? providerBaseUrl[detected] : baseUrl;
                handleFetchModels(detected, pasted, targetBaseUrl);
            }
        }
    };

    /** 添加模型到当前编辑列表 */
    const handleAddModel = () => {
        const id = newModelId.trim();
        if (!id || editModels.some(m => m.id === id)) return;
        const next = [...editModels, { id, name: id }];
        setEditModels(next);
        if (!editDefaultModel) setEditDefaultModel(id);
        setNewModelId('');
    };

    /** 删除模型 */
    const handleRemoveModel = (id: string) => {
        const next = editModels.filter(m => m.id !== id);
        setEditModels(next);
        if (editDefaultModel === id) setEditDefaultModel(next[0]?.id || '');
    };

    const updateExtraConfig = (key: string, value: string) => {
        setExtraConfig(prev => {
            const next = { ...prev };
            const normalized = value.trim();
            if (normalized) {
                next[key] = normalized;
            } else {
                delete next[key];
            }
            return next;
        });
    };

    /** 导出所有 API Key 配置为 JSON */
    const handleExportKeys = () => {
        const exportData = userApiKeys.map(k => ({
            provider: k.provider,
            name: k.name,
            baseUrl: k.baseUrl,
            capabilities: k.capabilities,
            customModels: k.customModels,
            defaultModel: k.defaultModel,
            models: k.models,
            extraConfig: k.extraConfig,
            key: '***', // 不导出明文 key
        }));
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flovart-api-configs-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    /** 导入 JSON 配置文件 */
    const handleImportKeys = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                if (!Array.isArray(parsed)) throw new Error('格式错误');
                for (const item of parsed) {
                    if (!item.provider || !item.key || item.key === '***') continue;
                    onAddApiKey({
                        provider: item.provider,
                        capabilities: item.capabilities || inferCapabilitiesByProvider(item.provider),
                        key: item.key,
                        baseUrl: item.baseUrl,
                        name: item.name,
                        status: 'unknown',
                        isDefault: false,
                        customModels: item.customModels,
                        defaultModel: item.defaultModel,
                        models: item.models,
                        extraConfig: item.extraConfig,
                    });
                }
            } catch {
                alert('导入失败：文件格式不正确');
            }
        };
        input.click();
    };

    /** 带 Key 导出（含明文，用于设备迁移） */
    const handleExportKeysWithSecrets = () => {
        if (!confirm('导出将包含明文 API Key，请妥善保管导出文件！')) return;
        const exportData = userApiKeys.map(k => ({
            provider: k.provider,
            name: k.name,
            key: k.key,
            baseUrl: k.baseUrl,
            capabilities: k.capabilities,
            customModels: k.customModels,
            defaultModel: k.defaultModel,
            models: k.models,
            extraConfig: k.extraConfig,
        }));
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flovart-api-configs-full-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    /** 一键测试所有 Key */
    const handleBatchTest = async () => {
        setIsBatchTesting(true);
        setBatchTestResults({});
        const results: Record<string, { ok: boolean; message?: string }> = {};
        for (const item of userApiKeys) {
            const result = await validateApiKey(item.provider, item.key, item.baseUrl, item.extraConfig);
            results[item.id] = result;
            onUpdateApiKey(item.id, { status: result.ok ? 'ok' : 'error' });
            setBatchTestResults({ ...results });
        }
        setIsBatchTesting(false);
    };

    return (
        <div className="theme-aware fixed inset-0 z-100 flex items-center justify-center bg-black/35 backdrop-blur-sm" onClick={onClose}>
            <div
                className="isl-shell relative max-h-[88vh] w-[92%] max-w-170 overflow-y-auto p-6"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h3 className="text-xl font-extrabold text-[var(--isl-ink)]">设置</h3>
                        <p className="mt-1 text-sm text-[var(--isl-ink-soft)]">
                            管理主题模式、交互方式、API 能力和默认模型。
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className={`flex h-10 w-10 items-center justify-center rounded-2xl border transition ${
                            isDark ? 'border-[#2A3140] text-[#98A2B3] hover:bg-[#1B2029]' : 'border-[#E4E7EC] text-[#667085] hover:bg-[#F9FAFB]'
                        }`}
                    >
                        ×
                    </button>
                </div>

                <div className="space-y-6">
                    <section className="space-y-3">
                        <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                            界面主题
                        </div>
                        <div className="grid gap-3 md:grid-cols-3">
                            {([
                                ['light', '浅色模式', '明亮白板与柔和面板'],
                                ['dark', '黑夜模式', '深色工作台与高对比内容'],
                                ['system', '跟随系统', '自动跟随设备主题'],
                            ] as Array<[ThemeMode, string, string]>).map(([mode, title, description]) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setThemeMode(mode)}
                                    className={`rounded-3xl border-[1.5px] p-4 text-left transition ${
                                        themeMode === mode
                                            ? 'border-[var(--isl-mint)] bg-[var(--isl-mint-bg)]'
                                            : 'border-[var(--isl-border)] bg-[var(--isl-surface-2)] hover:border-[var(--isl-border-strong)]'
                                    }`}
                                >
                                    <div className="mb-3 flex items-center justify-between">
                                        <div className="text-sm font-bold text-[var(--isl-ink)]">{title}</div>
                                        {themeMode === mode && (
                                            <span className="rounded-full bg-[var(--isl-mint)] px-2 py-1 text-[11px] font-bold text-white">
                                                当前
                                            </span>
                                        )}
                                    </div>
                                    <div className="mb-4 text-xs text-[var(--isl-ink-soft)]">{description}</div>
                                    <div className={`grid h-16 grid-cols-[1fr_56px] gap-2 rounded-2xl p-2 ${
                                        mode === 'dark' || (mode === 'system' && resolvedTheme === 'dark')
                                            ? 'bg-[#0F141C]'
                                            : 'bg-white'
                                    }`}>
                                        <div className={`rounded-xl border ${
                                            mode === 'dark' || (mode === 'system' && resolvedTheme === 'dark')
                                                ? 'border-[#2A3140] bg-[#161A22]'
                                                : 'border-[#E4E7EC] bg-[#F8FAFC]'
                                        }`} />
                                        <div className={`rounded-xl border ${
                                            mode === 'dark' || (mode === 'system' && resolvedTheme === 'dark')
                                                ? 'border-[#2A3140] bg-[#12151B]'
                                                : 'border-[#E4E7EC] bg-white'
                                        }`} />
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className="space-y-3">
                        <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                            语言与交互
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                            <div className={`rounded-2xl p-3 ${isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]'}`}>
                                <div className={`mb-2 text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>语言</div>
                                <div className={`inline-flex w-full rounded-full border p-1 ${isDark ? 'border-[#2A3140] bg-[#12151B]' : 'border-[#E4E7EC] bg-white'}`}>
                                    {([
                                        ['en', 'English'],
                                        ['zho', '中文'],
                                    ] as Array<['en' | 'zho', string]>).map(([value, label]) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => setLanguage(value)}
                                            className={`flex-1 rounded-full px-3 py-2 text-sm transition ${
                                                language === value
                                                    ? isDark
                                                        ? 'bg-[#F3F4F6] text-[#111827]'
                                                        : 'bg-[#111827] text-white'
                                                    : isDark
                                                        ? 'text-[#98A2B3]'
                                                        : 'text-[#667085]'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className={`rounded-2xl p-3 ${isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]'}`}>
                                <div className={`mb-2 text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>滚轮行为</div>
                                <div className={`inline-flex w-full rounded-full border p-1 ${isDark ? 'border-[#2A3140] bg-[#12151B]' : 'border-[#E4E7EC] bg-white'}`}>
                                    {([
                                        ['zoom', '缩放'],
                                        ['pan', '平移'],
                                    ] as Array<[WheelAction, string]>).map(([value, label]) => (
                                        <button
                                            key={value}
                                            type="button"
                                            onClick={() => setWheelAction(value)}
                                            className={`flex-1 rounded-full px-3 py-2 text-sm transition ${
                                                wheelAction === value
                                                    ? isDark
                                                        ? 'bg-[#F3F4F6] text-[#111827]'
                                                        : 'bg-[#111827] text-white'
                                                    : isDark
                                                        ? 'text-[#98A2B3]'
                                                        : 'text-[#667085]'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* ── 统一 API 配置管理 ───────────────────────── */}
                    <section className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                                🔑 API 配置
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleImportKeys}
                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                                        isDark ? 'border-[#2A3140] text-[#98A2B3] hover:bg-[#252C39]' : 'border-[#E4E7EC] text-[#667085] hover:bg-[#F2F4F7]'
                                    }`}
                                >
                                    导入
                                </button>
                                <button
                                    type="button"
                                    onClick={handleExportKeysWithSecrets}
                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                                        isDark ? 'border-[#2A3140] text-[#98A2B3] hover:bg-[#252C39]' : 'border-[#E4E7EC] text-[#667085] hover:bg-[#F2F4F7]'
                                    }`}
                                >
                                    导出
                                </button>
                                {userApiKeys.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={handleBatchTest}
                                        disabled={isBatchTesting}
                                        className="isl-chip px-2.5 py-1 text-[11px] disabled:opacity-50"
                                    >
                                        {isBatchTesting ? '测试中...' : '全部测试'}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEditingKeyId(null);
                                        setDisplayName('');
                                        applyProviderPreset(PROVIDER_PRESETS.find(preset => preset.id === 'openai-gpt-image') || PROVIDER_PRESETS[0], { resetKey: true });
                                        setShowKeyModal(true);
                                    }}
                                    className="isl-chip isl-chip--active px-3 py-1.5 text-xs"
                                >
                                    + 添加供应商
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            {userApiKeys.length === 0 ? (
                                <div className={`rounded-2xl border border-dashed px-4 py-6 text-center text-sm ${
                                    isDark ? 'border-[#3A4458] text-[#98A2B3]' : 'border-[#D0D5DD] text-[#667085]'
                                }`}>
                                    <div className="mb-2 text-lg">🔑</div>
                                    <div className="font-medium">还没有配置供应商</div>
                                    <div className="mt-1 text-xs">点击右上方「+ 添加供应商」按钮开始配置第三方 API Key</div>
                                </div>
                            ) : (
                                userApiKeys.map(item => (
                                    <div key={item.id} className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${
                                        editingKeyId === item.id
                                            ? isDark ? 'border-[#4B5B78] bg-[#1B2330]' : 'border-[#1D4ED8] bg-[#EFF6FF]'
                                            : isDark ? 'border-[#2A3140] bg-[#161A22]' : 'border-[#E4E7EC] bg-white'
                                    }`}>
                                        <div className="flex min-w-0 items-start gap-3">
                                            <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border text-sm font-semibold ${
                                                isDark ? 'border-[#2A3140] bg-[#12151B] text-[#98A2B3]' : 'border-[#E4E7EC] bg-[#F8FAFC] text-[#667085]'
                                            }`}>
                                                {(item.name || PROVIDER_LABELS[item.provider] || item.provider).slice(0, 2).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className={`inline-block h-2 w-2 rounded-full ${
                                                    item.status === 'ok' ? 'bg-green-500' : item.status === 'error' ? 'bg-red-400' : 'bg-yellow-400'
                                                }`} title={item.status === 'ok' ? '已验证' : item.status === 'error' ? '验证失败' : '未验证'} />
                                                <span className={`truncate text-sm font-medium ${isDark ? 'text-[#F3F4F6]' : 'text-[#101828]'}`}>{item.name || PROVIDER_LABELS[item.provider] || item.provider}</span>
                                                {editingKeyId === item.id && (
                                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                                        isDark ? 'bg-[#1B2330] text-[#7CB4FF]' : 'bg-[#EFF6FF] text-[#1D4ED8]'
                                                    }`}>编辑中</span>
                                                )}
                                            </div>
                                            <div className={`mt-1 truncate text-xs ${isDark ? 'text-[#7CB4FF]' : 'text-[#175CD3]'}`}>
                                                {item.extraConfig?.websiteUrl || item.baseUrl || '本地供应商配置'}
                                            </div>
                                            <div className={`mt-1 text-[11px] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                                                {maskKey(item.key)}
                                                {item.extraConfig?.requestFormat && <span> · {item.extraConfig.requestFormat}</span>}
                                                {item.defaultModel && <span> · 默认 {item.defaultModel}</span>}
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {(item.capabilities || []).map(capability => (
                                                    <span key={capability} className={`rounded-full px-2 py-1 text-[11px] ${
                                                        isDark ? 'bg-[#1B2029] text-[#98A2B3]' : 'bg-[#F2F4F7] text-[#667085]'
                                                    }`}>
                                                        {capabilityLabels[capability]}
                                                    </span>
                                                ))}
                                            </div>
                                            {/* Usage stats */}
                                            {usageSummary?.get(item.id) && (() => {
                                                const u = usageSummary.get(item.id)!;
                                                if (u.totalCalls === 0) return null;
                                                return (
                                                    <div className={`mt-1.5 flex gap-3 text-[10px] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                                                        <span>调用 {u.totalCalls} 次</span>
                                                        {u.errorCalls > 0 && <span className="text-red-400">失败 {u.errorCalls}</span>}
                                                        <span>≈ {formatCost(u.totalCostCents)}</span>
                                                        <span>24h: {u.last24h}</span>
                                                    </div>
                                                );
                                            })()}
                                            </div>
                                        </div>
                                        <div className="ml-3 flex items-center gap-2">
                                            {!item.isDefault ? (
                                                <button type="button" onClick={() => onSetDefaultApiKey(item.id)} className={`${chipClass} flv-elastic`}>
                                                    设为默认
                                                </button>
                                            ) : (
                                                <span className={`rounded-full px-3 py-2 text-xs font-medium ${
                                                    isDark ? 'bg-[#123524] text-[#75E0A7]' : 'bg-[#ECFDF3] text-[#027A48]'
                                                }`}>
                                                    默认
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handleStartEdit(item)}
                                                className={`rounded-full border px-3 py-2 text-xs font-medium ${
                                                    isDark ? 'border-[#2A3140] text-[#D0D5DD] hover:bg-[#252C39]' : 'border-[#E4E7EC] text-[#475467] hover:bg-[#F2F4F7]'
                                                }`}
                                            >
                                                编辑
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (!confirm(`确定删除 ${item.name || PROVIDER_LABELS[item.provider] || item.provider} 吗？`)) return;
                                                    onDeleteApiKey(item.id);
                                                }}
                                                className={`rounded-full border px-3 py-2 text-xs font-medium ${
                                                    isDark ? 'border-[#7A271A] text-[#FDA29B]' : 'border-[#FECACA] text-[#DC2626]'
                                                }`}
                                            >
                                                删除
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>

                    <section className="space-y-3">
                        <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                            模型偏好
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                            <label className={`rounded-2xl p-3 ${isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]'}`}>
                                <div className={`mb-2 text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>LLM 润色模型</div>
                                <input
                                    type="text"
                                    placeholder="搜索模型..."
                                    value={modelSearch.text}
                                    onChange={(e) => setModelSearch(s => ({ ...s, text: e.target.value }))}
                                    className={`mb-2 ${inputClass} flv-safe-input text-xs`}
                                />
                                <select value={modelPreference.textModel} onChange={(event) => setModelPreference({ ...modelPreference, textModel: event.target.value })} className={`${inputClass} flv-safe-input`}>
                                    {modelOptions.text
                                        .filter(model => !modelSearch.text || modelRefSearchText(model, userApiKeys).includes(modelSearch.text.toLowerCase()))
                                        .map(model => <option key={model} value={model}>{modelRefLabel(model, userApiKeys)}</option>)}
                                </select>
                            </label>
                            <label className={`rounded-2xl p-3 ${isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]'}`}>
                                <div className={`mb-2 text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>图片模型</div>
                                <input
                                    type="text"
                                    placeholder="搜索模型..."
                                    value={modelSearch.image}
                                    onChange={(e) => setModelSearch(s => ({ ...s, image: e.target.value }))}
                                    className={`mb-2 ${inputClass} flv-safe-input text-xs`}
                                />
                                <select value={modelPreference.imageModel} onChange={(event) => setModelPreference({ ...modelPreference, imageModel: event.target.value })} className={`${inputClass} flv-safe-input`}>
                                    {modelOptions.image
                                        .filter(model => !modelSearch.image || modelRefSearchText(model, userApiKeys).includes(modelSearch.image.toLowerCase()))
                                        .map(model => <option key={model} value={model}>{modelRefLabel(model, userApiKeys)}</option>)}
                                </select>
                            </label>
                            <label className={`rounded-2xl p-3 ${isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]'}`}>
                                <div className={`mb-2 text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>视频模型</div>
                                <input
                                    type="text"
                                    placeholder="搜索模型..."
                                    value={modelSearch.video}
                                    onChange={(e) => setModelSearch(s => ({ ...s, video: e.target.value }))}
                                    className={`mb-2 ${inputClass} flv-safe-input text-xs`}
                                />
                                <select value={modelPreference.videoModel} onChange={(event) => setModelPreference({ ...modelPreference, videoModel: event.target.value })} className={`${inputClass} flv-safe-input`}>
                                    {modelOptions.video
                                        .filter(model => !modelSearch.video || modelRefSearchText(model, userApiKeys).includes(modelSearch.video.toLowerCase()))
                                        .map(model => <option key={model} value={model}>{modelRefLabel(model, userApiKeys)}</option>)}
                                </select>
                            </label>
                        </div>
                    </section>

                    {/* Security section */}
                    <section className="space-y-3">
                        <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                            🔒 安全
                        </div>
                        <div className={`flex items-center justify-between rounded-2xl p-4 ${isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]'}`}>
                            <div>
                                <div className={`text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>关闭页面时清除 API Key</div>
                                <div className={`mt-1 text-xs ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>启用后每次关闭浏览器标签页将自动清除保存的 API Key，下次访问需重新输入</div>
                            </div>
                            <label className="ml-4 inline-flex shrink-0 cursor-pointer items-center">
                                <input
                                    type="checkbox"
                                    className="sr-only"
                                    checked={clearKeysOnExit}
                                    onChange={(event) => setClearKeysOnExit(event.target.checked)}
                                    aria-label="关闭页面时清除 API Key"
                                    title="关闭页面时清除 API Key"
                                />
                                <span
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                        clearKeysOnExit
                                            ? 'bg-green-500'
                                            : isDark ? 'bg-[#3A4458]' : 'bg-[#D0D5DD]'
                                    }`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${clearKeysOnExit ? 'translate-x-6' : 'translate-x-1'}`} />
                                </span>
                            </label>
                        </div>
                        <div className={`rounded-2xl border p-3 text-xs ${isDark ? 'border-[#2A3140] text-[#667085]' : 'border-[#E4E7EC] text-[#98A2B3]'}`}>
                            ✅ API Key 已加密存储（AES-GCM），不再以明文保留在 localStorage 中。
                        </div>
                    </section>
                </div>
            </div>

            {/* API Key 添加/编辑弹窗（统一版） */}
            {showKeyModal && (
                <div className="fixed inset-0 z-150 overflow-y-auto bg-black/40 backdrop-blur-sm" onClick={handleCancelEdit}>
                    <div className="flex min-h-[100dvh] items-end justify-center p-2 sm:min-h-full sm:items-center sm:p-6">
                    <div
                        className="isl-shell relative flex min-h-0 max-h-[calc(100dvh-1rem)] w-full max-w-140 flex-col overflow-hidden sm:max-h-[calc(100dvh-3rem)]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="mb-0 flex items-center justify-between px-6 pb-4 pt-6">
                            <h4 className="text-base font-extrabold text-[var(--isl-ink)]">
                                {editingKeyId ? '编辑供应商' : '添加新供应商'}
                            </h4>
                            <button type="button" title="关闭 API Key 表单" aria-label="关闭 API Key 表单" onClick={handleCancelEdit} className="rounded-full p-1.5 text-[var(--isl-ink-soft)] transition hover:bg-black/5">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-4">
                            {/* 预设供应商 */}
                            {!editingKeyId && (
                                <div className={sectionPanelClass}>
                                    <div className="mb-3 flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-sm font-bold text-[var(--isl-ink)]">预设供应商</div>
                                            <div className="mt-0.5 text-[11px] text-[var(--isl-ink-soft)]">选择后会自动填充请求地址、API 格式、认证字段和常用模型</div>
                                        </div>
                                        <div className="shrink-0 rounded-full bg-[var(--isl-card)] px-2.5 py-1 text-[11px] text-[var(--isl-ink-soft)]">
                                            可继续手动修改
                                        </div>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        {PROVIDER_PRESETS.map(preset => {
                                            const presetActive = provider === preset.provider && (displayName === preset.name || (preset.id === 'custom' && !displayName));
                                            const rainbowStyle: React.CSSProperties = {
                                                background: presetActive
                                                    ? 'linear-gradient(135deg, rgba(255,75,145,.92), rgba(124,92,255,.92) 42%, rgba(0,214,255,.92) 72%, rgba(64,225,139,.92))'
                                                    : 'linear-gradient(135deg, rgba(255,255,255,.9), rgba(255,75,145,.13), rgba(124,92,255,.14), rgba(0,214,255,.13), rgba(64,225,139,.12))',
                                                borderColor: presetActive ? 'rgba(255,255,255,.45)' : 'rgba(124,92,255,.22)',
                                                color: presetActive ? '#fff' : 'var(--isl-ink)',
                                                boxShadow: presetActive ? '0 10px 28px rgba(124,92,255,.24)' : '0 6px 18px rgba(31,29,26,.08)',
                                            };
                                            return (
                                            <button
                                                key={preset.id}
                                                type="button"
                                                onClick={() => applyProviderPreset(preset, { fillName: true })}
                                                className="flex min-h-[54px] items-center gap-2 rounded-2xl border px-3 py-2 text-left text-sm transition hover:-translate-y-0.5"
                                                style={rainbowStyle}
                                            >
                                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/70 text-[11px] font-black text-[#4F46E5]">
                                                    {preset.shortName}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate font-bold">{preset.name}</span>
                                                    <span className="mt-0.5 block truncate text-[11px] opacity-75">{preset.defaultModel || preset.provider}</span>
                                                </span>
                                                {preset.featured && (
                                                    <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold text-[#7C3AED]">
                                                        推荐
                                                    </span>
                                                )}
                                            </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <div className="grid gap-3 md:grid-cols-2">
                                <label>
                                    <span className="mb-1.5 block text-sm font-bold text-[var(--isl-ink)]">供应商名称</span>
                                    <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：Claude 官方" className={inputClass} />
                                </label>
                                <label>
                                    <span className="mb-1.5 block text-sm font-bold text-[var(--isl-ink)]">备注</span>
                                    <input value={extraConfig.remark || ''} onChange={(event) => updateExtraConfig('remark', event.target.value)} placeholder="例如：公司专用账号" className={inputClass} />
                                </label>
                            </div>

                            <label className="block">
                                <span className="mb-1.5 block text-sm font-bold text-[var(--isl-ink)]">官网链接</span>
                                <input value={extraConfig.websiteUrl || ''} onChange={(event) => updateExtraConfig('websiteUrl', event.target.value)} placeholder="https://example.com（可选）" className={inputClass} />
                            </label>

                            <div className="flex gap-2">
                                <label className="min-w-0 flex-1">
                                    <span className={`mb-1.5 block text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>API Key</span>
                                    <input
                                        value={apiKey}
                                        onChange={(event) => setApiKey(event.target.value)}
                                        onPaste={handleKeyPaste}
                                        type={showKey ? 'text' : 'password'}
                                        placeholder="只需要填这里，下方配置会自动填充"
                                        className={`${inputClass} flv-safe-input`}
                                        autoFocus
                                    />
                                </label>
                                <button type="button" onClick={() => setShowKey(prev => !prev)} className={`${chipClass} flv-elastic`}>
                                    {showKey ? '隐藏' : '显示'}
                                </button>
                            </div>

                            {/* 自动识别结果提示 */}
                            {autoDetectedProvider && (
                                <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
                                    isDark ? 'bg-[#1B2330] text-[#7CB4FF]' : 'bg-[#EFF6FF] text-[#1D4ED8]'
                                }`}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                                    自动识别为 <strong>{PROVIDER_LABELS[autoDetectedProvider]}</strong>
                                    {isFetchingModels && <span className="ml-1 animate-pulse">正在拉取模型列表...</span>}
                                </div>
                            )}

                            {endpointFlavor && (
                                <div className={`rounded-xl px-3 py-2 text-xs ${
                                    isDark ? 'bg-[#161A22] text-[#D0D5DD]' : 'bg-[#F8FAFC] text-[#475467]'
                                }`}>
                                    兼容端点识别：
                                    <strong className="ml-1">
                                        {endpointFlavor === 'openrouter-compatible'
                                            ? 'OpenRouter 风格'
                                            : endpointFlavor === 'openai-compatible'
                                                ? 'OpenAI 兼容风格'
                                                : 'Google 原生风格'}
                                    </strong>
                                    {detectedCapabilities.length > 0 && (
                                        <span className="ml-2">
                                            能力：{detectedCapabilities.map(cap => capabilityLabels[cap]).join(' / ')}
                                        </span>
                                    )}
                                    {fetchedModels.length > 0 && <span className="ml-2">已识别 {fetchedModels.length} 个模型</span>}
                                </div>
                            )}

                            <label className="block">
                                <span className={`mb-1.5 block text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>请求地址</span>
                                <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://your-api-endpoint.com" className={`${inputClass} flv-safe-input`} />
                            </label>

                            {provider === 'custom' && (
                                <div className={`rounded-xl px-3 py-2 text-xs ${isDark ? 'bg-[#161A22] text-[#98A2B3]' : 'bg-[#F8FAFC] text-[#667085]'}`}>
                                    兼容说明：模型列表默认探测 <strong>/v1/models</strong>，图片走 <strong>/v1/images/generations</strong>，部分聚合端点的视频会自动尝试 <strong>/v2/videos/generations</strong>。
                                </div>
                            )}

                            <div>
                                <div className={`mb-2 flex items-center justify-between`}>
                                    <span className={`text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>这个 API 用于</span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {CREATIVE_CAPABILITIES.map(capability => (
                                        <button
                                            key={capability}
                                            type="button"
                                            onClick={() => toggleCapability(capability)}
                                            className={`rounded-full border px-3 py-2 text-sm font-medium transition ${
                                                capabilities.includes(capability)
                                                    ? isDark
                                                        ? 'border-blue-500 bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30'
                                                        : 'border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                                                    : isDark
                                                        ? 'border-[#2A3140] bg-[#1B2029] text-[#667085] hover:bg-[#252C39]'
                                                        : 'border-[#E4E7EC] bg-[#F8FAFC] text-[#98A2B3] hover:bg-[#F2F4F7]'
                                            }`}
                                        >
                                            {capabilities.includes(capability) ? '✓ ' : ''}{capabilityLabels[capability]}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 模型管理 */}
                            <div>
                                <div className={`mb-2 flex items-center justify-between`}>
                                    <span className={`text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>模型列表</span>
                                    <button
                                        type="button"
                                        disabled={!apiKey.trim() || isFetchingModels}
                                        onClick={() => handleFetchModels(provider, apiKey, baseUrl)}
                                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-40 ${
                                            isDark ? 'border-[#4B5B78] text-[#7CB4FF] hover:bg-[#1B2330]' : 'border-[#B2CCFF] text-[#175CD3] hover:bg-[#EEF4FF]'
                                        }`}
                                    >
                                        {isFetchingModels ? '拉取中...' : '🔄 获取模型'}
                                    </button>
                                </div>
                                {fetchError && (
                                    <div className={`mb-2 rounded-xl px-3 py-1.5 text-xs ${isDark ? 'bg-[#3A1616] text-[#FDA29B]' : 'bg-[#FEF3F2] text-[#B42318]'}`}>
                                        拉取模型失败：{fetchError}（可手动添加模型）
                                    </div>
                                )}
                                {editModels.length > 0 && (
                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                        {editModels.map(m => (
                                            <span key={m.id} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] ${
                                                editDefaultModel === m.id
                                                    ? isDark ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40' : 'bg-blue-50 text-blue-600 border border-blue-200'
                                                    : isDark ? 'bg-[#1B2029] text-[#98A2B3]' : 'bg-[#F2F4F7] text-[#667085]'
                                            }`}>
                                                <button type="button" onClick={() => setEditDefaultModel(m.id)} title="设为默认">{m.name || m.id}</button>
                                                <button type="button" onClick={() => handleRemoveModel(m.id)} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <input
                                        value={newModelId}
                                        onChange={(e) => setNewModelId(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddModel(); } }}
                                        placeholder="输入模型 ID 并回车添加"
                                        className={`${inputClass} flv-safe-input`}
                                    />
                                    <button type="button" onClick={handleAddModel} className={`${chipClass} flv-elastic`}>添加</button>
                                </div>
                                {editModels.length > 0 && (
                                    <div className={`mt-1.5 text-[11px] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                                        点击模型名称设为默认（蓝色高亮），点击 × 删除
                                    </div>
                                )}
                            </div>

                            {/* extraConfig（如 Google Veo projectId） */}
                            <div>
                                <div className={`mb-2 flex items-center justify-between`}>
                                    <span className={`text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>高级配置</span>
                                    <span className={`text-[11px] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>第三方兼容端点可选</span>
                                </div>
                                <div className="grid gap-2 md:grid-cols-2">
                                    <div className={`md:col-span-2 text-xs font-semibold ${isDark ? 'text-[#98A2B3]' : 'text-[#667085]'}`}>API 格式</div>
                                    <select
                                        value={extraConfig.requestFormat || ''}
                                        onChange={(e) => updateExtraConfig('requestFormat', e.target.value)}
                                        className={`${inputClass} flv-safe-input`}
                                        title="API 格式"
                                        aria-label="API 格式"
                                    >
                                        <option value="">自动识别 API 格式</option>
                                        <option value="native">供应商原生 / 专用接口</option>
                                        <option value="openai">OpenAI Compatible</option>
                                        <option value="anthropic">Anthropic</option>
                                        <option value="google">Google Gemini</option>
                                    </select>
                                    <input
                                        value={extraConfig.authHeaderName || ''}
                                        onChange={(e) => updateExtraConfig('authHeaderName', e.target.value)}
                                        placeholder="认证字段，如 Authorization / x-api-key"
                                        className={`${inputClass} flv-safe-input`}
                                    />
                                    <input
                                        value={extraConfig.authScheme || ''}
                                        onChange={(e) => updateExtraConfig('authScheme', e.target.value)}
                                        placeholder="认证前缀，如 Bearer（可选）"
                                        className={`${inputClass} flv-safe-input`}
                                    />
                                    <input
                                        value={extraConfig.projectId || ''}
                                        onChange={(e) => updateExtraConfig('projectId', e.target.value)}
                                        placeholder="Project ID / Organization（可选）"
                                        className={`${inputClass} flv-safe-input`}
                                    />
                                    <div className={`md:col-span-2 mt-1 text-xs font-semibold ${isDark ? 'text-[#98A2B3]' : 'text-[#667085]'}`}>计费配置</div>
                                    <input
                                        value={extraConfig.costMultiplier || ''}
                                        onChange={(e) => updateExtraConfig('costMultiplier', e.target.value)}
                                        placeholder="成本倍率，如 1.2"
                                        className={`${inputClass} flv-safe-input`}
                                    />
                                    <select
                                        value={extraConfig.billingMode || ''}
                                        onChange={(e) => updateExtraConfig('billingMode', e.target.value)}
                                        className={`${inputClass} flv-safe-input`}
                                        title="计费模式"
                                        aria-label="计费模式"
                                    >
                                        <option value="">计费模式：自动</option>
                                        <option value="per-token">按 Token</option>
                                        <option value="per-image">按图片</option>
                                        <option value="per-second">按秒</option>
                                        <option value="flat">固定成本</option>
                                    </select>
                                    <div className={`md:col-span-2 mt-1 text-xs font-semibold ${isDark ? 'text-[#98A2B3]' : 'text-[#667085]'}`}>模型测试配置</div>
                                    <input
                                        value={extraConfig.testTimeoutMs || ''}
                                        onChange={(e) => updateExtraConfig('testTimeoutMs', e.target.value)}
                                        placeholder="模型测试超时 ms，如 30000"
                                        className={`${inputClass} flv-safe-input`}
                                    />
                                    <input
                                        value={extraConfig.maxRetries || ''}
                                        onChange={(e) => updateExtraConfig('maxRetries', e.target.value)}
                                        placeholder="最大重试次数，如 2"
                                        className={`${inputClass} flv-safe-input`}
                                    />
                                </div>
                                <textarea
                                    value={extraConfig.testPrompt || ''}
                                    onChange={(e) => updateExtraConfig('testPrompt', e.target.value)}
                                    placeholder="测试提示词（可选）"
                                    className={`${inputClass} mt-2 min-h-18 resize-y`}
                                />
                                <div className={`mb-1 mt-3 text-xs font-semibold ${isDark ? 'text-[#98A2B3]' : 'text-[#667085]'}`}>模型映射</div>
                                <textarea
                                    value={extraConfig.modelMappingsJson || ''}
                                    onChange={(e) => updateExtraConfig('modelMappingsJson', e.target.value)}
                                    placeholder='模型映射 JSON，如 {"gpt-image":"vendor-image-model"}'
                                    className={`${inputClass} mt-2 min-h-18 resize-y font-mono text-xs`}
                                />
                                <div className={`mb-1 mt-3 text-xs font-semibold ${isDark ? 'text-[#98A2B3]' : 'text-[#667085]'}`}>配置 JSON</div>
                                <textarea
                                    value={extraConfig.configJson || ''}
                                    onChange={(e) => updateExtraConfig('configJson', e.target.value)}
                                    placeholder='配置 JSON（可选），用于保存供应商额外参数'
                                    className={`${inputClass} mt-2 min-h-24 resize-y font-mono text-xs`}
                                />
                            </div>
                        </div>

                        <div className={`shrink-0 border-t px-6 py-4 ${isDark ? 'border-[#2A3140] bg-[#12151B]' : 'border-[#E4E7EC] bg-white'}`}>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleSaveKey}
                                    disabled={!apiKey.trim() || capabilities.length === 0 || isValidating}
                                    className="isl-go h-11 flex-1 px-4 text-sm"
                                >
                                    {isValidating ? '验证中...' : editingKeyId ? '验证并更新' : '验证并保存'}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCancelEdit}
                                    className="isl-chip px-4 py-2.5 text-sm"
                                >
                                    取消
                                </button>
                            </div>

                            {validationResult && (
                                <div className={`mt-3 rounded-xl px-3 py-2 text-sm ${
                                    validationResult.ok
                                        ? isDark ? 'bg-[#123524] text-[#75E0A7]' : 'bg-[#ECFDF3] text-[#027A48]'
                                        : isDark ? 'bg-[#3A1616] text-[#FDA29B]' : 'bg-[#FEF3F2] text-[#B42318]'
                                }`}>
                                    {validationResult.ok
                                        ? '✓ Key 验证通过，已保存'
                                        : `✗ 验证失败：${validationResult.message || 'API Key 无效'}`
                                    }
                                </div>
                            )}
                        </div>
                    </div>
                    </div>
                </div>
            )}
        </div>
    );
};

