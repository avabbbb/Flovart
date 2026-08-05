import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { UserApiKey, AIProvider, AICapability, ModelItem, ProductModelMode, ApiPricingRule, ApiBudgetPolicy, RouteMappingBinding, RouteMappingTarget, RuntimeRouteCapability } from '../types';
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
import { getProductModel, getProductModels, suggestProductRouteMappings } from '../services/productModelCatalog';
import { getKeyModelIds } from '../utils/modelRefs';
import { getFlovartRuntimeApi } from '../services/flovartRuntime';

interface RuntimeProviderStatus {
    provider: string;
    ready: boolean;
    capabilities?: string[];
    credentials?: Array<{ label?: string; available?: boolean; credentialId?: string }>;
    productModels?: string[];
    routes?: Array<{
        routeId: string;
        productModel?: string;
        mode?: string;
        durationsSec?: number[];
        resolution?: string;
        maxSourceImages?: number;
    }>;
}

interface SettingsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    resolvedTheme: 'light' | 'dark';
    userApiKeys: UserApiKey[];
    onAddApiKey: (payload: Omit<UserApiKey, 'id' | 'createdAt' | 'updatedAt'>) => void;
    onDeleteApiKey: (id: string) => void;
    onUpdateApiKey: (id: string, patch: Partial<Omit<UserApiKey, 'id' | 'createdAt'>>) => void;
    onSetDefaultApiKey: (id: string) => void;
    t: (key: string) => string;
    clearKeysOnExit: boolean;
    setClearKeysOnExit: (v: boolean) => void;
    /** Per-key usage summary (optional) */
    usageSummary?: Map<string, KeyUsageSummary>;
}

const providerBaseUrl: Record<AIProvider, string> = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta',
    xai: 'https://api.x.ai/v1',
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

const PRODUCT_MODE_LABELS: Record<ProductModelMode, string> = {
    'text-to-image': '文生图',
    'image-to-image': '图生图',
    'text-to-video': '文生视频',
    'image-to-video': '图生视频',
    'reference-to-video': '全能参考',
    'first-last-frame': '首尾帧',
    'video-extension': '视频扩展',
};

const RUNTIME_TARGETS: Array<{ capability: RuntimeRouteCapability; label: string; detail: string }> = [
    { capability: 'prompt-enhancement', label: '提示词增强', detail: '润色、翻译与提示词优化' },
    { capability: 'script-breakdown', label: '脚本拆解', detail: '把剧本拆成资产与分镜' },
    { capability: 'agent-text', label: 'Agent 文本', detail: 'Workflow、Agent 与文本节点推理' },
    { capability: 'image-understanding', label: '图像理解', detail: '反推提示词与视觉描述' },
];

const routeTargetKey = (target: RouteMappingTarget) => target.kind === 'product-mode'
    ? `${target.kind}:${target.productModelId}:${target.mode}`
    : `${target.kind}:${target.capability}`;

const keyRouteOptions = (key: UserApiKey, capability: 'text' | 'image' | 'video'): string[] =>
    getKeyModelIds(key, capability);

