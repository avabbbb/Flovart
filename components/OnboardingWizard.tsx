/**
 * ============================================
 * 新用户 API Key 引导向导 (Onboarding Wizard)
 * ============================================
 *
 * 【功能】
 * 当用户首次使用（没有任何 API Key 配置）时，自动弹出引导弹窗，
 * 用最简单的 3 步流程帮助小白用户完成 API Key 的配置。
 *
 * 【步骤】
 * Step 1: 欢迎页 — 介绍 Flovart 并引导用户获取 API Key
 * Step 2: 输入 API Key — 一个输入框 + 自动验证
 * Step 3: 完成 — 确认配置成功，可以开始创作
 *
 * 【设计原则】
 * - 小白友好：默认 Google Gemini，只需粘贴一个 Key
 * - 自动推断 capabilities
 * - 验证通过才允许继续
 * - 可随时跳过（点击"稍后再说"）
 */

import React, { useState } from 'react';
import type { AIProvider, AICapability, ModelItem, UserApiKey } from '../types';
import { validateApiKey } from '../services/aiGateway';
import { fetchModelsForProvider, type FetchModelsResult } from '../services/modelFetcher';

interface OnboardingWizardProps {
    /** 是否显示弹窗 */
    isOpen: boolean;
    /** 关闭/跳过弹窗 */
    onClose: () => void;
    /** 保存新 API Key 的回调 */
    onAddApiKey: (payload: Omit<UserApiKey, 'id' | 'createdAt' | 'updatedAt'>) => void;
    /** 当前亮/暗主题 */
    resolvedTheme: 'light' | 'dark';
}

/** 各步骤标题 */
const STEPS = [
    { title: '欢迎使用 Flovart', subtitle: '让我们花 30 秒完成配置' },
    { title: '粘贴你的 API Key', subtitle: '只需一步，即可开始 AI 创作' },
    { title: '配置完成 🎉', subtitle: '一切就绪，开始创作吧' },
] as const;

/** Provider 对应的默认 capabilities */
const PROVIDER_CAPABILITIES: Record<AIProvider, AICapability[]> = {
    google: ['text', 'image', 'video'],
    xai: ['text', 'video'],
    openai: ['text'],
    anthropic: ['text'],
    qwen: ['text'],
    deepseek: ['text'],
    siliconflow: ['text', 'image'],
    keling: ['image', 'video'],
    flux: ['image'],
    midjourney: ['image'],
    runningHub: ['image'],
    minimax: ['text', 'image', 'video'],
    volcengine: ['text'],
    openrouter: ['text', 'image'],
    openai_compatible: ['text', 'image'],
    custom: ['text', 'image'],
};

/** Provider 可读标签 */
const PROVIDER_LABELS: Record<string, string> = {
    google: 'Google Gemini',
    openai: 'OpenAI',
    anthropic: 'Anthropic Claude',
    qwen: 'Qwen 通义千问',
    deepseek: 'DeepSeek',
    siliconflow: 'SiliconFlow',
    keling: 'Keling 可灵',
    flux: 'Flux',
    midjourney: 'Midjourney',
    custom: '自定义 / 第三方',
};

const CAPABILITY_LABELS: Record<AICapability, string> = {
    text: '✏️ LLM润色',
    image: '🖼️ 图片生成',
    video: '🎬 视频生成',
    agent: '图像工具',
};

