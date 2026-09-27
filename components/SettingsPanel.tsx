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
import '../styles/settings.css';

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
    t: (key: string, ...args: unknown[]) => string;
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
    deepseek: 'https://api.deepseek.com',
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

const capabilityLabelKeys: Record<AICapability, string> = {
    text: 'settingsExtra.capability.text',
    image: 'settingsExtra.capability.image',
    video: 'settingsExtra.capability.video',
    agent: 'settingsExtra.capability.agent',
};

const CREATIVE_CAPABILITIES: AICapability[] = ['text', 'image', 'video'];

const productModeLabelKeys: Record<ProductModelMode, string> = {
    'text-to-image': 'settingsExtra.productMode.text-to-image',
    'image-to-image': 'settingsExtra.productMode.image-to-image',
    'text-to-video': 'settingsExtra.productMode.text-to-video',
    'image-to-video': 'settingsExtra.productMode.image-to-video',
    'reference-to-video': 'settingsExtra.productMode.reference-to-video',
    'first-last-frame': 'settingsExtra.productMode.first-last-frame',
    'video-extension': 'settingsExtra.productMode.video-extension',
};

const RUNTIME_TARGETS: RuntimeRouteCapability[] = [
    'prompt-enhancement',
    'script-breakdown',
    'agent-text',
    'image-understanding',
];

const routeTargetKey = (target: RouteMappingTarget) => target.kind === 'product-mode'
    ? `${target.kind}:${target.productModelId}:${target.mode}`
    : `${target.kind}:${target.capability}`;

const keyRouteOptions = (key: UserApiKey, capability: 'text' | 'image' | 'video'): string[] =>
    getKeyModelIds(key, capability);

const ROUTE_MODES = ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'reference-to-video', 'first-last-frame', 'video-extension'] as const;

function runtimeRouteMode(route: { productModel?: string; mode?: string }): ProductModelMode {
    const mode = route.mode as ProductModelMode | undefined;
    if (mode && (ROUTE_MODES as readonly string[]).includes(mode)) return mode;
    return route.productModel?.includes('image') ? 'text-to-image' : 'text-to-video';
}

interface RuntimeRouteSuggestion {
    provider: string;
    target: RouteMappingTarget;
    routeId: string;
}

/** 从 Desktop Runtime 的 provider.status 生成不含 Secret 的路线建议（runtime-only 场景）。 */
function runtimeRouteSuggestions(runtimeProviders: RuntimeProviderStatus[]): RuntimeRouteSuggestion[] {
    return (runtimeProviders || []).flatMap(provider =>
        (provider.routes || [])
            .filter(route => route.routeId && route.productModel)
            .map(route => ({
                provider: provider.provider,
                target: {
                    kind: 'product-mode' as const,
                    productModelId: route.productModel as string,
                    mode: runtimeRouteMode(route),
                },
                routeId: route.routeId,
            })),
    );
}