function RouteMappingEditor({ userApiKeys, onUpdateApiKey }: {
    userApiKeys: UserApiKey[];
    onUpdateApiKey: SettingsPanelProps['onUpdateApiKey'];
}) {
    const [productModelId, setProductModelId] = React.useState('');
    const [productMode, setProductMode] = React.useState<ProductModelMode>('text-to-image');
    const [routeChoice, setRouteChoice] = React.useState('');
    const product = getProductModel(productModelId);

    const detectedSuggestions = React.useMemo(() => userApiKeys.flatMap(key => {
        const existing = key.routeMappings || [];
        return suggestProductRouteMappings(key)
            .filter(suggestion => !existing.some(mapping => routeTargetKey(mapping.target) === routeTargetKey(suggestion.target) && mapping.routeId === suggestion.routeId))
            .map(suggestion => ({ key, suggestion }));
    }), [userApiKeys]);

    const rowsFor = (target: RouteMappingTarget) => userApiKeys.flatMap(key => (key.routeMappings || [])
        .map((mapping, index) => ({ key, mapping, index })))
        .filter(row => routeTargetKey(row.mapping.target) === routeTargetKey(target))
        .sort((left, right) => left.mapping.order - right.mapping.order || left.key.id.localeCompare(right.key.id));

    const capabilityForTarget = (target: RouteMappingTarget): 'text' | 'image' | 'video' => target.kind === 'runtime-capability'
        ? 'text'
        : target.mode === 'text-to-image' || target.mode === 'image-to-image'
            ? 'image'
            : 'video';

    const routeOptions = (target: RouteMappingTarget) => userApiKeys
        .filter(key => {
            const capabilities = key.capabilities?.length ? key.capabilities : inferCapabilitiesByProvider(key.provider);
            return capabilities.includes(capabilityForTarget(target));
        })
        .flatMap(key => keyRouteOptions(key, capabilityForTarget(target)).map(routeId => ({
            value: JSON.stringify([key.id, routeId]),
            label: `${key.name || PROVIDER_LABELS[key.provider] || key.provider} · ${routeId}`,
        })));

    const addRoute = (target: RouteMappingTarget, encoded: string) => {
        if (!encoded) return;
        const [keyId, routeId] = JSON.parse(encoded) as [string, string];
        const key = userApiKeys.find(item => item.id === keyId);
        if (!key || rowsFor(target).some(row => row.key.id === keyId && row.mapping.routeId === routeId)) return;
        const order = rowsFor(target).reduce((max, row) => Math.max(max, row.mapping.order), -1) + 1;
        onUpdateApiKey(keyId, { routeMappings: [...(key.routeMappings || []), { target, routeId, order }] });
    };

    const removeRoute = (key: UserApiKey, index: number) => {
        onUpdateApiKey(key.id, { routeMappings: (key.routeMappings || []).filter((_, itemIndex) => itemIndex !== index) });
    };

    const moveRoute = (target: RouteMappingTarget, rowIndex: number, direction: -1 | 1) => {
        const rows = rowsFor(target);
        const otherIndex = rowIndex + direction;
        if (!rows[rowIndex] || !rows[otherIndex]) return;
        const left = rows[rowIndex];
        const right = rows[otherIndex];
        const nextByKey = new Map<string, RouteMappingBinding[]>();
        const mappingsFor = (key: UserApiKey) => nextByKey.get(key.id) || [...(key.routeMappings || [])];
        const leftMappings = mappingsFor(left.key);
        leftMappings[left.index] = { ...left.mapping, order: right.mapping.order };
        nextByKey.set(left.key.id, leftMappings);
        const rightMappings = mappingsFor(right.key);
        rightMappings[right.index] = { ...right.mapping, order: left.mapping.order };
        nextByKey.set(right.key.id, rightMappings);
        nextByKey.forEach((routeMappings, keyId) => onUpdateApiKey(keyId, { routeMappings }));
    };

    const applyDetectedSuggestions = () => {
        const nextByKey = new Map<string, RouteMappingBinding[]>();
        const nextOrderByTarget = new Map<string, number>();
        userApiKeys.flatMap(key => key.routeMappings || []).forEach(mapping => {
            const targetKey = routeTargetKey(mapping.target);
            nextOrderByTarget.set(targetKey, Math.max(nextOrderByTarget.get(targetKey) ?? -1, mapping.order));
        });
        detectedSuggestions.forEach(({ key, suggestion }) => {
            const mappings = nextByKey.get(key.id) || [...(key.routeMappings || [])];
            const targetKey = routeTargetKey(suggestion.target);
            const order = (nextOrderByTarget.get(targetKey) ?? -1) + 1;
            nextOrderByTarget.set(targetKey, order);
            mappings.push({ ...suggestion, order });
            nextByKey.set(key.id, mappings);
        });
        nextByKey.forEach((routeMappings, keyId) => onUpdateApiKey(keyId, { routeMappings }));
    };

    const productTargets = Array.from(new Map(userApiKeys.flatMap(key => key.routeMappings || [])
        .filter((mapping): mapping is RouteMappingBinding & { target: Extract<RouteMappingTarget, { kind: 'product-mode' }> } => mapping.target.kind === 'product-mode')
        .map(mapping => [routeTargetKey(mapping.target), mapping.target])).values());

    const renderTarget = (target: RouteMappingTarget, title: string, detail: string) => {
        const rows = rowsFor(target);
        const options = routeOptions(target);
        return <div key={routeTargetKey(target)} className="rounded-2xl border border-[var(--isl-border)] bg-[var(--isl-card)] p-3">
            <div className="flex items-start justify-between gap-3">
                <div><div className="text-sm font-bold text-[var(--isl-ink)]">{title}</div><div className="mt-0.5 text-[11px] text-[var(--isl-ink-soft)]">{detail}</div></div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${rows.length ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>{rows.length ? `${rows.length} 条线路` : '未配置'}</span>
            </div>
            <div className="mt-2 space-y-1.5">
                {rows.map((row, index) => {
                    const exposed = keyRouteOptions(row.key, capabilityForTarget(target));
                    const routeId = row.mapping.routeId.trim().toLowerCase();
                    const available = row.key.status !== 'error' && (exposed.length === 0 || exposed.some(value => value.trim().toLowerCase() === routeId));
                    return <div key={`${row.key.id}:${row.index}`} className="flex items-center gap-2 rounded-xl bg-[var(--isl-surface-2)] px-2 py-1.5">
                        <span className={`w-16 shrink-0 text-[10px] font-bold ${index === 0 ? 'text-[var(--isl-mint-deep)]' : 'text-[var(--isl-ink-soft)]'}`}>{index === 0 ? '主线路' : `备用 ${index}`}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-[var(--isl-ink)]">{row.key.name || PROVIDER_LABELS[row.key.provider] || row.key.provider} · {row.mapping.routeId}</span>
                        <span className={`shrink-0 text-[10px] ${available ? 'text-emerald-600' : 'text-red-500'}`}>{available ? '可用' : '异常'}</span>
                        <button type="button" disabled={index === 0} onClick={() => moveRoute(target, index, -1)} className="isl-icon-btn h-6 w-6 text-[10px] disabled:opacity-25" aria-label="上移线路">↑</button>
                        <button type="button" disabled={index === rows.length - 1} onClick={() => moveRoute(target, index, 1)} className="isl-icon-btn h-6 w-6 text-[10px] disabled:opacity-25" aria-label="下移线路">↓</button>
                        <button type="button" onClick={() => removeRoute(row.key, row.index)} className="isl-icon-btn h-6 w-6 text-[10px] text-red-500" aria-label="删除线路">×</button>
                    </div>;
                })}
                <select aria-label={`${title} 添加线路`} value="" onChange={event => addRoute(target, event.target.value)} className="isl-well h-8 w-full px-2 text-xs text-[var(--isl-ink)] outline-none">
                    <option value="">+ 添加主线路或备用线路…</option>
                    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
            </div>
        </div>;
    };

    const allProducts = [...getProductModels('image'), ...getProductModels('video')];
    const renderProductSection = (capability: 'image' | 'video', title: string, detail: string) => {
        const targets = productTargets.filter(target => getProductModel(target.productModelId)?.capability === capability);
        return <div className="space-y-2">
            <div><div className="text-sm font-extrabold text-[var(--isl-ink)]">{title}</div><div className="mt-0.5 text-xs text-[var(--isl-ink-soft)]">{detail}</div></div>
            {targets.length > 0 ? targets.map(target => {
                const model = getProductModel(target.productModelId);
                return renderTarget(target, `${model?.name || target.productModelId} · ${PRODUCT_MODE_LABELS[target.mode]}`, '媒体节点明确选择产品模型与生成模式后使用');
            }) : <div className="rounded-2xl border border-dashed border-[var(--isl-border)] px-3 py-4 text-xs text-[var(--isl-ink-soft)]">尚未应用{title}映射；检测到的线路会显示在上方建议中。</div>}
        </div>;
    };
    return <section className="space-y-3" data-testid="model-mapping-sections">
        <div><div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--isl-ink-ghost)]">模型映射</div><p className="mb-0 mt-1 text-xs leading-5 text-[var(--isl-ink-soft)]">先选择 Flovart 的产品模型或文本能力，再绑定 Provider 线路。这里是唯一选路来源。</p></div>
        {detectedSuggestions.length > 0 && <div className="rounded-2xl border border-[var(--isl-mint)] bg-[var(--isl-mint-bg)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div><div className="text-sm font-extrabold text-[var(--isl-mint-deep)]">检测到 {detectedSuggestions.length} 条媒体映射建议</div><div className="mt-1 text-xs text-[var(--isl-ink-soft)]">依据 API Key 实际返回的模型 ID 匹配；确认后才会写入，不会静默改动线路。</div></div>
                <button type="button" onClick={applyDetectedSuggestions} className="isl-chip isl-chip--active h-9 px-3 text-xs" aria-label="应用全部建议">应用全部建议</button>
            </div>
            <div className="mt-2 grid gap-1 md:grid-cols-2">
                {detectedSuggestions.map(({ key, suggestion }) => {
                    const target = suggestion.target;
                    const model = target.kind === 'product-mode' ? getProductModel(target.productModelId) : undefined;
                    return <div key={`${key.id}:${routeTargetKey(target)}:${suggestion.routeId}`} className="truncate rounded-lg bg-[var(--isl-surface)] px-2.5 py-1.5 text-[11px] text-[var(--isl-ink)]">{model?.name || '媒体模型'} · {target.kind === 'product-mode' ? PRODUCT_MODE_LABELS[target.mode] : ''} → {suggestion.routeId}</div>;
                })}
            </div>
        </div>}
        {renderProductSection('image', '图像模型', '优先配置文生图与图生图线路。')}
        {renderProductSection('video', '视频模型', '按生成方式绑定视频线路，PromptBar 参数将服从这里的最终线路。')}
        <div className="rounded-2xl border border-[var(--isl-border)] bg-[var(--isl-surface-2)] p-3">
            <div className="mb-2 text-sm font-bold text-[var(--isl-ink)]">手动添加媒体映射</div>
            <div className="grid gap-2 md:grid-cols-[1.2fr_1fr_1.6fr_auto]">
                <select aria-label="产品模型" value={productModelId} onChange={event => { const next = getProductModel(event.target.value); setProductModelId(event.target.value); setProductMode(next?.capabilities.modes[0] || 'text-to-image'); setRouteChoice(''); }} className="isl-well h-9 px-2 text-xs text-[var(--isl-ink)] outline-none"><option value="">选择产品模型…</option>{allProducts.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select>
                <select aria-label="生成模式" value={productMode} disabled={!product} onChange={event => { setProductMode(event.target.value as ProductModelMode); setRouteChoice(''); }} className="isl-well h-9 px-2 text-xs text-[var(--isl-ink)] outline-none disabled:opacity-40">{(product?.capabilities.modes || []).map(mode => <option key={mode} value={mode}>{PRODUCT_MODE_LABELS[mode]}</option>)}</select>
                <select aria-label="Provider 线路" value={routeChoice} disabled={!product} onChange={event => setRouteChoice(event.target.value)} className="isl-well h-9 min-w-0 px-2 text-xs text-[var(--isl-ink)] outline-none disabled:opacity-40"><option value="">选择 Provider / Key / Route…</option>{product ? routeOptions({ kind: 'product-mode', productModelId, mode: productMode }).map(option => <option key={option.value} value={option.value}>{option.label}</option>) : null}</select>
                <button type="button" disabled={!product || !routeChoice} onClick={() => { addRoute({ kind: 'product-mode', productModelId, mode: productMode }, routeChoice); setRouteChoice(''); }} className="isl-chip px-3 text-xs disabled:opacity-40">添加</button>
            </div>
        </div>
        <div className="space-y-2"><div><div className="text-sm font-extrabold text-[var(--isl-ink)]">文本与 Agent</div><div className="mt-0.5 text-xs text-[var(--isl-ink-soft)]">提示词增强、脚本拆解与 Agent 文本能力放在媒体模型之后配置。</div></div>{RUNTIME_TARGETS.map(item => renderTarget({ kind: 'runtime-capability', capability: item.capability }, item.label, item.detail))}</div>
        {userApiKeys.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--isl-border)] p-5 text-center text-xs text-[var(--isl-ink-soft)]">请先在“API 配置”中添加 Provider，随后再建立模型映射。</div>}
    </section>;
}

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
    modelItems?: ModelItem[];
    extraConfig?: Record<string, string>;
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
        id: 'runninghub-standard',
        name: 'RunningHub 标准模型',
        shortName: 'RH',
        provider: 'runningHub',
        websiteUrl: 'https://www.runninghub.cn/call-api/search-api/standard-model?search=',
        baseUrl: providerBaseUrl.runningHub,
        capabilities: ['image', 'video'],
        requestFormat: 'native',
        authHeaderName: 'Authorization',
        authScheme: 'Bearer',
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
        defaultModel: 'doubao-seedance-2-0-260128',
        models: ['doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128'],
        featured: true,
    },
    {
        id: 'google-visual',
        name: 'Google Visual Models',
        shortName: 'GO',
        provider: 'google',
        websiteUrl: 'https://ai.google.dev/gemini-api/docs',
        baseUrl: providerBaseUrl.google,
        capabilities: ['image', 'video'],
        requestFormat: 'google',
        defaultModel: 'gemini-3.1-flash-image',
        models: ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'veo-3.1-lite-generate-preview'],
        featured: true,
    },
    {
        id: 'kling-video',
        name: 'Kling VIDEO',
        shortName: 'KL',
        provider: 'keling',
        websiteUrl: 'https://app.klingai.com/cn/dev/document-api/apiReference/updateNotice',
        baseUrl: providerBaseUrl.keling,
        capabilities: ['video'],
        requestFormat: 'native',
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

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
    isOpen,
    onClose,
    resolvedTheme,
    userApiKeys,
    onAddApiKey,
    onDeleteApiKey,
    onUpdateApiKey,
    onSetDefaultApiKey,
    clearKeysOnExit,
    setClearKeysOnExit,
    usageSummary,
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
    const [editPricingRules, setEditPricingRules] = React.useState<ApiPricingRule[]>([]);
    const [editBudgetPolicy, setEditBudgetPolicy] = React.useState<ApiBudgetPolicy>({ enabled: false, monthlyLimit: 100, warningPercent: 80, hardStop: true, currency: 'USD' });
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
    const [activeTab, setActiveTab] = React.useState<'api' | 'models' | 'security'>('api');
    const [runtimeProviders, setRuntimeProviders] = React.useState<RuntimeProviderStatus[] | null>(null);
    const [selectedCredentialByProvider, setSelectedCredentialByProvider] = React.useState<Record<string, string>>({});
    const configuredRuntimeProviders = runtimeProviders?.filter(item => item.ready) || [];

    React.useEffect(() => {
        if (!isOpen) return;
        const runtime = getFlovartRuntimeApi();
        if (!runtime) {
            setRuntimeProviders(null);
            return;
        }
        let active = true;
        void runtime.execute({
            protocolVersion: '1',
            commandId: crypto.randomUUID(),
            command: 'provider.status',
            args: {},
            actor: { kind: 'ui', instanceId: 'settings-panel' },
        }).then(result => {
            if (!active) return;
            const providers = (result as { providers?: RuntimeProviderStatus[] })?.providers;
            setRuntimeProviders(Array.isArray(providers) ? providers : []);
        }).catch(() => {
            if (active) setRuntimeProviders([]);
        });
        return () => { active = false; };
    }, [isOpen]);

    const isDark = resolvedTheme === 'dark';

    // 把 Desktop Runtime 的安全凭证一键导入为「Runtime 托管」网页 Key（不含明文，媒体生成经 Runtime 执行）。
    // 支持多凭证 Provider 指定选择：未传 credentialId 时回退到当前选中或第一个可用凭证。
    const importRuntimeCredential = (runtimeProvider: RuntimeProviderStatus, credentialId?: string) => {
        const providerName = runtimeProvider.provider as AIProvider;
        const credential = runtimeProvider.credentials?.find(item => item.available && item.credentialId === credentialId)
            || runtimeProvider.credentials?.find(item => item.available && item.credentialId)
            || runtimeProvider.credentials?.find(item => item.available);
        const routeMappings = (runtimeProvider.routes || []).filter(route => route.routeId && route.productModel).map((route, index) => ({
            target: {
                kind: 'product-mode' as const,
                productModelId: route.productModel as string,
                mode: (route.mode && ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-extension'].includes(route.mode)
                    ? route.mode
                    : route.productModel?.includes('image') ? 'text-to-image' : 'text-to-video') as ProductModelMode,
            },
            routeId: route.routeId,
            order: index,
        }));
        const routeIds = (runtimeProvider.routes || []).map(route => route.routeId).filter(Boolean);
        const capabilities = (runtimeProvider.capabilities || []).filter((cap): cap is AICapability => cap === 'image' || cap === 'video');
        onAddApiKey({
            provider: providerName,
            capabilities,
            key: `runtime:${credential?.credentialId || providerName}`,
            name: `${providerName === 'runningHub' ? 'RunningHub' : providerName}（Runtime 托管）`,
            status: 'ok',
            isDefault: false,
            runtimeManaged: { credentialId: credential?.credentialId },
            models: routeIds.map(routeId => ({ id: routeId, name: routeId })),
            customModels: routeIds,
            routeMappings,
        });
    };

    const inputClass = 'isl-well w-full px-3 py-2.5 text-sm text-[var(--isl-ink)] outline-none placeholder:text-[var(--isl-ink-ghost)]';
    const chipClass = 'isl-chip px-3 py-2 text-sm';
    const sectionPanelClass = 'rounded-2xl border-[1.5px] border-[var(--isl-border)] bg-[var(--isl-surface-2)] p-3';

    if (!isOpen) return null;

    const addPricingRule = () => setEditPricingRules(current => [...current, {
        id: crypto.randomUUID(), unit: capabilities.includes('video') ? 'video_second' : 'image', rate: 0, currency: 'USD', source: 'manual',
    }]);

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
        const modelItems: ModelItem[] = preset.modelItems || (preset.models || []).map(id => ({ id, name: id }));
        const presetExtra: Record<string, string> = {
            requestFormat: preset.requestFormat,
            ...(preset.extraConfig || {}),
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
        setEditPricingRules([]);
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

        const detectedModelItems: ModelItem[] = result.models?.length
            ? result.models.map(model => ({ id: model.id, name: model.name || model.id, capability: model.capability }))
            : [];
        if (detectedModelItems.length > 0) {
            setFetchedModels(result.models || []);
            setEditModels(detectedModelItems);
            if (!editDefaultModel || !detectedModelItems.some(model => model.id === editDefaultModel)) {
                setEditDefaultModel(detectedModelItems[0].id);
            }
        }

        const finalModels = detectedModelItems.length > 0 ? detectedModelItems : editModels;
        const finalDefaultModel = editDefaultModel && finalModels.some(model => model.id === editDefaultModel)
            ? editDefaultModel
            : finalModels[0]?.id;
        const modelsToSave = finalModels.length > 0 ? finalModels : undefined;
        const customModelsToSave = finalModels.map(m => m.id);
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
                defaultModel: finalDefaultModel || undefined,
                extraConfig: extraToSave,
                pricingRules: editPricingRules,
                budgetPolicy: editBudgetPolicy,
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
                defaultModel: finalDefaultModel || undefined,
                extraConfig: extraToSave,
                pricingRules: editPricingRules,
                budgetPolicy: editBudgetPolicy,
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
        setEditPricingRules(item.pricingRules || []);
        setEditBudgetPolicy(item.budgetPolicy || { enabled: false, monthlyLimit: 100, warningPercent: 80, hardStop: true, currency: 'USD' });
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
        setEditPricingRules([]);
        setEditBudgetPolicy({ enabled: false, monthlyLimit: 100, warningPercent: 80, hardStop: true, currency: 'USD' });
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
        if (requestFormat === 'anthropic' || (requestFormat === 'native' && targetProvider !== 'runningHub')) {
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
                const modelItems: ModelItem[] = result.models.map(m => ({ id: m.id, name: m.name || m.id, capability: m.capability }));
                setEditModels(modelItems);
                if (modelItems.length > 0) setEditDefaultModel(modelItems[0].id);
                // 自动推断 capabilities
                const caps = new Set<AICapability>();
                for (const m of result.models) caps.add(m.capability);
                if (caps.size > 0) setCapabilities(Array.from(caps));
                if (result.endpointFlavor) {
                    setExtraConfig(prev => ({ ...prev, endpointFlavor: result.endpointFlavor }));
                }
            } else if (result.ok && targetProvider === 'runningHub') {
                setFetchedModels([]);
                setFetchError('未从 RunningHub 官方模型页解析到可用模型，请稍后重试或手动添加模型 ID。');
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
            routeMappings: k.routeMappings,
            pricingRules: k.pricingRules,
            budgetPolicy: k.budgetPolicy,
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
                        routeMappings: item.routeMappings,
                        pricingRules: item.pricingRules,
                        budgetPolicy: item.budgetPolicy,
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
            routeMappings: k.routeMappings,
            pricingRules: k.pricingRules,
            budgetPolicy: k.budgetPolicy,
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
                className="isl-shell relative max-h-[90vh] w-[94%] max-w-6xl overflow-y-auto p-6"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h3 className="text-xl font-extrabold text-[var(--isl-ink)]">设置</h3>
                        <p className="mt-1 text-sm text-[var(--isl-ink-soft)]">
                            管理 API 供应商、模型映射和本地安全策略。主题与语言请在顶栏切换。
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

                {/* Tab 导航 */}
                <div className="mb-6 flex gap-1 border-b border-[var(--isl-border)]">
                    {([
                        { key: 'api', label: 'API 配置' },
                        { key: 'models', label: '模型映射' },
                        { key: 'security', label: '安全' },
                    ] as const).map(tab => (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveTab(tab.key)}
                            className={`relative px-4 py-2.5 text-sm font-bold transition-colors ${
                                activeTab === tab.key
                                    ? 'text-[var(--isl-ink)]'
                                    : 'text-[var(--isl-ink-soft)] hover:text-[var(--isl-ink)]'
                            }`}
                        >
                            {tab.label}
                            {activeTab === tab.key && (
                                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[var(--isl-mint)]" />
                            )}
                        </button>
                    ))}
                </div>

                <AnimatePresence mode="wait">
                <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="space-y-6"
                >
                {activeTab === 'api' && (
                    <>
                    {/* ── 统一 API 配置管理 ───────────────────────── */}
                    {runtimeProviders !== null && (
                        <section className={sectionPanelClass}>
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-sm font-extrabold text-[var(--isl-ink)]">桌面 Runtime 凭证</div>
                                    <div className="mt-1 text-xs text-[var(--isl-ink-soft)]">这里显示 EXE 共享的安全凭证状态，不会把原始 API Key 读回网页。</div>
                                </div>
                                <span className="rounded-full bg-[var(--isl-card)] px-2.5 py-1 text-[11px] text-[var(--isl-ink-soft)]">Runtime</span>
                            </div>
                            {configuredRuntimeProviders.length > 0 ? (
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    {configuredRuntimeProviders.map(item => {
                                        const availableCredentials = (item.credentials || []).filter(credential => credential.available);
                                        const selectedCredentialId = selectedCredentialByProvider[item.provider]
                                            || availableCredentials.find(credential => credential.credentialId)?.credentialId
                                            || '';
                                        const alreadyImported = userApiKeys.some(key => key.runtimeManaged?.credentialId && key.runtimeManaged.credentialId === selectedCredentialId);
                                        return (
                                            <div key={item.provider} className="rounded-xl border border-[var(--isl-border)] px-3 py-2.5">
                                                <div className="flex items-center justify-between gap-2 text-sm font-semibold text-[var(--isl-ink)]">
                                                    <span>{item.provider === 'runningHub' ? 'RunningHub' : item.provider === 'google' ? 'Google Gemini' : item.provider}</span>
                                                    <span className="text-emerald-500">已配置</span>
                                                </div>
                                                <div className="mt-1 text-[11px] text-[var(--isl-ink-soft)]">
                                                    {availableCredentials.length || 0} 个安全凭证可供 Production Runtime 使用
                                                </div>
                                                {availableCredentials.length > 1 && (
                                                    <select
                                                        aria-label={`${item.provider === 'runningHub' ? 'RunningHub' : item.provider} Runtime 凭证选择`}
                                                        value={selectedCredentialId}
                                                        onChange={event => setSelectedCredentialByProvider(prev => ({ ...prev, [item.provider]: event.target.value }))}
                                                        className="isl-well mt-2 h-8 w-full px-2 text-xs text-[var(--isl-ink)] outline-none"
                                                    >
                                                        {availableCredentials.map(credential => (
                                                            <option key={credential.credentialId || credential.label || item.provider} value={credential.credentialId || ''}>
                                                                {credential.label || credential.credentialId || item.provider}
                                                            </option>
                                                        ))}
                                                    </select>
                                                )}
                                                {availableCredentials.length === 1 && selectedCredentialId && (
                                                    <div className="mt-2 truncate text-[11px] text-[var(--isl-ink-soft)]">
                                                        {availableCredentials[0].label || '安全凭证'}
                                                    </div>
                                                )}
                                                <button
                                                    type="button"
                                                    disabled={alreadyImported || availableCredentials.length === 0}
                                                    onClick={() => importRuntimeCredential(item, selectedCredentialId || undefined)}
                                                    className="mt-2 rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-40"
                                                    style={{ borderColor: 'var(--isl-border)', color: 'var(--isl-ink-soft)' }}
                                                    title="把该 Runtime 凭证导入为「Runtime 托管」网页 Key，模型映射即可推荐其路线，媒体生成经 Runtime 执行"
                                                >
                                                    {alreadyImported ? '已导入 API 配置' : availableCredentials.length === 0 ? '暂无可用凭证' : '一键导入到 API 配置'}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="mt-3 rounded-xl border border-dashed border-[var(--isl-border)] px-3 py-3 text-xs text-[var(--isl-ink-soft)]">
                                    当前没有可供 Production Runtime 使用的安全凭证。
                                </div>
                            )}
                            {runtimeProviders.some(item => item.provider === 'runningHub' && item.ready) && !userApiKeys.some(item => item.provider === 'runningHub') && (
                                <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                                    Runtime 已有 RunningHub 凭证，但当前网页配置列表为空；Production Runtime 可以使用它，浏览器直连生成仍需在本 EXE 中重新录入 Key。
                                </div>
                            )}
                        </section>
                    )}
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
                                <AnimatePresence initial={false}>
                                {userApiKeys.map(item => (
                                    <motion.div
                                        key={item.id}
                                        layout
                                        initial={{ opacity: 0, y: -6, scale: 0.98 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                                        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                                        className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${
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
                                                <span className={`rounded-full px-2 py-1 text-[11px] ${isDark ? 'bg-[#1B2029] text-[#98A2B3]' : 'bg-[#F2F4F7] text-[#667085]'}`}>
                                                    映射 {item.routeMappings?.length || 0}
                                                </span>
                                                {item.budgetPolicy?.enabled && <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600">预算 {item.budgetPolicy.currency} {item.budgetPolicy.monthlyLimit}</span>}
                                            </div>
                                            {/* Usage stats */}
                                            {usageSummary?.get(item.id) && (() => {
                                                const u = usageSummary.get(item.id)!;
                                                if (u.totalCalls === 0) return null;
                                                return (
                                                    <div className={`mt-1.5 flex gap-3 text-[10px] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                                                        <span>调用 {u.totalCalls} 次</span>
                                                        {u.errorCalls > 0 && <span className="text-red-400">失败 {u.errorCalls}</span>}
                                                <span>累计≈ {formatCost(u.totalCostCents, u.currency)}</span>
                                                <span>本月≈ {formatCost(u.currentMonthCostCents, u.currency)}</span>
                                                {u.pendingCostCalls > 0 && <span className="text-amber-500">待核账 {u.pendingCostCalls}</span>}
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
                                    </motion.div>
                                ))}
                                </AnimatePresence>
                            )}
                        </div>
                    </section>
                    </>
                )}

                {activeTab === 'models' && <RouteMappingEditor userApiKeys={userApiKeys} onUpdateApiKey={onUpdateApiKey} />}

                {activeTab === 'security' && (
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
                )}
                </motion.div>
                </AnimatePresence>
            </div>

            {/* API Key 添加/编辑弹窗（统一版） */}
            <AnimatePresence>
            {showKeyModal && (
                <motion.div
                    className="fixed inset-0 z-150 overflow-y-auto bg-black/40 backdrop-blur-sm"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    onClick={handleCancelEdit}
                >
                    <motion.div
                        className="flex min-h-[100dvh] items-end justify-center p-2 sm:min-h-full sm:items-center sm:p-6"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.14 }}
                    >
                    <motion.div
                        className="isl-shell relative flex min-h-0 max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden sm:max-h-[calc(100dvh-3rem)]"
                        initial={{ opacity: 0, y: 24, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 16, scale: 0.98 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
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
                                            <motion.button
                                                key={preset.id}
                                                type="button"
                                                onClick={() => applyProviderPreset(preset, { fillName: true })}
                                                whileHover={{ y: -2, scale: 1.01 }}
                                                whileTap={{ y: 0, scale: 0.985 }}
                                                transition={{ type: 'spring', stiffness: 400, damping: 26 }}
                                                className="flex min-h-[54px] items-center gap-2 rounded-2xl border px-3 py-2 text-left text-sm"
                                                style={rainbowStyle}
                                            >
                                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/70 text-[11px] font-black text-[#4F46E5]">
                                                    {preset.shortName}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate font-bold">{preset.name}</span>
                                                    <span className="mt-0.5 block truncate text-[11px] opacity-75">
                                                        {preset.defaultModel || (preset.provider === 'runningHub' ? '点击获取官方模型' : preset.provider)}
                                                    </span>
                                                </span>
                                                {preset.featured && (
                                                    <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold text-[#7C3AED]">
                                                        推荐
                                                    </span>
                                                )}
                                            </motion.button>
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
                                <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()} placeholder="https://your-api-endpoint.com" className={`${inputClass} flv-safe-input`} />
                            </label>

                            {provider === 'custom' && (
                                <div className={`rounded-xl px-3 py-2 text-xs ${isDark ? 'bg-[#161A22] text-[#98A2B3]' : 'bg-[#F8FAFC] text-[#667085]'}`}>
                                    兼容说明：模型列表默认探测 <strong>/v1/models</strong>，图片走 <strong>/v1/images/generations</strong>，部分聚合端点的视频会自动尝试 <strong>/v2/videos/generations</strong>。
                                </div>
                            )}

                            {provider === 'runningHub' && (
                                <div className={`rounded-xl px-3 py-2 text-xs leading-5 ${isDark ? 'bg-[#161A22] text-[#98A2B3]' : 'bg-[#F8FAFC] text-[#667085]'}`}>
                                    不再内置 RunningHub 旧预设模型。请先点 <strong>获取模型</strong> 拉取官方标准模型列表，再选择或手动补充模型 ID；
                                    调用时会按详情页字段自动填充 <strong>imageUrls</strong>、<strong>firstFrameUrl</strong>、<strong>ratio</strong>、<strong>videoUrls</strong>、<strong>audioUrls</strong> 等。
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

                            <div className={sectionPanelClass}>
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <div><div className="text-sm font-bold text-[var(--isl-ink)]">价格规则</div><div className="mt-0.5 text-[11px] text-[var(--isl-ink-soft)]">按 Key、产品模型和计费单位维护，可随时增删改。</div></div>
                                    <button type="button" onClick={addPricingRule} className="isl-chip px-3 py-1.5 text-xs">+ 新增规则</button>
                                </div>
                                <div className="space-y-2">
                                    {editPricingRules.map(rule => (
                                        <motion.div key={rule.id} layout transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="grid gap-2 rounded-2xl border border-[var(--isl-border)] bg-[var(--isl-card)] p-3 md:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
                                            <select aria-label="计价模型" value={rule.productModelId || ''} onChange={event => setEditPricingRules(current => current.map(item => item.id === rule.id ? { ...item, productModelId: event.target.value || undefined, unit: event.target.value ? getProductModel(event.target.value)?.capability === 'video' ? 'video_second' : 'image' : 'request' } : item))} className={`${inputClass} text-xs`}>
                                                <option value="">整把 Key</option>
                                                {[...getProductModels('image'), ...getProductModels('video')].map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                                            </select>
                                            <select aria-label="计价单位" value={rule.unit} onChange={event => setEditPricingRules(current => current.map(item => item.id === rule.id ? { ...item, unit: event.target.value as ApiPricingRule['unit'] } : item))} className={`${inputClass} text-xs`}>
                                                <option value="request">每次请求</option>
                                                {(!rule.productModelId || getProductModel(rule.productModelId)?.capability === 'image') && <option value="image">每张图片</option>}
                                                {(!rule.productModelId || getProductModel(rule.productModelId)?.capability === 'video') && <option value="video_second">每视频秒</option>}
                                                {!rule.productModelId && <><option value="input_token">每百万输入 Token</option><option value="output_token">每百万输出 Token</option></>}
                                            </select>
                                            <input aria-label="单价" type="number" min="0" step="0.0001" value={rule.rate} onChange={event => setEditPricingRules(current => current.map(item => item.id === rule.id ? { ...item, rate: Number(event.target.value) || 0 } : item))} className={`${inputClass} text-xs`} />
                                            <select aria-label="币种" value={rule.currency} onChange={event => setEditPricingRules(current => current.map(item => item.id === rule.id ? { ...item, currency: event.target.value as 'USD' | 'CNY' } : item))} className={`${inputClass} text-xs`}><option value="USD">USD</option><option value="CNY">CNY</option></select>
                                            <button type="button" aria-label="删除价格规则" onClick={() => setEditPricingRules(current => current.filter(item => item.id !== rule.id))} className="isl-chip px-3 text-xs text-red-500">删除</button>
                                        </motion.div>
                                    ))}
                                    {editPricingRules.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--isl-border)] px-3 py-5 text-center text-xs text-[var(--isl-ink-soft)]">未配置价格时只记录用量，不假装给出精确成本。</div>}
                                </div>
                            </div>

                            <div className={sectionPanelClass}>
                                <div className="mb-3 flex items-center justify-between"><div><div className="text-sm font-bold text-[var(--isl-ink)]">预算策略</div><div className="mt-0.5 text-[11px] text-[var(--isl-ink-soft)]">硬上限只阻止新任务，不会终止供应商已经接受的任务。</div></div><button type="button" onClick={() => setEditBudgetPolicy(policy => ({ ...policy, enabled: !policy.enabled }))} className={`isl-chip px-3 py-1.5 text-xs ${editBudgetPolicy.enabled ? 'isl-chip--active' : ''}`}>{editBudgetPolicy.enabled ? '已开启' : '未开启'}</button></div>
                                {editBudgetPolicy.enabled && editingKeyId && usageSummary?.get(editingKeyId) && (() => {
                                    const usage = usageSummary.get(editingKeyId)!;
                                    const sameCurrency = usage.currency === editBudgetPolicy.currency;
                                    const used = sameCurrency ? usage.currentMonthCostCents / 100 : 0;
                                    const percent = editBudgetPolicy.monthlyLimit > 0 ? Math.min(100, used / editBudgetPolicy.monthlyLimit * 100) : 0;
                                    return <div className="mb-3 rounded-2xl bg-[var(--isl-card)] p-3">
                                        <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--isl-ink-soft)]"><span>本月已记录 {sameCurrency ? formatCost(usage.currentMonthCostCents, usage.currency) : '币种不一致'}</span><span>{Math.round(percent)}%</span></div>
                                        <div className="h-2 overflow-hidden rounded-full bg-[var(--isl-surface-2)]"><motion.div initial={false} animate={{ width: `${percent}%` }} transition={{ type: 'spring', stiffness: 360, damping: 32 }} className={`h-full rounded-full ${percent >= editBudgetPolicy.warningPercent ? 'bg-amber-500' : 'bg-emerald-500'}`} /></div>
                                        {usage.pendingCostCalls > 0 && <div className="mt-2 text-[10px] text-amber-600">另有 {usage.pendingCostCalls} 笔费用待供应商账单确认，预算占用按当前预估计算。</div>}
                                    </div>;
                                })()}
                                {editBudgetPolicy.enabled && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ type: 'spring', stiffness: 380, damping: 32 }} className="grid gap-2 md:grid-cols-4">
                                    <label className="text-[11px] text-[var(--isl-ink-soft)]">月度额度<input type="number" min="0" value={editBudgetPolicy.monthlyLimit} onChange={event => setEditBudgetPolicy(policy => ({ ...policy, monthlyLimit: Number(event.target.value) || 0 }))} className={`${inputClass} mt-1`} /></label>
                                    <label className="text-[11px] text-[var(--isl-ink-soft)]">预警比例<input type="number" min="1" max="100" value={editBudgetPolicy.warningPercent} onChange={event => setEditBudgetPolicy(policy => ({ ...policy, warningPercent: Math.max(1, Math.min(100, Number(event.target.value) || 80)) }))} className={`${inputClass} mt-1`} /></label>
                                    <label className="text-[11px] text-[var(--isl-ink-soft)]">币种<select value={editBudgetPolicy.currency} onChange={event => setEditBudgetPolicy(policy => ({ ...policy, currency: event.target.value as 'USD' | 'CNY' }))} className={`${inputClass} mt-1`}><option value="USD">USD</option><option value="CNY">CNY</option></select></label>
                                    <label className="flex items-end"><button type="button" onClick={() => setEditBudgetPolicy(policy => ({ ...policy, hardStop: !policy.hardStop }))} className={`isl-chip w-full px-3 py-2.5 text-xs ${editBudgetPolicy.hardStop ? 'isl-chip--active' : ''}`}>超额阻止新任务 {editBudgetPolicy.hardStop ? 'ON' : 'OFF'}</button></label>
                                </motion.div>}
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
                    </motion.div>
                    </motion.div>
                </motion.div>
            )}
            </AnimatePresence>
        </div>
    );
};