const ENDPOINT_FLAVOR_LABELS: Record<'google' | 'openai-compatible' | 'openrouter-compatible', string> = {
    google: 'Google 原生风格',
    'openai-compatible': 'OpenAI 兼容风格',
    'openrouter-compatible': 'OpenRouter 风格',
};

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
    isOpen,
    onClose,
    onAddApiKey,
    resolvedTheme,
}) => {
    const [step, setStep] = useState(0);
    const [provider, setProvider] = useState<AIProvider>('google');
    const [apiKey, setApiKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // ── 自定义第三方 API 专用状态 ──
    const [customBaseUrl, setCustomBaseUrl] = useState('');
    const [customCaps, setCustomCaps] = useState<AICapability[]>(['text', 'image']);
    const [customModelInput, setCustomModelInput] = useState('');
    const [isDetectingModels, setIsDetectingModels] = useState(false);
    const [detectedCapabilities, setDetectedCapabilities] = useState<AICapability[]>([]);
    const [detectedModels, setDetectedModels] = useState<ModelItem[]>([]);
    const [endpointFlavor, setEndpointFlavor] = useState<'google' | 'openai-compatible' | 'openrouter-compatible' | null>(null);
    const [showAdvancedCustom, setShowAdvancedCustom] = useState(false);

    if (!isOpen) return null;

    const isDark = resolvedTheme === 'dark';

    // ── 样式工具 ──
    const cardBg = 'isl-shell';
    const textPrimary = 'text-[var(--isl-ink)]';
    const textSecondary = 'text-[var(--isl-ink-soft)]';
    const inputClass = 'isl-well w-full px-4 py-3 text-sm text-[var(--isl-ink)] outline-none placeholder:text-[var(--isl-ink-ghost)]';
    const primaryBtn = 'isl-go px-6 py-3 text-sm';
    const secondaryBtn = 'isl-chip px-5 py-3 text-sm';

    const parseModelItems = (value: string): ModelItem[] => value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .map(id => ({ id, name: id }));

    const mergeModelItems = (primary: ModelItem[], secondary: ModelItem[]): ModelItem[] => {
        const merged = new Map<string, ModelItem>();
        for (const item of [...primary, ...secondary]) {
            if (!merged.has(item.id)) {
                merged.set(item.id, item);
            }
        }
        return Array.from(merged.values());
    };

    const resetCustomDetection = () => {
        setDetectedCapabilities([]);
        setDetectedModels([]);
        setEndpointFlavor(null);
    };

    const applyDetectedResult = (result: FetchModelsResult) => {
        const models = result.models.map(model => ({ id: model.id, name: model.name || model.id }));
        setDetectedModels(models);
        setDetectedCapabilities(result.capabilitySummary || Array.from(new Set(result.models.map(model => model.capability))));
        setEndpointFlavor(result.endpointFlavor || null);
    };

    const detectCustomEndpoint = async (silent = false): Promise<FetchModelsResult | null> => {
        if (!customBaseUrl.trim()) {
            if (!silent) setError('请先填写 Base URL');
            return null;
        }
        if (!apiKey.trim()) {
            if (!silent) setError('请先填写 API Key');
            return null;
        }

        setIsDetectingModels(true);
        if (!silent) setError(null);
        try {
            const result = await fetchModelsForProvider('custom', apiKey.trim(), customBaseUrl.trim());
            if (result.ok) {
                applyDetectedResult(result);
            } else if (!silent) {
                setError(result.error || '自动识别失败，请手动勾选能力');
            }
            return result;
        } catch (err) {
            if (!silent) {
                setError(err instanceof Error ? err.message : '自动识别失败，请手动勾选能力');
            }
            return null;
        } finally {
            setIsDetectingModels(false);
        }
    };

    /**
     * 验证并保存 API Key
     * 验证通过后自动推断 provider capabilities 并保存
     */
    const handleValidateAndSave = async () => {
        if (!apiKey.trim()) return;
        if (provider === 'custom' && !customBaseUrl.trim()) {
            setError('自定义提供商必须填写 Base URL');
            return;
        }
        setIsValidating(true);
        setError(null);

        try {
            const baseUrlForValidation = provider === 'custom' ? customBaseUrl.trim() || undefined : undefined;
            const result = await validateApiKey(provider, apiKey.trim(), baseUrlForValidation);
            if (result.ok) {
                // 验证通过，保存 Key 并进入完成页
                const manualModels = provider === 'custom' ? parseModelItems(customModelInput) : [];
                let caps = provider === 'custom'
                    ? (detectedCapabilities.length > 0 ? detectedCapabilities : customCaps)
                    : PROVIDER_CAPABILITIES[provider];
                let modelsToSave: ModelItem[] | undefined;
                let customModels: string[] | undefined;
                let defaultModel: string | undefined;
                let extraConfig: Record<string, string> | undefined;

                if (provider === 'custom') {
                    const detectionResult = await detectCustomEndpoint(true);
                    const fetchedModels = detectionResult?.ok
                        ? detectionResult.models.map(model => ({ id: model.id, name: model.name || model.id }))
                        : detectedModels;
                    const resolvedEndpointFlavor = detectionResult?.endpointFlavor
                        || endpointFlavor
                        || (/openrouter/i.test(customBaseUrl) ? 'openrouter-compatible' : 'openai-compatible');

                    if (fetchedModels.length > 0) {
                        modelsToSave = mergeModelItems(fetchedModels, manualModels);
                        caps = detectionResult?.capabilitySummary && detectionResult.capabilitySummary.length > 0
                            ? detectionResult.capabilitySummary
                            : detectionResult?.ok
                                ? Array.from(new Set(detectionResult.models.map(model => model.capability)))
                                : caps;
                        defaultModel = fetchedModels[0]?.id;
                    } else {
                        modelsToSave = manualModels;
                        defaultModel = modelsToSave[0]?.id;
                    }

                    customModels = modelsToSave.map(model => model.id);
                    extraConfig = resolvedEndpointFlavor ? { endpointFlavor: resolvedEndpointFlavor } : undefined;
                }

                onAddApiKey({
                    provider,
                    capabilities: caps,
                    key: apiKey.trim(),
                    name: provider === 'custom'
                        ? (() => { try { return `自定义 (${new URL(customBaseUrl.trim()).host})`; } catch { return '自定义 API'; } })()
                        : `${PROVIDER_LABELS[provider] || provider} Key`,
                    status: 'ok',
                    isDefault: true,
                    ...(provider === 'custom' && {
                        baseUrl: customBaseUrl.trim(),
                        models: modelsToSave,
                        customModels,
                        defaultModel,
                        extraConfig,
                    }),
                });
                setStep(2);
            } else {
                setError(result.message || 'API Key 无效，请检查后重试');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : '验证时发生错误');
        } finally {
            setIsValidating(false);
        }
    };

    /** 回车提交 */
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && apiKey.trim() && !isValidating) {
            handleValidateAndSave();
        }
    };

    return (
        <div className="fixed inset-0 z-200 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center">
            <div
                className={`relative flex max-h-[calc(100dvh-0.5rem)] w-full max-w-120 flex-col overflow-hidden rounded-t-4xl border shadow-[0_48px_120px_rgba(0,0,0,0.2)] sm:max-h-[calc(100dvh-2rem)] sm:w-[90%] sm:rounded-4xl ${cardBg}`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ── 进度指示器（固定顶部） ── */}
                <div className="shrink-0 px-8 pt-8 pb-2">
                    <div className="flex justify-center gap-2">
                        {STEPS.map((_, i) => (
                            <div
                                key={i}
                                className={`h-1.5 rounded-full transition-all duration-300 ${
                                    i === step
                                        ? 'w-8 bg-[var(--isl-mint)]'
                                        : i < step
                                            ? 'w-4 bg-[var(--isl-mint-deep)]'
                                            : 'w-4 bg-[var(--isl-border)]'
                                }`}
                            />
                        ))}
                    </div>
                </div>

                {/* ── 滚动内容区 ── */}
                <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">

                {/* ── Step 0: 欢迎页 ── */}
                {step === 0 && (
                    <div className="text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-[var(--isl-mint)] text-3xl" style={{ boxShadow: '0 4px 0 0 var(--isl-edge-mint)' }}>
                            🎨
                        </div>
                        <h2 className={`mb-2 text-xl font-bold ${textPrimary}`}>
                            {STEPS[0].title}
                        </h2>
                        <p className={`mb-2 text-sm ${textSecondary}`}>
                            {STEPS[0].subtitle}
                        </p>
                        <p className={`mb-8 text-sm leading-relaxed ${textSecondary}`}>
                                    Flovart 使用 AI 帮你在工作流中生成图片和视频。<br />
                            你可以直接接入 <strong className={textPrimary}>Google Gemini</strong>，也可以填入你自己的兼容端点，向导会尽量自动识别模型和能力。
                        </p>

                        <div className="space-y-3">
                            <button type="button" onClick={() => setStep(1)} className={primaryBtn + ' w-full'}>
                                开始配置 →
                            </button>
                            <a
                                href="https://aistudio.google.com/apikey"
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`block text-center text-sm font-medium text-blue-500 hover:text-blue-600`}
                            >
                                还没有 API Key？点击这里免费获取 ↗
                            </a>
                            <button type="button" onClick={onClose} className={secondaryBtn + ' w-full'}>
                                稍后再说
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Step 1: 输入 API Key ── */}
                {step === 1 && (
                    <div>
                        <h2 className={`mb-1 text-lg font-bold ${textPrimary}`}>
                            {STEPS[1].title}
                        </h2>
                        <p className={`mb-6 text-sm ${textSecondary}`}>
                            {STEPS[1].subtitle}
                        </p>

                        {/* Provider 选择（默认 Google，可切换） */}
                        <div className="mb-4">
                            <label className={`mb-2 block text-xs font-semibold uppercase tracking-wider ${textSecondary}`}>
                                AI 服务商
                            </label>
                            <div className="flex flex-wrap gap-2">
                                {(['google', 'openai', 'anthropic', 'deepseek', 'siliconflow', 'qwen', 'keling', 'flux', 'midjourney', 'custom'] as AIProvider[]).map(p => (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => {
                                            setProvider(p);
                                            setError(null);
                                            setShowAdvancedCustom(false);
                                            resetCustomDetection();
                                        }}
                                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                                            provider === p
                                                ? isDark
                                                    ? 'border-blue-500 bg-blue-500/20 text-blue-400'
                                                    : 'border-blue-500 bg-blue-50 text-blue-600'
                                                : isDark
                                                    ? 'border-[#2A3140] text-[#98A2B3] hover:bg-[#1B2029]'
                                                    : 'border-[#E4E7EC] text-[#667085] hover:bg-[#F9FAFB]'
                                        }`}
                                    >
                                        {PROVIDER_LABELS[p] || p}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* API Key 输入框 */}
                        <div className="mb-4">
                            <label className={`mb-2 block text-xs font-semibold uppercase tracking-wider ${textSecondary}`}>
                                API Key
                            </label>
                            <div className="relative">
                                <input
                                    value={apiKey}
                                    onChange={(e) => {
                                        setApiKey(e.target.value);
                                        setError(null);
                                        if (provider === 'custom') resetCustomDetection();
                                    }}
                                    onKeyDown={handleKeyDown}
                                    type={showKey ? 'text' : 'password'}
                                    placeholder={provider === 'google' ? 'AIzaSy...' : 'sk-...'}
                                    className={inputClass}
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowKey(prev => !prev)}
                                    className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${textSecondary} hover:${textPrimary}`}
                                >
                                    {showKey ? '隐藏' : '显示'}
                                </button>
                            </div>
                        </div>

                        {provider === 'custom' && (
                            <div className="mb-4">
                                <button
                                    type="button"
                                    onClick={() => setShowAdvancedCustom(prev => !prev)}
                                    className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${
                                        isDark ? 'border-[#2A3140] bg-[#161A22] text-[#D0D5DD] hover:bg-[#1B2029]' : 'border-[#E4E7EC] bg-[#F8FAFC] text-[#344054] hover:bg-white'
                                    }`}
                                >
                                    <span>高级第三方 API 设置</span>
                                    <span className="text-xs opacity-70">{showAdvancedCustom ? '收起' : '展开'}</span>
                                </button>
                            </div>
                        )}

                        {provider === 'custom' && showAdvancedCustom && (
                            <div className={`mb-4 rounded-3xl border p-4 ${isDark ? 'border-[#2A3140] bg-[#10141B]' : 'border-[#E4E7EC] bg-[#FBFCFE]'}`}>
                                <div className="mb-4">
                                    <label className={`mb-2 block text-xs font-semibold uppercase tracking-wider ${textSecondary}`}>
                                        Base URL <span className="normal-case text-red-400">*</span>
                                    </label>
                                    <input
                                        value={customBaseUrl}
                                        onChange={(e) => {
                                            setCustomBaseUrl(e.target.value);
                                            resetCustomDetection();
                                        }}
                                        placeholder="https://api.example.com/v1"
                                        className={inputClass}
                                    />
                                </div>
                                <div className="mb-4">
                                    <label className={`mb-2 block text-xs font-semibold uppercase tracking-wider ${textSecondary}`}>
                                        支持的能力
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        {(['text', 'image', 'video'] as AICapability[]).map(cap => (
                                            <button
                                                key={cap}
                                                type="button"
                                                onClick={() => setCustomCaps(prev =>
                                                    prev.includes(cap) ? prev.filter(c => c !== cap) : [...prev, cap]
                                                )}
                                                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                                                    customCaps.includes(cap)
                                                        ? isDark
                                                            ? 'border-green-500 bg-green-500/20 text-green-400'
                                                            : 'border-green-500 bg-green-50 text-green-600'
                                                        : isDark
                                                            ? 'border-[#2A3140] text-[#98A2B3] hover:bg-[#1B2029]'
                                                            : 'border-[#E4E7EC] text-[#667085] hover:bg-[#F9FAFB]'
                                                }`}
                                            >
                                                {cap === 'text' ? 'LLM 润色' : cap === 'image' ? '图片生成' : '视频生成'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className={`mb-2 block text-xs font-semibold uppercase tracking-wider ${textSecondary}`}>
                                        模型名称 <span className="normal-case opacity-60">(可选, 逗号分隔)</span>
                                    </label>
                                    <input
                                        value={customModelInput}
                                        onChange={(e) => setCustomModelInput(e.target.value)}
                                        placeholder="gpt-5.4, claude-opus-4-6, ..."
                                        className={inputClass}
                                    />
                                </div>
                            </div>
                        )}

                        {provider === 'custom' && (
                            <div className="mb-4 space-y-3">
                                <button
                                    type="button"
                                    onClick={() => detectCustomEndpoint(false)}
                                    disabled={!customBaseUrl.trim() || !apiKey.trim() || isDetectingModels}
                                    className={`${secondaryBtn} w-full rounded-2xl border ${
                                        isDark ? 'border-[#2A3140] bg-[#161A22]' : 'border-[#E4E7EC] bg-[#F8FAFC]'
                                    } disabled:cursor-not-allowed disabled:opacity-50`}
                                >
                                    {isDetectingModels ? '正在自动识别模型与能力...' : '自动识别模型与能力'}
                                </button>

                                {(endpointFlavor || detectedCapabilities.length > 0 || detectedModels.length > 0) && (
                                    <div className={`rounded-2xl border px-4 py-3 text-xs leading-relaxed ${
                                        isDark ? 'border-[#2A3140] bg-[#161A22] text-[#D0D5DD]' : 'border-[#E4E7EC] bg-[#F8FAFC] text-[#475467]'
                                    }`}>
                                        {endpointFlavor && (
                                            <div>
                                                兼容端点识别：<strong className="ml-1">{ENDPOINT_FLAVOR_LABELS[endpointFlavor]}</strong>
                                            </div>
                                        )}
                                        {detectedCapabilities.length > 0 && (
                                            <div className="mt-1">
                                                自动识别能力：{detectedCapabilities.map(cap => CAPABILITY_LABELS[cap]).join(' / ')}
                                            </div>
                                        )}
                                        {detectedModels.length > 0 && (
                                            <div className="mt-1">已识别 {detectedModels.length} 个模型，保存后会自动写入默认模型。</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 小提示 */}
                        <div className={`mb-4 rounded-2xl p-3 text-xs leading-relaxed ${isDark ? 'bg-[#161A22] text-[#98A2B3]' : 'bg-[#F8FAFC] text-[#667085]'}`}>
                            {provider === 'google' && (
                                <>
                                    💡 <strong>获取方法</strong>：访问{' '}
                                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">
                                        Google AI Studio
                                    </a>
                                    {' '}→ 点击「Create API Key」→ 复制粘贴到这里。
                                    <br />
                                    <span className="mt-1 inline-block">一个 Key 即可使用文生图、图生图和视频生成全部功能。</span>
                                </>
                            )}
                            {provider === 'openai' && (
                                <>
                                    💡 访问{' '}
                                    <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">
                                        OpenAI Platform
                                    </a>
                                    {' '}→ 创建新 Key → 复制粘贴到这里。
                                </>
                            )}
                            {provider === 'anthropic' && '💡 支持 Claude 模型的提示词润色功能。'}
                            {provider === 'qwen' && '💡 支持通义千问模型的提示词润色功能。'}
                            {provider === 'custom' && (
                                <>
                                    💡 优先支持 <strong className={textPrimary}>OpenAI 兼容 / OpenRouter 风格</strong> 的第三方 API。<br />
                                    填入 Base URL（如 <code className="text-blue-500">https://api.xxx.com/v1</code>）和 API Key 后，可先点一次“自动识别模型与能力”。
                                    <br />
                                    <span className="mt-1 inline-block">适用于 Ollama / vLLM / LiteLLM / OneAPI / New API / 各类中转站等，但不同中转站对图片编辑和视频能力支持并不完全一致。</span>
                                </>
                            )}
                        </div>

                        {/* 错误提示 */}
                        {error && (
                            <div className={`mb-4 rounded-2xl px-4 py-3 text-sm ${
                                isDark ? 'bg-[#3A1616] text-[#FDA29B]' : 'bg-[#FEF3F2] text-[#B42318]'
                            }`}>
                                ✗ {error}
                            </div>
                        )}

                        {/* 自动推断的功能 */}
                        <div className={`mb-6 flex items-center gap-2 text-xs ${textSecondary}`}>
                            <span>自动启用：</span>
                            {(provider === 'custom'
                                ? (detectedCapabilities.length > 0 ? detectedCapabilities : customCaps)
                                : PROVIDER_CAPABILITIES[provider]).map(cap => (
                                <span key={cap} className={`rounded-full px-2 py-0.5 ${isDark ? 'bg-[#1B2330] text-[#7CB4FF]' : 'bg-[#EFF6FF] text-[#175CD3]'}`}>
                                    {CAPABILITY_LABELS[cap]}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Step 2: 完成 ── */}
                {step === 2 && (
                    <div className="text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-green-400 to-emerald-600 text-3xl shadow-lg">
                            ✨
                        </div>
                        <h2 className={`mb-2 text-xl font-bold ${textPrimary}`}>
                            {STEPS[2].title}
                        </h2>
                        <p className={`mb-6 text-sm ${textSecondary}`}>
                            {STEPS[2].subtitle}
                        </p>

                        <div className={`mx-auto mb-6 max-w-xs rounded-2xl p-4 text-left ${isDark ? 'bg-[#161A22]' : 'bg-[#F8FAFC]'}`}>
                            <div className={`mb-2 text-xs font-semibold ${textSecondary}`}>已配置</div>
                            <div className="flex items-center gap-2">
                                <span className="rounded-full bg-green-500/20 px-2 py-1 text-xs font-medium text-green-500">✓ 已验证</span>
                                <span className={`text-sm font-medium ${textPrimary}`}>{PROVIDER_LABELS[provider] || provider}</span>
                            </div>
                            <div className={`mt-2 text-xs ${textSecondary}`}>
                                可用功能：{(provider === 'custom' ? customCaps : PROVIDER_CAPABILITIES[provider]).map(c =>
                                    c === 'text' ? 'LLM润色' : c === 'image' ? '图片生成' : c === 'video' ? '视频生成' : 'Agent'
                                ).join('、')}
                            </div>
                        </div>

                        <div className={`mb-6 rounded-2xl p-4 text-left text-xs leading-relaxed ${isDark ? 'bg-[#161A22] text-[#98A2B3]' : 'bg-[#F8FAFC] text-[#667085]'}`}>
                            <div className="mb-2 font-semibold">💡 快速上手</div>
                            <ol className="ml-4 list-decimal space-y-1">
                                <li>在底部输入栏输入提示词，如「一只在星空下飞翔的猫」</li>
                                <li>点击「生成」或按 Enter</li>
                                        <li>AI 生成的图片会自动写回工作流节点</li>
                                <li>选中图片后输入新提示词可以进一步编辑</li>
                            </ol>
                        </div>

                        <button type="button" onClick={onClose} className={primaryBtn + ' w-full'}>
                            开始创作 🎨
                        </button>
                    </div>
                )}
                </div>{/* end scrollable area */}

                {/* ── Step 1 固定底部按钮区 ── */}
                {step === 1 && (
                    <div className={`shrink-0 border-t px-8 py-4 ${isDark ? 'border-[#2A3140]' : 'border-[#E4E7EC]'}`}>
                        <div className="flex gap-3">
                            <button type="button" onClick={() => { setStep(0); setError(null); }} className={secondaryBtn}>
                                ← 返回
                            </button>
                            <button
                                type="button"
                                onClick={handleValidateAndSave}
                                disabled={!apiKey.trim() || isValidating}
                                className={`${primaryBtn} flex-1 disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                                {isValidating ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                        </svg>
                                        验证中...
                                    </span>
                                ) : '验证并保存 →'}
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
};