function RouteMappingEditor({ userApiKeys, onUpdateApiKey, runtimeProviders, t }: {
    userApiKeys: UserApiKey[];
    onUpdateApiKey: SettingsPanelProps['onUpdateApiKey'];
    runtimeProviders?: RuntimeProviderStatus[] | null;
    t: SettingsPanelProps['t'];
}) {
    const capabilityLabel = (capability: AICapability) => t(capabilityLabelKeys[capability]);
    const productModeLabel = (mode: ProductModelMode) => t(productModeLabelKeys[mode]);
    const [productModelId, setProductModelId] = React.useState('');
    const [productMode, setProductMode] = React.useState<ProductModelMode>('text-to-image');
    const [routeChoice, setRouteChoice] = React.useState('');
    const [expandedTargets, setExpandedTargets] = React.useState<ReadonlySet<string>>(new Set());
    const toggleTarget = (targetKey: string) => setExpandedTargets(current => {
        const next = new Set(current);
        if (next.has(targetKey)) next.delete(targetKey); else next.add(targetKey);
        return next;
    });
    const product = getProductModel(productModelId);

    const detectedSuggestions = React.useMemo(() => userApiKeys.flatMap(key => {
        const existing = key.routeMappings || [];
        return suggestProductRouteMappings(key)
            .filter(suggestion => !existing.some(mapping => routeTargetKey(mapping.target) === routeTargetKey(suggestion.target) && mapping.routeId === suggestion.routeId))
            .map(suggestion => ({ key, suggestion }));
    }), [userApiKeys]);

    const runtimeSuggestions = React.useMemo(
        () => runtimeRouteSuggestions(runtimeProviders || []),
        [runtimeProviders],
    );

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

    // 卡片内容（线路列表 + 添加）：供单卡与分组卡共用
    const targetBody = (target: RouteMappingTarget, modeLabel: string) => {
        const rows = rowsFor(target);
        const options = routeOptions(target);
        return <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--isl-ink-ghost)]">{modeLabel}</div>
            {rows.map((row, index) => {
                const exposed = keyRouteOptions(row.key, capabilityForTarget(target));
                const routeId = row.mapping.routeId.trim().toLowerCase();
                const available = row.key.status !== 'error' && (exposed.length === 0 || exposed.some(value => value.trim().toLowerCase() === routeId));
                return <motion.div key={`${row.key.id}:${row.index}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.04, type: 'spring', stiffness: 420, damping: 32 }} className="flex items-center gap-2 rounded-lg bg-[var(--isl-surface-2)] px-2 py-1.5">
                    <span className={`w-14 shrink-0 text-[10px] font-bold ${index === 0 ? 'text-[var(--isl-mint-deep)]' : 'text-[var(--isl-ink-soft)]'}`}>{index === 0 ? t('settingsExtra.mapping.primary') : t('settingsExtra.mapping.fallback', index)}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--isl-ink)]">{row.key.name || PROVIDER_LABELS[row.key.provider] || row.key.provider} · {row.mapping.routeId}</span>
                    <span className={`shrink-0 text-[10px] ${available ? 'text-emerald-600' : 'text-red-500'}`}>{available ? t('settingsExtra.mapping.available') : t('settingsExtra.mapping.unavailable')}</span>
                    <button type="button" disabled={index === 0} onClick={() => moveRoute(target, index, -1)} className="isl-icon-btn h-6 w-6 text-[10px] disabled:opacity-25" aria-label={t('settingsExtra.mapping.moveUp')}>↑</button>
                    <button type="button" disabled={index === rows.length - 1} onClick={() => moveRoute(target, index, 1)} className="isl-icon-btn h-6 w-6 text-[10px] disabled:opacity-25" aria-label={t('settingsExtra.mapping.moveDown')}>↓</button>
                    <button type="button" onClick={() => removeRoute(row.key, row.index)} className="isl-icon-btn h-6 w-6 text-[10px] text-red-500" aria-label={t('settingsExtra.mapping.removeRoute')}>×</button>
                </motion.div>;
            })}
            <select aria-label={t('settingsExtra.mapping.addRoute', modeLabel)} value="" onChange={event => addRoute(target, event.target.value)} className="isl-well h-8 w-full px-2 text-xs text-[var(--isl-ink)] outline-none">
                <option value="">{t('settingsExtra.mapping.addPrimaryOrFallback')}</option>
                {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
        </div>;
    };

    // 可折叠卡片外壳：标题 + 徽标 + 箭头 + 弹性展开
    const collapsibleCard = (targetKey: string, title: string, badge: string, badgeGood: boolean, children: React.ReactNode, testId?: string) => {
        const expanded = expandedTargets.has(targetKey);
        return <div key={targetKey} data-testid={testId || `mapping-card-${targetKey}`} className="overflow-hidden rounded-xl border border-[var(--isl-border)] bg-[var(--isl-card)]">
            <button type="button" aria-expanded={expanded} onClick={() => toggleTarget(targetKey)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-[var(--isl-surface-2)]">
                <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[var(--isl-ink)]">{title}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeGood ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>{badge}</span>
                <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }} className="shrink-0 text-[var(--isl-ink-ghost)]"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg></motion.span>
            </button>
            <AnimatePresence initial={false}>
                {expanded && <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 360, damping: 34, mass: 0.9 }}
                    style={{ overflow: 'hidden' }}
                >
                    <div className="border-t border-[var(--isl-border)] px-3 py-2.5">{children}</div>
                </motion.div>}
            </AnimatePresence>
        </div>;
    };

    const renderTarget = (target: RouteMappingTarget, title: string) => {
        const rows = rowsFor(target);
        const targetKey = routeTargetKey(target);
        return collapsibleCard(targetKey, title, rows.length ? t('settingsExtra.mapping.routeCount', rows.length) : t('settingsExtra.mapping.notConfigured'), rows.length > 0,
            targetBody(target, title));
    };

    const allProducts = [...getProductModels('image'), ...getProductModels('video')];
    const renderProductSection = (capability: 'image' | 'video') => {
        const title = t(capability === 'image' ? 'settingsExtra.mapping.imageModels' : 'settingsExtra.mapping.videoModels');
        const detail = t(capability === 'image' ? 'settingsExtra.mapping.imageModelsDetails' : 'settingsExtra.mapping.videoModelsDetails');
        // 按产品模型分组：同一模型的不同生成方式（文生/图生/首尾帧/参考）收进同一张卡
        const grouped = new Map<string, Array<RouteMappingTarget & { kind: 'product-mode'; productModelId: string; mode: ProductModelMode }>>();
        productTargets
            .filter((target): target is RouteMappingTarget & { kind: 'product-mode'; productModelId: string; mode: ProductModelMode } => (
                target.kind === 'product-mode' && getProductModel(target.productModelId)?.capability === capability
            ))
            .forEach(target => {
                const list = grouped.get(target.productModelId) || [];
                list.push(target);
                grouped.set(target.productModelId, list);
            });
        return <div className="space-y-2">
            <div><div className="text-sm font-extrabold text-[var(--isl-ink)]">{title}</div><div className="mt-0.5 text-xs text-[var(--isl-ink-soft)]">{detail}</div></div>
            {grouped.size > 0 ? [...grouped.entries()].map(([modelId, targets]) => {
                const model = getProductModel(modelId);
                const displayName = model?.name || modelId;
                const totalRows = targets.reduce((sum, target) => sum + rowsFor(target).length, 0);
                const modeTargets = targets.map(target => ({
                    mode: productModeLabel(target.mode),
                    target,
                }));
                return collapsibleCard(`model:${modelId}`, `${displayName}`, totalRows ? t('settingsExtra.mapping.routeCount', totalRows) : t('settingsExtra.mapping.notConfigured'), totalRows > 0,
                    <div className="space-y-3">
                        {modeTargets.map(({ mode, target }, index) => <div key={`${modelId}:${target.mode}`}>
                            {index > 0 && <div className="my-2 border-t border-[var(--isl-border)]" />}
                            {targetBody(target, mode)}
                        </div>)}
                    </div>, `mapping-card-${modelId}`);
            }) : <div className="rounded-2xl border border-dashed border-[var(--isl-border)] px-3 py-4 text-xs text-[var(--isl-ink-soft)]">{t('settingsExtra.mapping.notApplied', title)}</div>}
        </div>;
    };
    return <section className="space-y-3" data-testid="model-mapping-sections">
        <div><div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--isl-ink-ghost)]">{t('settingsExtra.mappingTitle')}</div><p className="mb-0 mt-1 text-xs leading-5 text-[var(--isl-ink-soft)]">{t('settingsExtra.mappingIntro')}</p></div>
        {detectedSuggestions.length > 0 && <div className="rounded-2xl border border-[var(--isl-mint)] bg-[var(--isl-mint-bg)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div><div className="text-sm font-extrabold text-[var(--isl-mint-deep)]">{t('settingsExtra.mapping.detectedTitle', detectedSuggestions.length)}</div><div className="mt-1 text-xs text-[var(--isl-ink-soft)]">{t('settingsExtra.mapping.detectedDetails')}</div></div>
                <button type="button" onClick={applyDetectedSuggestions} className="isl-chip isl-chip--active h-9 px-3 text-xs" aria-label={t('settingsExtra.mapping.applyAllSuggestions')}>{t('settingsExtra.mapping.applyAllSuggestions')}</button>
            </div>
            <div className="mt-2 grid gap-1 md:grid-cols-2">
                {detectedSuggestions.map(({ key, suggestion }) => {
                    const target = suggestion.target;
                    const model = target.kind === 'product-mode' ? getProductModel(target.productModelId) : undefined;
                    return <div key={`${key.id}:${routeTargetKey(target)}:${suggestion.routeId}`} className="truncate rounded-lg bg-[var(--isl-surface)] px-2.5 py-1.5 text-[11px] text-[var(--isl-ink)]">{model?.name || t('settingsExtra.mapping.mediaModelFallback')} · {target.kind === 'product-mode' ? productModeLabel(target.mode) : ''} → {suggestion.routeId}</div>;
                })}
            </div>
        </div>}
        {runtimeSuggestions.length > 0 && <div className="rounded-2xl border border-[var(--isl-mint)] bg-[var(--isl-mint-bg)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div><div className="text-sm font-extrabold text-[var(--isl-mint-deep)]">{t('settingsExtra.mapping.runtimeSuggestionsTitle')}</div><div className="mt-1 text-xs text-[var(--isl-ink-soft)]">{t('settingsExtra.mapping.runtimeSuggestionsDetails')}</div></div>
            </div>
            <div className="mt-2 grid gap-1 md:grid-cols-2">
                {runtimeSuggestions.map(({ provider, target, routeId }) => {
                    const productModelId = target.kind === 'product-mode' ? target.productModelId : '';
                    const model = target.kind === 'product-mode' ? getProductModel(target.productModelId) : undefined;
                    return <div key={`${provider}:${routeTargetKey(target)}:${routeId}`} className="truncate rounded-lg bg-[var(--isl-surface)] px-2.5 py-1.5 text-[11px] text-[var(--isl-ink)]">{model?.name || productModelId} · {target.kind === 'product-mode' ? productModeLabel(target.mode) : ''} → {routeId}</div>;
                })}
            </div>
        </div>}
        {renderProductSection('image')}
        {renderProductSection('video')}
        <div className="rounded-2xl border border-[var(--isl-border)] bg-[var(--isl-surface-2)] p-3">
            <div className="mb-2 text-sm font-bold text-[var(--isl-ink)]">{t('settingsExtra.mapping.manualTitle')}</div>
            <div className="settings-route-add grid gap-2 md:grid-cols-[1.2fr_1fr_1.6fr_auto]">
                <select aria-label={t('settingsExtra.mapping.productModel')} value={productModelId} onChange={event => { const next = getProductModel(event.target.value); setProductModelId(event.target.value); setProductMode(next?.capabilities.modes[0] || 'text-to-image'); setRouteChoice(''); }} className="isl-well h-9 px-2 text-xs text-[var(--isl-ink)] outline-none"><option value="">{t('settingsExtra.mapping.selectProductModel')}</option>{allProducts.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select>
                <select aria-label={t('settingsExtra.mapping.generationMode')} value={productMode} disabled={!product} onChange={event => { setProductMode(event.target.value as ProductModelMode); setRouteChoice(''); }} className="isl-well h-9 px-2 text-xs text-[var(--isl-ink)] outline-none disabled:opacity-40">{(product?.capabilities.modes || []).map(mode => <option key={mode} value={mode}>{productModeLabel(mode)}</option>)}</select>
                <select aria-label={t('settingsExtra.mapping.serviceRoute')} value={routeChoice} disabled={!product} onChange={event => setRouteChoice(event.target.value)} className="isl-well h-9 min-w-0 px-2 text-xs text-[var(--isl-ink)] outline-none disabled:opacity-40"><option value="">{t('settingsExtra.mapping.selectServiceRoute')}</option>{product ? routeOptions({ kind: 'product-mode', productModelId, mode: productMode }).map(option => <option key={option.value} value={option.value}>{option.label}</option>) : null}</select>
                <button type="button" disabled={!product || !routeChoice} onClick={() => { addRoute({ kind: 'product-mode', productModelId, mode: productMode }, routeChoice); setRouteChoice(''); }} className="isl-chip px-3 text-xs disabled:opacity-40">{t('settingsExtra.mapping.add')}</button>
            </div>
        </div>
        <div className="space-y-2"><div><div className="text-sm font-extrabold text-[var(--isl-ink)]">{t('settingsExtra.mapping.textAndAgent')}</div><div className="mt-0.5 text-xs text-[var(--isl-ink-soft)]">{t('settingsExtra.mapping.textAndAgentDetails')}</div></div>{RUNTIME_TARGETS.map(capability => renderTarget({ kind: 'runtime-capability', capability }, t(`settingsExtra.runtimeTarget.${capability}.label`)))}</div>
        {userApiKeys.length === 0 && runtimeSuggestions.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--isl-border)] p-5 text-center text-xs text-[var(--isl-ink-soft)]">{t('settingsExtra.addMappingFirst')}</div>}
    </section>;
}

type ProviderPreset = {
    id: string;
    name: string;
    shortName: string;
    labelKey?: string;
    shortNameKey?: string;
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
        name: 'Custom configuration',
        shortName: 'CU',
        labelKey: 'settingsExtra.preset.custom',
        shortNameKey: 'settingsExtra.preset.customShort',
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
        defaultModel: 'deepseek-v4-flash',
        models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
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
        name: 'RunningHub standard models',
        shortName: 'RH',
        labelKey: 'settingsExtra.preset.runningHubStandard',
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
        id: 'runninghub-global',
        name: 'RunningHub global site',
        shortName: 'RH',
        labelKey: 'settingsExtra.preset.runningHubGlobal',
        provider: 'runningHub',
        websiteUrl: 'https://www.runninghub.ai',
        baseUrl: 'https://www.runninghub.ai/openapi/v2',
        capabilities: ['image', 'video'],
        requestFormat: 'native',
        authHeaderName: 'Authorization',
        authScheme: 'Bearer',
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
    t,
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
    const [modelDiscoveryUnavailable, setModelDiscoveryUnavailable] = React.useState(false);
    const [autoDetectedProvider, setAutoDetectedProvider] = React.useState<AIProvider | null>(null);
    const [endpointFlavor, setEndpointFlavor] = React.useState<'google' | 'openai-compatible' | 'openrouter-compatible' | null>(null);
    const [detectedCapabilities, setDetectedCapabilities] = React.useState<AICapability[]>([]);
    const [activeTab, setActiveTab] = React.useState<'api' | 'models' | 'security'>('api');
    const [mobileDetailOpen, setMobileDetailOpen] = React.useState(false);
    const [showAdvancedApi, setShowAdvancedApi] = React.useState(false);
    const [runtimeProviders, setRuntimeProviders] = React.useState<RuntimeProviderStatus[] | null>(null);
    const settingsDialogRef = React.useRef<HTMLDivElement>(null);
    const configuredRuntimeProviders = runtimeProviders?.filter(item => item.ready) || [];

    React.useEffect(() => {
        if (!isOpen) setMobileDetailOpen(false);
    }, [isOpen]);

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
    const presetLabel = (preset: ProviderPreset) => preset.labelKey ? t(preset.labelKey) : preset.name;
    const presetShortLabel = (preset: ProviderPreset) => preset.shortNameKey ? t(preset.shortNameKey) : preset.shortName;

    const inputClass = 'isl-well w-full px-3 py-2.5 text-sm text-[var(--isl-ink)] outline-none placeholder:text-[var(--isl-ink-ghost)]';
    const chipClass = 'isl-chip px-3 py-2 text-sm';
    const sectionPanelClass = 'rounded-2xl border-[1.5px] border-[var(--isl-border)] bg-[var(--isl-surface-2)] p-3';

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
        setModelDiscoveryUnavailable(false);
        setValidationResult(null);
        if (options.fillName) setDisplayName(preset.id === 'custom' ? '' : presetLabel(preset));
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
        setModelDiscoveryUnavailable(false);
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
        let result: Awaited<ReturnType<typeof validateApiKey>>;
        try {
            result = await validateApiKey(provider, apiKey.trim(), requestedBaseUrl, extraConfig);
        } catch (error) {
            result = {
                ok: false,
                message: error instanceof Error ? error.message : t('settingsExtra.errors.unknownValidation'),
            };
        }
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
                message: t(
                    'settingsExtra.errors.unsupportedCapabilities',
                    unsupportedCapabilities.map(capability => t(capabilityLabelKeys[capability])).join(' / '),
                    detectedCaps.map(capability => t(capabilityLabelKeys[capability])).join(' / '),
                ),
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
        setModelDiscoveryUnavailable(false);
        setAutoDetectedProvider(null);
        setEndpointFlavor(null);
        setDetectedCapabilities([]);
        setShowKeyModal(false);
    };

    React.useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (showKeyModal) handleCancelEdit();
                else onClose();
                return;
            }
            if (event.key !== 'Tab') return;
            const dialog = settingsDialogRef.current;
            if (!dialog) return;
            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
                'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            )).filter(element => element.getClientRects().length > 0);
            if (!focusable.length) return;
            const active = document.activeElement;
            if (!dialog.contains(active)) {
                event.preventDefault();
                (event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        const firstFocusable = settingsDialogRef.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]');
        firstFocusable?.focus();
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, showKeyModal]);

    /** 联网拉取当前 Provider 可用的模型列表 */
    const handleFetchModels = async (targetProvider: AIProvider, targetKey: string, targetBaseUrl?: string) => {
        if (!targetKey.trim()) return;
        setIsFetchingModels(true);
        setFetchError(null);
        setModelDiscoveryUnavailable(false);
        const requestFormat = targetProvider === 'custom' ? extraConfig.requestFormat : undefined;
        if (requestFormat === 'anthropic' || (requestFormat === 'native' && targetProvider !== 'runningHub')) {
            setFetchedModels([]);
            setFetchError(t(requestFormat === 'native'
                ? 'settingsExtra.errors.nativeModelListUnavailable'
                : 'settingsExtra.errors.anthropicModelListUnavailable'));
            setModelDiscoveryUnavailable(true);
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
                setFetchError(t('settingsExtra.errors.runningHubModelsUnavailable'));
                setModelDiscoveryUnavailable(true);
            } else if (result.ok) {
                setFetchedModels([]);
                setFetchError(result.error || t('settingsExtra.errors.modelsNotDetected'));
                setModelDiscoveryUnavailable(true);
            } else if (!result.ok) {
                setFetchError(result.error || t('settingsExtra.errors.fetchFailed'));
            }
        } catch {
            setFetchError(t('settingsExtra.errors.network'));
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
            } else if (/^sk-/i.test(pasted.trim())) {
                setAutoDetectedProvider(null);
                setFetchError(null);
                setModelDiscoveryUnavailable(false);
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
        a.download = `iris-api-configs-${new Date().toISOString().slice(0, 10)}.json`;
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
                if (!Array.isArray(parsed)) throw new Error(t('settingsExtra.transfer.invalidFormat'));
                const legalProviders = new Set(Object.keys(providerBaseUrl));
                let importedCount = 0;
                let skippedCount = 0;
                for (const item of parsed) {
                    // 逐项结构校验：provider 合法、key 非空（排除导出占位 "***"），
                    // routeMappings / pricingRules 若存在必须是数组且每项字段齐全；不合法项跳过并计数
                    const routeMappingsOk = item.routeMappings == null
                        || (Array.isArray(item.routeMappings) && item.routeMappings.every(
                            (mapping: RouteMappingBinding) => mapping?.target?.kind && mapping.routeId,
                        ));
                    const pricingRulesOk = item.pricingRules == null
                        || (Array.isArray(item.pricingRules) && item.pricingRules.every(
                            (rule: ApiPricingRule) => rule?.id,
                        ));
                    const valid = item && typeof item === 'object'
                        && legalProviders.has(item.provider)
                        && typeof item.key === 'string' && item.key.trim() !== '' && item.key !== '***'
                        && routeMappingsOk
                        && pricingRulesOk;
                    if (!valid) { skippedCount++; continue; }
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
                    importedCount++;
                }
                alert(t('settingsExtra.transfer.importComplete', importedCount, skippedCount));
            } catch {
                alert(t('settingsExtra.transfer.importFailed'));
            }
        };
        input.click();
    };

    /** 带 Key 导出（含明文，用于设备迁移） */
    const handleExportKeysWithSecrets = () => {
        if (!confirm(t('settingsExtra.transfer.exportSecretsConfirm'))) return;
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
        a.download = `iris-api-configs-full-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    /** 一键测试所有 Key */
    const handleBatchTest = async () => {
        setIsBatchTesting(true);
        setBatchTestResults({});
        const results: Record<string, { ok: boolean; message?: string }> = {};
        for (const item of userApiKeys) {
            try {
                const result = await validateApiKey(item.provider, item.key, item.baseUrl, item.extraConfig);
                results[item.id] = result;
                onUpdateApiKey(item.id, { status: result.ok ? 'ok' : 'error' });
            } catch (error) {
                // 单个 Key 校验抛异常（网络/解析失败）不中断批量流程，记为失败后继续下一项
                results[item.id] = { ok: false, message: String(error?.message || error) };
            }
            setBatchTestResults({ ...results });
        }
        setIsBatchTesting(false);
    };

    if (!isOpen) return null;

    return (
        <div ref={settingsDialogRef} role="dialog" aria-modal="true" aria-labelledby="settings-title" data-testid="settings-dialog" className="theme-aware settings-overlay fixed inset-0 z-100 flex items-center justify-center bg-black/35 backdrop-blur-sm" onClick={onClose}>
            <div
                className="isl-shell settings-dialog relative w-[94%] max-w-6xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="settings-dialog__header mb-6 flex items-center justify-between">
                    <div>
                        <h3 id="settings-title" className="text-xl font-extrabold text-[var(--isl-ink)]">{t('settingsExtra.title')}</h3>
                        <p className="mt-1 text-sm text-[var(--isl-ink-soft)]">{t('settingsExtra.description')}</p>
                    </div>
                    <button
                        type="button"
                        aria-label={t('settingsExtra.close')}
                        title={t('settingsExtra.close')}
                        onClick={onClose}
                        className={`settings-dialog__close flex h-10 w-10 items-center justify-center rounded-2xl border transition ${
                            isDark ? 'border-[#2A3140] text-[#98A2B3] hover:bg-[#1B2029]' : 'border-[#E4E7EC] text-[#667085] hover:bg-[#F9FAFB]'
                        }`}
                    >
                        ×
                    </button>
                </div>

                {/* Wide/medium tabs; compact mode uses the same state as a
                    mobile master-detail list below. */}
                <div className={`settings-dialog__tabs mb-6 flex gap-1 border-b border-[var(--isl-border)] ${mobileDetailOpen ? 'is-detail' : ''}`}>
                    {([
                        { key: 'api', label: t('settingsExtra.apiTab') },
                        { key: 'models', label: t('settingsExtra.modelsTab') },
                        { key: 'security', label: t('settingsExtra.securityTab') },
                    ] as const).map(tab => (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => { setActiveTab(tab.key); setMobileDetailOpen(true); }}
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

                <nav className="settings-dialog__mobile-nav" aria-label={t('settingsExtra.categoryAria')}>
                    {([
                        { key: 'api', label: t('settingsExtra.apiTab'), detail: t('settingsExtra.apiTabDetail') },
                        { key: 'models', label: t('settingsExtra.modelsTab'), detail: t('settingsExtra.modelsTabDetail') },
                        { key: 'security', label: t('settingsExtra.securityTab'), detail: t('settingsExtra.securityTabDetail') },
                    ] as const).map(item => (
                        <button key={item.key} type="button" onClick={() => { setActiveTab(item.key); setMobileDetailOpen(true); }}>
                            <span><strong>{item.label}</strong><small>{item.detail}</small></span><span aria-hidden="true">›</span>
                        </button>
                    ))}
                </nav>

                <AnimatePresence mode="wait">
                <motion.div
                    key={activeTab}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className={`settings-dialog__body space-y-6 ${mobileDetailOpen ? 'is-detail' : ''}`}
                >
                <button type="button" className="settings-dialog__mobile-back" onClick={() => setMobileDetailOpen(false)}>{t('settingsExtra.back')}</button>
                {activeTab === 'api' && (
                    <>
                    {/* ── 统一 API 配置管理 ───────────────────────── */}
                    {runtimeProviders !== null && (
                        <section className={sectionPanelClass}>
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <div className="text-sm font-extrabold text-[var(--isl-ink)]">{t('settingsExtra.runtime.credentialsTitle')}</div>
                                    <div className="mt-1 text-xs text-[var(--isl-ink-soft)]">{t('settingsExtra.runtime.credentialsDetails')}</div>
                                </div>
                                <span className="rounded-full bg-[var(--isl-card)] px-2.5 py-1 text-[11px] text-[var(--isl-ink-soft)]">{t('settingsExtra.runtime.badge')}</span>
                            </div>
                            {configuredRuntimeProviders.length > 0 ? (
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                    {configuredRuntimeProviders.map(item => {
                                        const availableCredentials = (item.credentials || []).filter(credential => credential.available);
                                        return (
                                            <div key={item.provider} className="rounded-xl border border-[var(--isl-border)] px-3 py-2.5">
                                                <div className="flex items-center justify-between gap-2 text-sm font-semibold text-[var(--isl-ink)]">
                                                    <span>{item.provider === 'runningHub' ? 'RunningHub' : item.provider === 'google' ? 'Google Gemini' : item.provider}</span>
                                                    <span className="text-emerald-500">{t('settingsExtra.runtime.configured')}</span>
                                                </div>
                                                <div className="mt-1 text-[11px] text-[var(--isl-ink-soft)]">
                                                    {t('settingsExtra.runtime.credentialCount', availableCredentials.length || 0)}
                                                </div>
                                                <div className="mt-2 truncate text-[11px] text-[var(--isl-ink-soft)]">
                                                    {availableCredentials.length
                                                        ? t('settingsExtra.runtime.availableCredentials', availableCredentials.map(credential => credential.label || credential.credentialId || t('settingsExtra.runtime.credentialFallback')).join(t('settingsExtra.runtime.credentialSeparator')))
                                                        : t('settingsExtra.runtime.noAvailableCredentials')}
                                                </div>
                                                <div className="mt-2 text-[10px] text-[var(--isl-ink-soft)]">{t('settingsExtra.runtime.routeUsage')}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="mt-3 rounded-xl border border-dashed border-[var(--isl-border)] px-3 py-3 text-xs text-[var(--isl-ink-soft)]">
                                    {t('settingsExtra.runtime.noCredentials')}
                                </div>
                            )}
                            {runtimeProviders.some(item => item.provider === 'runningHub' && item.ready) && !userApiKeys.some(item => item.provider === 'runningHub') && (
                                <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                                    {t('settingsExtra.runtime.runningHubBrowserKeyNotice')}
                                </div>
                            )}
                        </section>
                    )}
                    <section className="settings-api-section space-y-3">
                        <div className="settings-api-section__header flex items-center justify-between">
                            <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                                🔑 {t('settingsExtra.api.title')}
                            </div>
                            <div className="settings-api-actions flex items-center gap-2">
                                {userApiKeys.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setShowAdvancedApi(current => !current)}
                                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                                            isDark ? 'border-[#2A3140] text-[#98A2B3] hover:bg-[#252C39]' : 'border-[#E4E7EC] text-[#667085] hover:bg-[#F2F4F7]'
                                        }`}
                                    >
                                        {showAdvancedApi ? t('settingsExtra.api.collapseDetails') : t('settingsExtra.api.expandDetails')}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={handleImportKeys}
                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                                        isDark ? 'border-[#2A3140] text-[#98A2B3] hover:bg-[#252C39]' : 'border-[#E4E7EC] text-[#667085] hover:bg-[#F2F4F7]'
                                    }`}
                                >
                                    {t('settingsExtra.api.import')}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleExportKeysWithSecrets}
                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                                        isDark ? 'border-[#2A3140] text-[#98A2B3] hover:bg-[#252C39]' : 'border-[#E4E7EC] text-[#667085] hover:bg-[#F2F4F7]'
                                    }`}
                                >
                                    {t('settingsExtra.api.export')}
                                </button>
                                {userApiKeys.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={handleBatchTest}
                                        disabled={isBatchTesting}
                                        className="isl-chip px-2.5 py-1 text-[11px] disabled:opacity-50"
                                    >
                                        {isBatchTesting ? t('settingsExtra.api.testing') : t('settingsExtra.api.testAll')}
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
                                    {t('settingsExtra.addService')}
                                </button>
                            </div>
                        </div>

                        <div className="settings-service-list space-y-2">
                            {userApiKeys.length > 0 && !showAdvancedApi ? (
                                <div className="rounded-2xl border border-[var(--isl-border)] bg-[var(--isl-surface-2)] px-4 py-4 text-sm text-[var(--isl-ink)]">
                                    <div className="font-medium">{t('settingsExtra.api.configuredCount', userApiKeys.length)}</div>
                                    <div className="mt-1 text-xs text-[var(--isl-ink-soft)]">{t('settingsExtra.api.defaultService', userApiKeys.find(item => item.isDefault)?.name || t('settingsExtra.api.notSpecified'))}</div>
                                </div>
                            ) : userApiKeys.length === 0 ? (
                                <div className={`rounded-2xl border border-dashed px-4 py-6 text-center text-sm ${
                                    isDark ? 'border-[#3A4458] text-[#98A2B3]' : 'border-[#D0D5DD] text-[#667085]'
                                }`}>
                                    <div className="mb-2 text-lg">🔑</div>
                                    <div className="font-medium">{t('settingsExtra.emptyServicesTitle')}</div>
                                    <div className="mt-1 text-xs">{t('settingsExtra.emptyServicesHint')}</div>
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
                                        className={`settings-service-card flex items-center justify-between rounded-2xl border px-4 py-3 ${
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
                                                }`} title={item.status === 'ok' ? t('settingsExtra.api.verified') : item.status === 'error' ? t('settingsExtra.api.verificationFailed') : t('settingsExtra.api.unverified')} />
                                                <span className={`truncate text-sm font-medium ${isDark ? 'text-[#F3F4F6]' : 'text-[#101828]'}`}>{item.name || PROVIDER_LABELS[item.provider] || item.provider}</span>
                                                {editingKeyId === item.id && (
                                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                                        isDark ? 'bg-[#1B2330] text-[#7CB4FF]' : 'bg-[#EFF6FF] text-[#1D4ED8]'
                                                    }`}>{t('settingsExtra.api.editing')}</span>
                                                )}
                                            </div>
                                            <div className={`mt-1 truncate text-xs ${isDark ? 'text-[#7CB4FF]' : 'text-[#175CD3]'}`}>
                                                {item.extraConfig?.websiteUrl || item.baseUrl || t('settingsExtra.api.localConfiguration')}
                                            </div>
                                            <div className={`mt-1 text-[11px] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                                                {maskKey(item.key)}
                                                {item.extraConfig?.requestFormat && <span> · {item.extraConfig.requestFormat}</span>}
                                                {item.defaultModel && <span> · {t('settingsExtra.api.defaultModel')} {item.defaultModel}</span>}
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-1.5">
                                                {(item.capabilities || []).map(capability => (
                                                    <span key={capability} className={`rounded-full px-2 py-1 text-[11px] ${
                                                        isDark ? 'bg-[#1B2029] text-[#98A2B3]' : 'bg-[#F2F4F7] text-[#667085]'
                                                    }`}>
                                                        {t(capabilityLabelKeys[capability])}
                                                    </span>
                                                ))}
                                                <span className={`rounded-full px-2 py-1 text-[11px] ${isDark ? 'bg-[#1B2029] text-[#98A2B3]' : 'bg-[#F2F4F7] text-[#667085]'}`}>
                                                    {t('settingsExtra.api.mappingCount', item.routeMappings?.length || 0)}
                                                </span>
                                                {item.budgetPolicy?.enabled && <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600">{t('settingsExtra.api.budget', item.budgetPolicy.currency, item.budgetPolicy.monthlyLimit)}</span>}
                                            </div>
                                            {/* Usage stats */}
                                            {usageSummary?.get(item.id) && (() => {
                                                const u = usageSummary.get(item.id)!;
                                                if (u.totalCalls === 0) return null;
                                                return (
                                                    <div className={`settings-service-card__usage mt-1.5 flex gap-3 text-[10px] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                                                        <span>{t('settingsExtra.api.callCount', u.totalCalls)}</span>
                                                        {u.errorCalls > 0 && <span className="text-red-400">{t('settingsExtra.api.failureCount', u.errorCalls)}</span>}
                                                        <span>{t('settingsExtra.api.totalCost')} {formatCost(u.totalCostCents, u.currency)}</span>
                                                        <span>{t('settingsExtra.api.monthCost')} {formatCost(u.currentMonthCostCents, u.currency)}</span>
                                                        {u.pendingCostCalls > 0 && <span className="text-amber-500">{t('settingsExtra.api.pendingReconciliation', u.pendingCostCalls)}</span>}
                                                        <span>{t('settingsExtra.api.last24Hours')} {u.last24h}</span>
                                                    </div>
                                                );
                                            })()}
                                            </div>
                                        </div>
                                        <div className="settings-service-actions ml-3 flex items-center gap-2">
                                            {!item.isDefault ? (
                                                <button type="button" onClick={() => onSetDefaultApiKey(item.id)} className={`${chipClass} flv-elastic`}>
                                                    {t('settingsExtra.api.makeDefault')}
                                                </button>
                                            ) : (
                                                <span className={`rounded-full px-3 py-2 text-xs font-medium ${
                                                    isDark ? 'bg-[#123524] text-[#75E0A7]' : 'bg-[#ECFDF3] text-[#027A48]'
                                                }`}>
                                                    {t('settingsExtra.api.default')}
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handleStartEdit(item)}
                                                className={`rounded-full border px-3 py-2 text-xs font-medium ${
                                                    isDark ? 'border-[#2A3140] text-[#D0D5DD] hover:bg-[#252C39]' : 'border-[#E4E7EC] text-[#475467] hover:bg-[#F2F4F7]'
                                                }`}
                                            >
                                                {t('settingsExtra.api.edit')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (!confirm(t('settingsExtra.api.deleteConfirm', item.name || PROVIDER_LABELS[item.provider] || item.provider))) return;
                                                    onDeleteApiKey(item.id);
                                                }}
                                                className={`rounded-full border px-3 py-2 text-xs font-medium ${
                                                    isDark ? 'border-[#7A271A] text-[#FDA29B]' : 'border-[#FECACA] text-[#DC2626]'
                                                }`}
                                            >
                                                {t('settingsExtra.api.delete')}
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

                {activeTab === 'models' && <RouteMappingEditor userApiKeys={userApiKeys} onUpdateApiKey={onUpdateApiKey} runtimeProviders={runtimeProviders} t={t} />}

                {activeTab === 'security' && (
                    <section className="space-y-3">
                        <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                            🔒 {t('settingsExtra.security.title')}
                        </div>
                        <div className={`flex items-center justify-between rounded-2xl p-4 ${isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]'}`}>
                            <div>
                                <div className={`text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>{t('settingsExtra.security.clearOnExit')}</div>
                                <div className={`mt-1 text-xs ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>{t('settingsExtra.security.clearOnExitDetails')}</div>
                            </div>
                            <label className="ml-4 inline-flex shrink-0 cursor-pointer items-center">
                                <input
                                    type="checkbox"
                                    className="sr-only"
                                    checked={clearKeysOnExit}
                                    onChange={(event) => setClearKeysOnExit(event.target.checked)}
                                    aria-label={t('settingsExtra.security.clearOnExit')}
                                    title={t('settingsExtra.security.clearOnExit')}
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
                            ✅ {t('settingsExtra.security.encryptedStorage')}
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
                    className="settings-key-overlay fixed inset-0 z-150 overflow-y-auto bg-black/40 backdrop-blur-sm"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    onClick={handleCancelEdit}
                >
                    <motion.div
                        className="settings-key-positioner flex min-h-[100dvh] items-end justify-center p-2 sm:min-h-full sm:items-center sm:p-6"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.14 }}
                    >
                    <motion.div
                        className="isl-shell settings-key-dialog relative flex min-h-0 max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden sm:max-h-[calc(100dvh-3rem)]"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="settings-key-dialog-title"
                        initial={{ opacity: 0, y: 24, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 16, scale: 0.98 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="settings-key-dialog__header mb-0 flex items-center justify-between px-6 pb-4 pt-6">
                            <h4 id="settings-key-dialog-title" className="text-base font-extrabold text-[var(--isl-ink)]">
                                {t(editingKeyId ? 'settingsExtra.keyDialog.editTitle' : 'settingsExtra.keyDialog.addTitle')}
                            </h4>
                            <button type="button" title={t('settingsExtra.keyDialog.close')} aria-label={t('settingsExtra.keyDialog.close')} onClick={handleCancelEdit} className="rounded-full p-1.5 text-[var(--isl-ink-soft)] transition hover:bg-black/5">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <div className="settings-key-dialog__body min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-4">
                            {/* Common AI service presets */}
                            {!editingKeyId && (
                                <div className={sectionPanelClass}>
                                    <div className="mb-3 flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-sm font-bold text-[var(--isl-ink)]">{t('settingsExtra.keyDialog.commonServices')}</div>
                                            <div className="mt-0.5 text-[11px] text-[var(--isl-ink-soft)]">{t('settingsExtra.keyDialog.commonServicesDetails')}</div>
                                        </div>
                                        <div className="shrink-0 rounded-full bg-[var(--isl-card)] px-2.5 py-1 text-[11px] text-[var(--isl-ink-soft)]">
                                            {t('settingsExtra.keyDialog.canEdit')}
                                        </div>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        {PROVIDER_PRESETS.map(preset => {
                                            const presetActive = provider === preset.provider && (displayName === presetLabel(preset) || (preset.id === 'custom' && !displayName));
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
                                                    {presetShortLabel(preset)}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate font-bold">{presetLabel(preset)}</span>
                                                    <span className="mt-0.5 block truncate text-[11px] opacity-75">
                                                        {preset.defaultModel || (preset.id === 'custom'
                                                            ? t('settingsExtra.preset.customEndpoint')
                                                            : preset.provider === 'runningHub'
                                                                ? t('settingsExtra.keyDialog.runningHubGetModels')
                                                                : PROVIDER_LABELS[preset.provider] || preset.provider)}
                                                    </span>
                                                </span>
                                                {preset.featured && (
                                                    <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold text-[#7C3AED]">
                                                        {t('settingsExtra.keyDialog.recommended')}
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
                                    <span className="mb-1.5 block text-sm font-bold text-[var(--isl-ink)]">{t('settingsExtra.keyDialog.serviceName')}</span>
                                    <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t('settingsExtra.keyDialog.serviceNamePlaceholder')} className={inputClass} />
                                </label>
                                <label>
                                    <span className="mb-1.5 block text-sm font-bold text-[var(--isl-ink)]">{t('settingsExtra.keyDialog.notes')}</span>
                                    <input value={extraConfig.remark || ''} onChange={(event) => updateExtraConfig('remark', event.target.value)} placeholder={t('settingsExtra.keyDialog.notesPlaceholder')} className={inputClass} />
                                </label>
                            </div>

                            <label className="block">
                                <span className="mb-1.5 block text-sm font-bold text-[var(--isl-ink)]">{t('settingsExtra.keyDialog.website')}</span>
                                <input value={extraConfig.websiteUrl || ''} onChange={(event) => updateExtraConfig('websiteUrl', event.target.value)} placeholder={t('settingsExtra.keyDialog.websitePlaceholder')} className={inputClass} />
                            </label>

                            <div className="settings-key-dialog__key-row flex gap-2">
                                <label className="min-w-0 flex-1">
                                    <span className={`mb-1.5 block text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>{t('settingsExtra.keyDialog.apiKey')}</span>
                                    <input
                                        value={apiKey}
                                        onChange={(event) => setApiKey(event.target.value)}
                                        onPaste={handleKeyPaste}
                                        type={showKey ? 'text' : 'password'}
                                        placeholder={t('settingsExtra.keyDialog.keyPlaceholder')}
                                        className={`${inputClass} flv-safe-input`}
                                        name="apiKey"
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                </label>
                                <button type="button" onClick={() => setShowKey(prev => !prev)} aria-label={t(showKey ? 'settingsExtra.keyDialog.hideKey' : 'settingsExtra.keyDialog.showKey')} aria-pressed={showKey} className={`${chipClass} flv-elastic`}>
                                    {t(showKey ? 'settingsExtra.keyDialog.hideKey' : 'settingsExtra.keyDialog.showKey')}
                                </button>
                            </div>

                            {/* 自动识别结果提示 */}
                            {autoDetectedProvider && (
                                <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
                                    isDark ? 'bg-[#1B2330] text-[#7CB4FF]' : 'bg-[#EFF6FF] text-[#1D4ED8]'
                                }`}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                                    {t('settingsExtra.keyDialog.detectedProvider')} <strong>{PROVIDER_LABELS[autoDetectedProvider]}</strong>
                                    {isFetchingModels && <span className="ml-1 animate-pulse">{t('settingsExtra.keyDialog.fetchingModels')}</span>}
                                </div>
                            )}

                            {endpointFlavor && (
                                <div className={`rounded-xl px-3 py-2 text-xs ${
                                    isDark ? 'bg-[#161A22] text-[#D0D5DD]' : 'bg-[#F8FAFC] text-[#475467]'
                                }`}>
                                    {t('settingsExtra.keyDialog.endpointStyle')}
                                    <strong className="ml-1">
                                        {endpointFlavor === 'openrouter-compatible'
                                            ? t('settingsExtra.keyDialog.openRouterStyle')
                                            : endpointFlavor === 'openai-compatible'
                                                ? t('settingsExtra.keyDialog.openAIStyle')
                                                : t('settingsExtra.keyDialog.googleStyle')}
                                    </strong>
                                    {detectedCapabilities.length > 0 && (
                                        <span className="ml-2">
                                            {t('settingsExtra.keyDialog.capabilities', detectedCapabilities.map(cap => t(capabilityLabelKeys[cap])).join(t('settingsExtra.runtime.credentialSeparator')))}
                                        </span>
                                    )}
                                    {fetchedModels.length > 0 && <span className="ml-2">{t('settingsExtra.keyDialog.detectedModelCount', fetchedModels.length)}</span>}
                                </div>
                            )}

                            <label className="block">
                                <span className={`mb-1.5 block text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>{t('settingsExtra.keyDialog.requestUrl')}</span>
                                <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()} placeholder={t('settingsExtra.keyDialog.requestUrlPlaceholder')} className={`${inputClass} flv-safe-input`} name="baseUrl" autoComplete="url" inputMode="url" />
                            </label>

                            {provider === 'custom' && (
                                <div className={`rounded-xl px-3 py-2 text-xs ${isDark ? 'bg-[#161A22] text-[#98A2B3]' : 'bg-[#F8FAFC] text-[#667085]'}`}>
                                    {t('settingsExtra.keyDialog.compatibilityNote')}
                                </div>
                            )}

                            {provider === 'runningHub' && (
                                <div className={`rounded-xl px-3 py-2 text-xs leading-5 ${isDark ? 'bg-[#161A22] text-[#98A2B3]' : 'bg-[#F8FAFC] text-[#667085]'}`}>
                                    {t('settingsExtra.keyDialog.runningHubNote')}
                                </div>
                            )}

                            <div>
                                <div className={`mb-2 flex items-center justify-between`}>
                                    <span className={`text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>{t('settingsExtra.keyDialog.apiUsedFor')}</span>
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
                                            {capabilities.includes(capability) ? '✓ ' : ''}{t(capabilityLabelKeys[capability])}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 模型管理 */}
                            <div>
                                <div className={`mb-2 flex items-center justify-between`}>
                                    <span className={`text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>{t('settingsExtra.keyDialog.modelList')}</span>
                                    <button
                                        type="button"
                                        disabled={!apiKey.trim() || isFetchingModels}
                                        onClick={() => handleFetchModels(provider, apiKey, baseUrl)}
                                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-40 ${
                                            isDark ? 'border-[#4B5B78] text-[#7CB4FF] hover:bg-[#1B2330]' : 'border-[#B2CCFF] text-[#175CD3] hover:bg-[#EEF4FF]'
                                        }`}
                                    >
                                        {isFetchingModels ? t('settingsExtra.keyDialog.fetching') : t('settingsExtra.keyDialog.fetchModels')}
                                    </button>
                                </div>
                                {fetchError && (
                                    <div className={`mb-2 rounded-xl px-3 py-1.5 text-xs ${isDark ? 'bg-[#3A1616] text-[#FDA29B]' : 'bg-[#FEF3F2] text-[#B42318]'}`}>
                                        {modelDiscoveryUnavailable ? fetchError : t('settingsExtra.keyDialog.fetchFailed', fetchError)} {t('settingsExtra.keyDialog.manualAddHint')}
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
                                                <button type="button" onClick={() => setEditDefaultModel(m.id)} title={t('settingsExtra.keyDialog.setDefaultModel')}>{m.name || m.id}</button>
                                                <button type="button" onClick={() => handleRemoveModel(m.id)} title={t('settingsExtra.keyDialog.removeModel', m.name || m.id)} aria-label={t('settingsExtra.keyDialog.removeModel', m.name || m.id)} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <div className="flex gap-2">
                                    <input
                                        value={newModelId}
                                        onChange={(e) => setNewModelId(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddModel(); } }}
                                        placeholder={t('settingsExtra.keyDialog.addModelPlaceholder')}
                                        className={`${inputClass} flv-safe-input`}
                                    />
                                    <button type="button" onClick={handleAddModel} className={`${chipClass} flv-elastic`}>{t('settingsExtra.mapping.add')}</button>
                                </div>
                                {editModels.length > 0 && (
                                    <div className={`mt-1.5 text-[11px] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>
                                        {t('settingsExtra.keyDialog.modelDefaultHint')}
                                    </div>
                                )}
                            </div>

                            <div className={sectionPanelClass}>
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <div><div className="text-sm font-bold text-[var(--isl-ink)]">{t('settingsExtra.keyDialog.pricingTitle')}</div><div className="mt-0.5 text-[11px] text-[var(--isl-ink-soft)]">{t('settingsExtra.keyDialog.pricingDetails')}</div></div>
                                    <button type="button" onClick={addPricingRule} className="isl-chip px-3 py-1.5 text-xs">{t('settingsExtra.keyDialog.addPricingRule')}</button>
                                </div>
                                <div className="space-y-2">
                                    {editPricingRules.map(rule => (
                                        <motion.div key={rule.id} layout transition={{ type: 'spring', stiffness: 420, damping: 34 }} className="settings-pricing-row grid gap-2 rounded-2xl border border-[var(--isl-border)] bg-[var(--isl-card)] p-3 md:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
                                            <select aria-label={t('settingsExtra.keyDialog.pricingModel')} value={rule.productModelId || ''} onChange={event => setEditPricingRules(current => current.map(item => item.id === rule.id ? { ...item, productModelId: event.target.value || undefined, unit: event.target.value ? getProductModel(event.target.value)?.capability === 'video' ? 'video_second' : 'image' : 'request' } : item))} className={`${inputClass} text-xs`}>
                                                <option value="">{t('settingsExtra.keyDialog.wholeKey')}</option>
                                                {[...getProductModels('image'), ...getProductModels('video')].map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                                            </select>
                                            <select aria-label={t('settingsExtra.keyDialog.billingUnit')} value={rule.unit} onChange={event => setEditPricingRules(current => current.map(item => item.id === rule.id ? { ...item, unit: event.target.value as ApiPricingRule['unit'] } : item))} className={`${inputClass} text-xs`}>
                                                <option value="request">{t('settingsExtra.keyDialog.perRequest')}</option>
                                                {(!rule.productModelId || getProductModel(rule.productModelId)?.capability === 'image') && <option value="image">{t('settingsExtra.keyDialog.perImage')}</option>}
                                                {(!rule.productModelId || getProductModel(rule.productModelId)?.capability === 'video') && <option value="video_second">{t('settingsExtra.keyDialog.perVideoSecond')}</option>}
                                                {!rule.productModelId && <><option value="input_token">{t('settingsExtra.keyDialog.perMillionInputTokens')}</option><option value="output_token">{t('settingsExtra.keyDialog.perMillionOutputTokens')}</option></>}
                                            </select>
                                            <input aria-label={t('settingsExtra.keyDialog.unitPrice')} type="number" min="0" step="0.0001" value={rule.rate} onChange={event => setEditPricingRules(current => current.map(item => item.id === rule.id ? { ...item, rate: Number(event.target.value) || 0 } : item))} className={`${inputClass} text-xs`} />
                                            <select aria-label={t('settingsExtra.keyDialog.currency')} value={rule.currency} onChange={event => setEditPricingRules(current => current.map(item => item.id === rule.id ? { ...item, currency: event.target.value as 'USD' | 'CNY' } : item))} className={`${inputClass} text-xs`}><option value="USD">USD</option><option value="CNY">CNY</option></select>
                                            <button type="button" aria-label={t('settingsExtra.keyDialog.removePricingRule')} onClick={() => setEditPricingRules(current => current.filter(item => item.id !== rule.id))} className="isl-chip px-3 text-xs text-red-500">{t('settingsExtra.api.delete')}</button>
                                        </motion.div>
                                    ))}
                                    {editPricingRules.length === 0 && <div className="rounded-2xl border border-dashed border-[var(--isl-border)] px-3 py-5 text-center text-xs text-[var(--isl-ink-soft)]">{t('settingsExtra.keyDialog.noPricingRules')}</div>}
                                </div>
                            </div>

                            <div className={sectionPanelClass}>
                                <div className="mb-3 flex items-center justify-between"><div><div className="text-sm font-bold text-[var(--isl-ink)]">{t('settingsExtra.keyDialog.budgetTitle')}</div><div className="mt-0.5 text-[11px] text-[var(--isl-ink-soft)]">{t('settingsExtra.keyDialog.budgetDetails')}</div></div><button type="button" onClick={() => setEditBudgetPolicy(policy => ({ ...policy, enabled: !policy.enabled }))} aria-pressed={editBudgetPolicy.enabled} className={`isl-chip px-3 py-1.5 text-xs ${editBudgetPolicy.enabled ? 'isl-chip--active' : ''}`}>{t(editBudgetPolicy.enabled ? 'settingsExtra.keyDialog.enabled' : 'settingsExtra.keyDialog.disabled')}</button></div>
                                {editBudgetPolicy.enabled && editingKeyId && usageSummary?.get(editingKeyId) && (() => {
                                    const usage = usageSummary.get(editingKeyId)!;
                                    const sameCurrency = usage.currency === editBudgetPolicy.currency;
                                    const used = sameCurrency ? usage.currentMonthCostCents / 100 : 0;
                                    const percent = editBudgetPolicy.monthlyLimit > 0 ? Math.min(100, used / editBudgetPolicy.monthlyLimit * 100) : 0;
                                    return <div className="mb-3 rounded-2xl bg-[var(--isl-card)] p-3">
                                        <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--isl-ink-soft)]"><span>{t('settingsExtra.keyDialog.monthRecorded')} {sameCurrency ? formatCost(usage.currentMonthCostCents, usage.currency) : t('settingsExtra.keyDialog.currencyMismatch')}</span><span>{Math.round(percent)}%</span></div>
                                        <div className="h-2 overflow-hidden rounded-full bg-[var(--isl-surface-2)]"><motion.div initial={false} animate={{ width: `${percent}%` }} transition={{ type: 'spring', stiffness: 360, damping: 32 }} className={`h-full rounded-full ${percent >= editBudgetPolicy.warningPercent ? 'bg-amber-500' : 'bg-emerald-500'}`} /></div>
                                        {usage.pendingCostCalls > 0 && <div className="mt-2 text-[10px] text-amber-600">{t('settingsExtra.keyDialog.pendingCostNotice', usage.pendingCostCalls)}</div>}
                                    </div>;
                                })()}
                                {editBudgetPolicy.enabled && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ type: 'spring', stiffness: 380, damping: 32 }} className="settings-budget-grid grid gap-2 md:grid-cols-4">
                                    <label className="text-[11px] text-[var(--isl-ink-soft)]">{t('settingsExtra.keyDialog.monthlyLimit')}<input type="number" min="0" value={editBudgetPolicy.monthlyLimit} onChange={event => setEditBudgetPolicy(policy => ({ ...policy, monthlyLimit: Number(event.target.value) || 0 }))} className={`${inputClass} mt-1`} /></label>
                                    <label className="text-[11px] text-[var(--isl-ink-soft)]">{t('settingsExtra.keyDialog.warningThreshold')}<input type="number" min="1" max="100" value={editBudgetPolicy.warningPercent} onChange={event => setEditBudgetPolicy(policy => ({ ...policy, warningPercent: Math.max(1, Math.min(100, Number(event.target.value) || 80)) }))} className={`${inputClass} mt-1`} /></label>
                                    <label className="text-[11px] text-[var(--isl-ink-soft)]">{t('settingsExtra.keyDialog.currency')}<select value={editBudgetPolicy.currency} onChange={event => setEditBudgetPolicy(policy => ({ ...policy, currency: event.target.value as 'USD' | 'CNY' }))} className={`${inputClass} mt-1`}><option value="USD">USD</option><option value="CNY">CNY</option></select></label>
                                    <label className="flex items-end"><button type="button" onClick={() => setEditBudgetPolicy(policy => ({ ...policy, hardStop: !policy.hardStop }))} aria-pressed={editBudgetPolicy.hardStop} className={`isl-chip w-full px-3 py-2.5 text-xs ${editBudgetPolicy.hardStop ? 'isl-chip--active' : ''}`}>{t('settingsExtra.keyDialog.overBudgetBlock')} · {t(editBudgetPolicy.hardStop ? 'settingsExtra.keyDialog.enabled' : 'settingsExtra.keyDialog.disabled')}</button></label>
                                </motion.div>}
                            </div>

                            {/* extraConfig（如 Google Veo projectId） */}
                            <div>
                                <div className={`mb-2 flex items-center justify-between`}>
                                    <span className={`text-sm font-medium ${isDark ? 'text-[#D0D5DD]' : 'text-[#344054]'}`}>{t('settingsExtra.keyDialog.advanced')}</span>
                                    <span className={`text-[11px] ${isDark ? 'text-[#667085]' : 'text-[#98A2B3]'}`}>{t('settingsExtra.keyDialog.thirdPartyCompatible')}</span>
                                </div>
                                <div className="settings-extra-grid grid gap-2 md:grid-cols-2">
                                    <div className={`md:col-span-2 text-xs font-semibold ${isDark ? 'text-[#98A2B3]' : 'text-[#667085]'}`}>{t('settingsExtra.keyDialog.apiFormat')}</div>
                                    <select
                                        value={extraConfig.requestFormat || ''}
                                        onChange={(e) => updateExtraConfig('requestFormat', e.target.value)}
                                        className={`${inputClass} flv-safe-input`}
                                        title={t('settingsExtra.keyDialog.apiFormat')}
                                        aria-label={t('settingsExtra.keyDialog.apiFormat')}
                                    >
                                        <option value="">{t('settingsExtra.keyDialog.autoDetectFormat')}</option>
                                        <option value="native">{t('settingsExtra.keyDialog.nativeFormat')}</option>
                                        <option value="openai">{t('settingsExtra.keyDialog.openAIFormat')}</option>
                                        <option value="anthropic">Anthropic</option>
                                        <option value="google">Google Gemini</option>
                                    </select>
                                    <input
                                        value={extraConfig.authHeaderName || ''}
                                        onChange={(e) => updateExtraConfig('authHeaderName', e.target.value)}
                                        placeholder={t('settingsExtra.keyDialog.authHeaderPlaceholder')}
                                        className={`${inputClass} flv-safe-input`}
                                    />
                                    <input
                                        value={extraConfig.authScheme || ''}
                                        onChange={(e) => updateExtraConfig('authScheme', e.target.value)}
                                        placeholder={t('settingsExtra.keyDialog.authSchemePlaceholder')}
                                        className={`${inputClass} flv-safe-input`}
                                    />
                                    <input
                                        value={extraConfig.projectId || ''}
                                        onChange={(e) => updateExtraConfig('projectId', e.target.value)}
                                        placeholder={t('settingsExtra.keyDialog.projectIdPlaceholder')}
                                        className={`${inputClass} flv-safe-input`}
                                    />
                                    <div className={`md:col-span-2 mt-1 text-xs font-semibold ${isDark ? 'text-[#98A2B3]' : 'text-[#667085]'}`}>{t('settingsExtra.keyDialog.modelTestSettings')}</div>
                                    <input
                                        value={extraConfig.testTimeoutMs || ''}
                                        onChange={(e) => updateExtraConfig('testTimeoutMs', e.target.value)}
                                        placeholder={t('settingsExtra.keyDialog.timeoutPlaceholder')}
                                        className={`${inputClass} flv-safe-input`}
                                    />
                                    <input
                                        value={extraConfig.maxRetries || ''}
                                        onChange={(e) => updateExtraConfig('maxRetries', e.target.value)}
                                        placeholder={t('settingsExtra.keyDialog.retriesPlaceholder')}
                                        className={`${inputClass} flv-safe-input`}
                                    />
                                </div>
                                <textarea
                                    value={extraConfig.testPrompt || ''}
                                    onChange={(e) => updateExtraConfig('testPrompt', e.target.value)}
                                    placeholder={t('settingsExtra.keyDialog.testPromptPlaceholder')}
                                    className={`${inputClass} mt-2 min-h-18 resize-y`}
                                />
                                <div className={`mb-1 mt-3 text-xs font-semibold ${isDark ? 'text-[#98A2B3]' : 'text-[#667085]'}`}>{t('settingsExtra.keyDialog.configJson')}</div>
                                <textarea
                                    value={extraConfig.configJson || ''}
                                    onChange={(e) => updateExtraConfig('configJson', e.target.value)}
                                    placeholder={t('settingsExtra.keyDialog.configJsonPlaceholder')}
                                    className={`${inputClass} mt-2 min-h-24 resize-y font-mono text-xs`}
                                />
                            </div>
                        </div>

                        <div className={`settings-key-dialog__footer shrink-0 border-t px-6 py-4 ${isDark ? 'border-[#2A3140] bg-[#12151B]' : 'border-[#E4E7EC] bg-white'}`}>
                            <div className="settings-key-dialog__footer-actions flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={handleSaveKey}
                                    disabled={!apiKey.trim() || capabilities.length === 0 || isValidating}
                                    className="isl-go h-11 flex-1 px-4 text-sm"
                                >
                                    {t(isValidating ? 'settingsExtra.keyDialog.validating' : editingKeyId ? 'settingsExtra.keyDialog.validateAndUpdate' : 'settingsExtra.keyDialog.validateAndSave')}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCancelEdit}
                                    className="isl-chip px-4 py-2.5 text-sm"
                                >
                                    {t('settingsExtra.keyDialog.cancel')}
                                </button>
                            </div>

                            {validationResult && (
                                <div className={`mt-3 rounded-xl px-3 py-2 text-sm ${
                                    validationResult.ok
                                        ? isDark ? 'bg-[#123524] text-[#75E0A7]' : 'bg-[#ECFDF3] text-[#027A48]'
                                        : isDark ? 'bg-[#3A1616] text-[#FDA29B]' : 'bg-[#FEF3F2] text-[#B42318]'
                                }`}>
                                    {validationResult.ok
                                        ? t('settingsExtra.keyDialog.validationSuccess')
                                        : t('settingsExtra.keyDialog.validationFailure', validationResult.message || t('settingsExtra.keyDialog.invalidApiKey'))
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
