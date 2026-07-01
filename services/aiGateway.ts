import type { AICapability, AIProvider, PromptEnhanceRequest, PromptEnhanceResult, UserApiKey } from '../types';
import { editImage, enhancePromptWithGemini, generateImageFromText, generateVideo, validateGeminiApiKey, getGeminiRestBaseUrl } from './geminiService';
import { fetchModelsForProvider, type FetchModelsResult } from './modelFetcher';
import { normalizeProviderBaseUrl } from './baseUrl';
import { assertRunningHubModelEndpoint } from './runningHubService';

type ImageInput = { href: string; mimeType: string };

export type MultimodalSlotKind = 'image' | 'video' | 'audio';
export type MultimodalSlotRole =
    | 'first_frame'
    | 'last_frame'
    | 'reference_image'
    | 'reference_video'
    | 'reference_audio'
    | 'style_ref'
    | 'control_net'
    | 'unassigned';

export type MultimodalSlot = {
    kind: MultimodalSlotKind;
    href: string;
    mimeType: string;
    role?: MultimodalSlotRole | string;
    label?: string;
};

type VideoImage = ImageInput & { slotRole?: string; label?: string; sourceName?: string; elementId?: string };

type ProviderModelMap = { text: string[]; image: string[]; video: string[] };

type IgnitionReference = {
    type: 'image' | 'video' | 'audio' | 'text' | 'shape';
    href?: string;
    mimeType?: string;
    slotRole?: string;
    label?: string;
    sourceName?: string;
    text?: string;
    elementId?: string;
};

export interface UnifiedIgnitionInput {
    elementId: string;
    prompt: string;
    modelId: string;
    apiKeyPayload?: UserApiKey;
    aspectRatio?: VideoAspectRatio;
    durationSec?: number;
    resolution?: string;
    generateAudio?: boolean;
    watermark?: boolean;
    references?: IgnitionReference[];
    signal?: AbortSignal;
    onProgress?: (progress: number, message: string) => void;
}

export type UnifiedIgnitionResult =
    | { ok: true; elementId: string; mediaUrl: string; mimeType: string; capability: ElementMediaCapability; textResponse?: string | null }
    | { ok: false; elementId: string; errorMessage: string; capability: ElementMediaCapability };

export type ElementMediaCapability = 'image' | 'video';

export interface ModelParamSchema {
    hasSeed: boolean;
    hasCfgScale: boolean;
    hasAspectRatio: boolean;
    defaultAspectRatio?: VideoAspectRatio;
}

export const DEFAULT_PROVIDER_MODELS: Partial<Record<AIProvider, ProviderModelMap>> = {
    google: {
        text: ['gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'],
        image: ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview', 'gemini-2.5-flash-image', 'imagen-4.0-generate-001'],
        video: ['veo-3.1-generate-preview', 'veo-3.1-lite-generate-preview', 'veo-2.0-generate-001'],
    },
    openai: {
        text: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-4o-mini'],
        image: ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'dall-e-3'],
        video: [],
    },
    anthropic: {
        text: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
        image: [],
        video: [],
    },
    qwen: {
        text: ['qwen-max'],
        image: [],
        video: [],
    },
    deepseek: {
        text: ['deepseek-chat', 'deepseek-reasoner'],
        image: [],
        video: [],
    },
    siliconflow: {
        text: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
        image: [],
        video: [],
    },
    keling: {
        text: [],
        image: [],
        video: [],
    },
    flux: {
        text: [],
        image: [],
        video: [],
    },
    midjourney: {
        text: [],
        image: [],
        video: [],
    },
    runningHub: {
        text: [],
        image: [],
        video: [],
    },
    minimax: {
        text: ['MiniMax-Text-01', 'abab6.5s-chat'],
        image: ['minimax-image-01'],
        video: ['video-01'],
    },
    volcengine: {
        text: ['doubao-1.5-pro-256k', 'doubao-1.5-pro-32k'],
        image: [],
        video: ['doubao-seedance-2.0', 'seedance-2.0', 'dreamina-seedance-2-0-260128', 'doubao-seedance-2-0-260128'],
    },
    openrouter: {
        text: ['openrouter/auto', 'google/gemini-3-flash-preview', 'anthropic/claude-opus-4-6', 'deepseek/deepseek-r1'],
        image: ['openai/gpt-image-1', 'google/imagen-4.0-generate-001'],
        video: [],
    },
    openai_compatible: {
        text: [],
        image: [],
        video: [],
    },
};

export interface ApiKeyValidationResult {
    ok: boolean;
    message?: string;
    endpointFlavor?: FetchModelsResult['endpointFlavor'];
    capabilitySummary?: AICapability[];
    effectiveBaseUrl?: string;
    models?: FetchModelsResult['models'];
}

type CustomProviderExtraConfig = Record<string, string> | undefined;

export type VideoAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | 'adaptive';

const DEFAULT_SEEDANCE_MODEL = 'doubao-seedance-2.0';
const SEEDANCE_RESOLUTIONS = ['480p', '720p', '1080p'] as const;
const SEEDANCE_RATIOS: VideoAspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'];
const SEEDANCE_REFERENCE_LIMITS: Record<MultimodalSlotKind, number> = {
    image: 9,
    video: 3,
    audio: 3,
};

export type CapabilityDictionary = {
    multimodalSlots: Partial<Record<MultimodalSlotKind, {
        max: number;
        roles: string[];
    }>>;
    requestParams: string[];
    aspectRatios?: VideoAspectRatio[];
    resolutions?: string[];
    durations?: number[];
    defaults?: Record<string, unknown>;
    endpoint?: 'images/generations' | 'images/edits' | 'contents/generations/tasks';
    responseFormat?: 'b64_json' | 'url' | 'implicit';
    outputFormat?: 'png' | 'jpeg' | 'webp';
};

const OPENAI_GPT_IMAGE_CAPABILITY: CapabilityDictionary = {
    multimodalSlots: {
        image: { max: 16, roles: ['reference_image', 'first_frame', 'last_frame', 'style_ref', 'unassigned'] },
    },
    requestParams: ['size', 'quality', 'background', 'moderation', 'output_format', 'output_compression'],
    defaults: {
        size: '1024x1024',
        quality: 'auto',
        output_format: 'png',
    },
    endpoint: 'images/generations',
    responseFormat: 'implicit',
    outputFormat: 'png',
};

const DEFAULT_VIDEO_CAPABILITY: CapabilityDictionary = {
    multimodalSlots: {
        image: { max: 1, roles: ['first_frame', 'reference_image', 'unassigned'] },
    },
    requestParams: ['ratio'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
};

const SEEDANCE_CAPABILITY: CapabilityDictionary = {
    multimodalSlots: {
        image: { max: 9, roles: ['reference_image', 'first_frame', 'last_frame', 'style_ref', 'unassigned'] },
        video: { max: 3, roles: ['reference_video', 'unassigned'] },
        audio: { max: 3, roles: ['reference_audio', 'unassigned'] },
    },
    requestParams: [
        'ratio',
        'duration',
        'resolution',
        'frames',
        'seed',
        'camera_fixed',
        'watermark',
        'return_last_frame',
        'generate_audio',
        'service_tier',
        'safety_identifier',
    ],
    aspectRatios: SEEDANCE_RATIOS,
    resolutions: [...SEEDANCE_RESOLUTIONS],
    durations: [5, 10],
    defaults: {
        generate_audio: true,
        duration: 5,
        watermark: false,
    },
    endpoint: 'contents/generations/tasks',
};

export function getCapabilityDictionary(model: string, provider: AIProvider = inferProviderFromModel(model)): CapabilityDictionary {
    const normalized = normalizeModelName(model);
    if (provider === 'volcengine' || normalized.includes('seedance')) {
        return SEEDANCE_CAPABILITY;
    }
    if (provider === 'openrouter' && inferCapabilityFromModelName(model) === 'image') {
        return OPENAI_GPT_IMAGE_CAPABILITY;
    }
    if ((provider === 'openai' || provider === 'custom' || provider === 'openai_compatible') && isOpenAIImageEditModel(model)) {
        return OPENAI_GPT_IMAGE_CAPABILITY;
    }
    return DEFAULT_VIDEO_CAPABILITY;
}

function normalizeMultimodalRole(slot: MultimodalSlot): string {
    if (slot.kind === 'image') return slot.role && slot.role !== 'unassigned' ? String(slot.role) : 'reference_image';
    if (slot.kind === 'video') return slot.role && slot.role !== 'unassigned' ? String(slot.role) : 'reference_video';
    if (slot.kind === 'audio') return slot.role && slot.role !== 'unassigned' ? String(slot.role) : 'reference_audio';
    return 'unassigned';
}

function filterMultimodalSlots(slots: MultimodalSlot[], capability: CapabilityDictionary): MultimodalSlot[] {
    const counts: Partial<Record<MultimodalSlotKind, number>> = {};
    return slots.filter((slot) => {
        const slotCapability = capability.multimodalSlots[slot.kind];
        if (!slotCapability || !slot.href) return false;
        const count = counts[slot.kind] || 0;
        if (count >= slotCapability.max) return false;
        const role = normalizeMultimodalRole(slot);
        if (
            slotCapability.roles.length > 0
            && !slotCapability.roles.includes(role)
            && !slotCapability.roles.includes(String(slot.role || ''))
        ) {
            return false;
        }
        counts[slot.kind] = count + 1;
        return true;
    });
}

function isSeedanceFastModel(model: string): boolean {
    const normalized = normalizeModelName(model);
    return normalized.includes('seedance') && normalized.includes('fast');
}

function normalizeSeedanceResolution(value: string | undefined, model = ''): string {
    const token = String(value || '720p').trim().toLowerCase();
    const normalized = token === 'low'
        ? '480p'
        : token === 'auto' || token === 'medium' || token === 'high'
            ? '720p'
            : `${(token.replace(/p$/i, '') || '720')}p`;

    if (isSeedanceFastModel(model) && normalized === '1080p') return '720p';
    return (SEEDANCE_RESOLUTIONS as readonly string[]).includes(normalized) ? normalized : '720p';
}

function normalizeSeedanceDuration(value: number | string | undefined): number {
    if (String(value ?? '').trim() === '-1') return -1;
    const seconds = Math.floor(Number(value) || 5);
    return Math.max(4, Math.min(15, seconds));
}

function normalizeSeedanceRatio(value: string | undefined): VideoAspectRatio {
    const raw = String(value || '').trim();
    if (!raw || raw === 'auto' || raw === 'adaptive') return 'adaptive';
    if ((SEEDANCE_RATIOS as string[]).includes(raw)) return raw as VideoAspectRatio;

    const match = raw.match(/^(\d+)x(\d+)$/);
    if (!match) return 'adaptive';
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) return 'adaptive';

    const ratio = width / height;
    const options: Array<[Exclude<VideoAspectRatio, 'adaptive'>, number]> = [
        ['16:9', 16 / 9],
        ['4:3', 4 / 3],
        ['1:1', 1],
        ['3:4', 3 / 4],
        ['9:16', 9 / 16],
        ['21:9', 21 / 9],
    ];
    return options.reduce((best, item) => (
        Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best
    ), options[0])[0];
}

function validateSeedanceSlots(slots: MultimodalSlot[], capability: CapabilityDictionary): void {
    const counts: Partial<Record<MultimodalSlotKind, number>> = {};
    for (const slot of slots) {
        if (!slot.href) continue;
        counts[slot.kind] = (counts[slot.kind] || 0) + 1;
    }

    for (const kind of Object.keys(SEEDANCE_REFERENCE_LIMITS) as MultimodalSlotKind[]) {
        const count = counts[kind] || 0;
        const max = capability.multimodalSlots[kind]?.max ?? SEEDANCE_REFERENCE_LIMITS[kind];
        if (count > max) {
            const label = kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频';
            throw new Error(`Seedance 参考${label}最多支持 ${max} 个，当前传入 ${count} 个。`);
        }
    }

    if ((counts.audio || 0) > 0 && (counts.image || 0) === 0 && (counts.video || 0) === 0) {
        throw new Error('Seedance 参考音频不能单独使用，请同时添加参考图或参考视频。');
    }
}

async function resolveSeedanceSlotUrls(slots: MultimodalSlot[]): Promise<MultimodalSlot[]> {
    return Promise.all(slots.map(async slot => {
        const href = slot.href?.trim() || '';
        if (!href) return slot;
        if (/^https?:\/\//i.test(href) || href.startsWith('asset://')) return slot;
        if (href.startsWith('data:')) return slot;
        if (href.startsWith('blob:')) {
            const dataUrl = await blobToDataUrl(href);
            return { ...slot, href: dataUrl };
        }
        throw new Error(`Seedance 参考${slot.kind === 'image' ? '图片' : slot.kind === 'video' ? '视频' : '音频'}地址无法解析，请使用公网 URL、asset:// 素材或本地画布元素。`);
    }));
}

function withSupportedParams(
    capability: CapabilityDictionary,
    input: Record<string, unknown>,
): Record<string, unknown> {
    const allowed = new Set(capability.requestParams);
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries({ ...(capability.defaults || {}), ...input })) {
        if (!allowed.has(key)) continue;
        if (value === undefined || value === null || value === '') continue;
        output[key] = value;
    }
    return output;
}

/**
 * Provider → supported video aspect ratios.
 * If a provider is not listed, all 6 ratios are assumed to pass through as-is (custom/openrouter).
 */
export const PROVIDER_VIDEO_RATIOS: Partial<Record<AIProvider, VideoAspectRatio[]>> = {
    google:     ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], // Veo accepts all 6
    minimax:    ['16:9', '9:16', '1:1'],                        // MiniMax only supports 16:9/9:16/1:1
    keling:     ['16:9', '9:16', '1:1'],                        // Kling AI: 16:9/9:16/1:1
    volcengine: SEEDANCE_RATIOS,                                // Seedance 2.0
};

/** Check whether a given ratio is supported by the inferred video provider. */
export function isRatioSupportedByProvider(ratio: VideoAspectRatio, model: string, key?: UserApiKey): boolean {
    const provider = resolveGenerationProvider(model, key);
    const allowed = PROVIDER_VIDEO_RATIOS[provider];
    if (!allowed) return true; // unknown / custom provider → allow all
    return allowed.includes(ratio);
}

/** Return the list of supported ratios for a given video model. */
export function getSupportedRatios(model: string, key?: UserApiKey): VideoAspectRatio[] {
    const provider = resolveGenerationProvider(model, key);
    return PROVIDER_VIDEO_RATIOS[provider] ?? ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
}

/**
 * 通用 API Key 验证 — 根据 provider 调用对应的验证逻辑
 */
export async function validateApiKey(provider: AIProvider, apiKey: string, baseUrl?: string, extraConfig?: CustomProviderExtraConfig): Promise<ApiKeyValidationResult> {
    const normalizedInputBaseUrl = baseUrl ? normalizeProviderBaseUrl(provider, baseUrl) : undefined;

    if (provider === 'custom' && extraConfig?.requestFormat === 'anthropic') {
        try {
            const url = normalizeProviderBaseUrl(provider, baseUrl || '').replace(/\/$/, '');
            const res = await fetch(`${url}/messages`, {
                method: 'POST',
                headers: buildProviderHeaders(apiKey, { id: 'validation', provider, capabilities: ['text'], key: apiKey, extraConfig, createdAt: 0, updatedAt: 0 }, { anthropic: true }),
                body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
            });
            if (res.ok || res.status === 200) return { ok: true, capabilitySummary: ['text'], effectiveBaseUrl: url };
            if (res.status === 401 || res.status === 403) return { ok: false, message: 'API Key 无效或权限不足' };
            return { ok: true, capabilitySummary: ['text'], effectiveBaseUrl: url };
        } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : '网络错误' };
        }
    }

    if (provider === 'google') {
        const result = await fetchModelsForProvider(provider, apiKey, baseUrl);
        if (!result.ok) return { ok: false, message: result.error };
        return {
            ok: true,
            message: result.capabilitySummary?.length
                ? `已验证，可用能力：${result.capabilitySummary.join(' / ')}${result.effectiveBaseUrl && result.effectiveBaseUrl !== normalizedInputBaseUrl ? `，已自动识别 API 根：${result.effectiveBaseUrl}` : ''}`
                : '已验证',
            endpointFlavor: result.endpointFlavor,
            capabilitySummary: result.capabilitySummary,
            effectiveBaseUrl: result.effectiveBaseUrl,
            models: result.models,
        };
    }

    // OpenAI-compatible: 不仅检查鉴权，还拿到能力摘要和协议类型
    if (provider === 'openai' || provider === 'qwen' || provider === 'deepseek' || provider === 'siliconflow' || provider === 'minimax' || provider === 'volcengine' || provider === 'openrouter' || provider === 'openai_compatible' || provider === 'custom') {
        const result = await fetchModelsForProvider(provider, apiKey, baseUrl);
        if (!result.ok) return { ok: false, message: result.error };
        return {
            ok: true,
            message: result.capabilitySummary?.length
                ? `已验证，可用能力：${result.capabilitySummary.join(' / ')}${result.effectiveBaseUrl && result.effectiveBaseUrl !== normalizedInputBaseUrl ? `，已自动识别 API 根：${result.effectiveBaseUrl}` : ''}`
                : '已验证，但端点未返回模型列表',
            endpointFlavor: result.endpointFlavor,
            capabilitySummary: result.capabilitySummary,
            effectiveBaseUrl: result.effectiveBaseUrl,
            models: result.models,
        };
    }

    // Anthropic: 调用 /messages 会返回 401 如果 key 无效
    if (provider === 'anthropic') {
        try {
            const url = (baseUrl || DEFAULT_BASE_URLS.anthropic).replace(/\/$/, '');
            const res = await fetch(`${url}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
            });
            if (res.ok || res.status === 200) return { ok: true };
            if (res.status === 401 || res.status === 403) return { ok: false, message: 'API Key 无效或权限不足' };
            return { ok: true, capabilitySummary: ['text'] }; // 其他错误可能是模型不存在，但 key 是对的
        } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : '网络错误' };
        }
    }

    // Keling / Flux / Midjourney: OpenAI-compatible 验证
    if (provider === 'keling' || provider === 'flux' || provider === 'midjourney') {
        try {
            const url = normalizeProviderBaseUrl(provider, baseUrl || DEFAULT_BASE_URLS[provider]);
            const res = await fetch(`${url}/models`, {
                method: 'GET',
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (res.ok) return { ok: true, capabilitySummary: inferCapabilitiesByProvider(provider) };
            if (res.status === 401 || res.status === 403) return { ok: false, message: 'API Key 无效或权限不足' };
            return { ok: true, message: '已保存（无法确认在线状态，但格式正确）', capabilitySummary: inferCapabilitiesByProvider(provider) };
        } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : '网络错误' };
        }
    }

    // RunningHub: 32位 hex key 验证
    if (provider === 'runningHub') {
        try {
            const result = await fetchModelsForProvider(provider, apiKey, normalizedInputBaseUrl);
            if (!result.ok) return { ok: false, message: result.error || 'API Key 无效或权限不足' };
            return {
                ok: true,
                message: result.models.length > 0
                    ? `RunningHub Key 已验证，已获取 ${result.models.length} 个标准模型。`
                    : 'RunningHub Key 已验证，可用于标准模型生成。',
                capabilitySummary: result.capabilitySummary || ['image', 'video'],
                effectiveBaseUrl: result.effectiveBaseUrl || normalizedInputBaseUrl || DEFAULT_BASE_URLS.runningHub,
                models: result.models,
            };
        } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : '网络错误' };
        }
    }

    // 其他 provider: 简单格式校验
    if (apiKey.length < 10) return { ok: false, message: 'API Key 太短' };
    return { ok: true, message: '已保存（格式校验通过，未做在线验证）', capabilitySummary: inferCapabilitiesByProvider(provider) };
}

const DEFAULT_BASE_URLS: Record<AIProvider, string> = {
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

/**
 * 根据 API Key 格式自动推断 Provider（用于粘贴时自动识别）
 */
export function inferProviderFromKey(apiKey: string): AIProvider | null {
    const trimmed = apiKey.trim();
    if (/^AIzaSy/i.test(trimmed)) return 'google';
    if (/^sk-ant-/i.test(trimmed)) return 'anthropic';
    if (/^sk-or-/i.test(trimmed)) return 'openrouter';
    if (/^sk-proj-/i.test(trimmed) || /^sk-[a-zA-Z0-9]{20,}$/.test(trimmed)) return 'openai';
    if (/^sk-[a-f0-9]{32,}$/i.test(trimmed)) return 'deepseek';
    // Stability AI removed — sa- prefix keys no longer auto-detected
    if (/^sk-sf/i.test(trimmed)) return 'siliconflow';
    if (/^eyJ/i.test(trimmed)) return 'minimax'; // MiniMax keys start with eyJ (JWT-like)
    if (/^[a-f0-9]{32}$/i.test(trimmed)) return 'runningHub'; // 32-char hex
    return null;
}

/**
 * Provider 默认 capabilities 推断
 */
export function inferCapabilitiesByProvider(provider: AIProvider): import('../types').AICapability[] {
    if (provider === 'runningHub') return ['image', 'video'];
    const caps = DEFAULT_PROVIDER_MODELS[provider];
    if (!caps) return ['text', 'image'];
    const result: import('../types').AICapability[] = [];
    if (caps.text?.length) result.push('text');
    if (caps.image?.length) result.push('image');
    if (caps.video?.length) result.push('video');
    return result.length ? result : ['text'];
}

/** Provider 可读标签 */
export const PROVIDER_LABELS: Record<AIProvider, string> = {
    google: 'Google Gemini',
    openai: 'OpenAI',
    anthropic: 'Anthropic Claude',
    qwen: 'Qwen 通义千问',
    deepseek: 'DeepSeek 深度求索',
    siliconflow: 'SiliconFlow 硅基流动',
    keling: 'Keling 可灵',
    flux: 'Flux (BFL)',
    midjourney: 'Midjourney',
    runningHub: 'RunningHub',
    minimax: 'MiniMax',
    volcengine: '火山引擎 (豆包)',
    openrouter: 'OpenRouter',
    openai_compatible: 'OpenAI Compatible',
    custom: '自定义',
};

function getBaseUrl(provider: AIProvider, key?: UserApiKey) {
    return normalizeProviderBaseUrl(provider, key?.baseUrl || DEFAULT_BASE_URLS[provider]);
}

function requireApiKey(provider: AIProvider, key?: UserApiKey) {
    if (!key?.key) {
        throw new Error(`未配置 ${provider} 的 API Key。请先在设置中保存。`);
    }
    return key.key;
}

function parseModelMappings(config: CustomProviderExtraConfig): Record<string, string> {
    const raw = config?.modelMappingsJson;
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function stripModelSelectionRef(model: string): string {
    const index = model.indexOf('::');
    return index >= 0 ? model.slice(index + 2) : model;
}

function mapProviderModel(model: string, key?: UserApiKey): string {
    const bareModel = stripModelSelectionRef(model);
    return parseModelMappings(key?.extraConfig)[bareModel] || bareModel;
}

function buildProviderHeaders(
    apiKey: string,
    key?: UserApiKey,
    options: { contentType?: boolean; anthropic?: boolean } = { contentType: true },
): Record<string, string> {
    const headers: Record<string, string> = {};
    if (options.contentType !== false) headers['Content-Type'] = 'application/json';

    const headerName = key?.extraConfig?.authHeaderName || 'Authorization';
    const authScheme = key?.extraConfig?.authScheme ?? 'Bearer';
    headers[headerName] = authScheme === '' ? apiKey : `${authScheme || 'Bearer'} ${apiKey}`;

    if (options.anthropic) {
        headers['anthropic-version'] = '2023-06-01';
    }
    return headers;
}

function usesAnthropicRequestFormat(key?: UserApiKey): boolean {
    return key?.provider === 'custom' && key.extraConfig?.requestFormat === 'anthropic';
}

function normalizeModelName(model: string): string {
    return stripModelSelectionRef(model).trim().toLowerCase();
}

function stripModelProviderPrefix(model: string): string {
    const normalized = normalizeModelName(model);
    const parts = normalized.split('/');
    return parts.length > 1 ? parts.slice(1).join('/') : normalized;
}

export function inferCapabilityFromModel(model: string): AICapability | undefined {
    const normalized = stripModelProviderPrefix(model);
    if (!normalized) return undefined;
    if (/^(veo([-.\d]|$)|video|wan|seedance|vidu|pika|runway|higgsfield|luma|kling|keling|sora|sdols|hailuo|qwen-video|liveportrait|videoretalk|emo|gemini-omni|happyhorse|ltx|pixverse|skyreels)/.test(normalized)) return 'video';
    if (/(^|[-_/])(text|image|reference|start|end|multimodal)?-?to-video|video-edit|edit-video|motion-control|video-extend/.test(normalized)) return 'video';
    if (/^(rhart-image|runninghub-image|imagen|dall-e|gpt-image|flux|stable-diffusion|sdxl|midjourney|recraft|ideogram|qwen-image|seedream|seededit|nano-banana|jimeng|doubao-image|omni-image|grok-image|f-|z-image|xai\/rhart|xai\/grok-imagine-image)/.test(normalized)) return 'image';
    if (/(^|[-_/])(text|image)-to-image|image-edit|edit-channel|edit-official|\/edit(?:-|$)/.test(normalized)) return 'image';
    if (/^gemini/.test(normalized)) return normalized.includes('image') ? 'image' : 'text';
    if (/^(gpt|o\d|claude|qwen|deepseek|llama|command|mistral|doubao|abab|minimax)/.test(normalized)) return 'text';
    return undefined;
}

export function inferCapabilityFromModelName(modelName: string): ElementMediaCapability {
    const stripped = stripModelProviderPrefix(modelName);
    const normalized = stripped.includes('/') ? stripped.split('/').pop() || stripped : stripped;

    if (/^(veo([-.\d]|$)|video|wan|seedance|vidu|pika|runway|higgsfield|luma|kling|keling|sora|sdols|hailuo|qwen-video|liveportrait|videoretalk|emo|cogvideo|hunyuan-video)/.test(normalized)) {
        return 'video';
    }

    if (normalized.includes('video') || normalized.includes('movie')) {
        return 'video';
    }

    return 'image';
}

export function getDynamicParamSchema(modelName: string): ModelParamSchema {
    const capability = inferCapabilityFromModelName(modelName);
    const normalized = normalizeModelName(modelName);

    if (capability === 'video') {
        return {
            hasSeed: true,
            hasCfgScale: false,
            hasAspectRatio: true,
            defaultAspectRatio: '16:9',
        };
    }

    return {
        hasSeed: true,
        hasCfgScale: !normalized.includes('flux'),
        hasAspectRatio: false,
    };
}

function getImageReferencesForIgnition(references: IgnitionReference[] = []): VideoImage[] {
    return references
        .filter((reference): reference is IgnitionReference & { type: 'image'; href: string; mimeType: string } => (
            reference.type === 'image' && typeof reference.href === 'string' && reference.href.length > 0
        ))
        .map(reference => ({
            href: reference.href,
            mimeType: reference.mimeType || 'image/png',
            slotRole: reference.slotRole,
            label: reference.label,
            sourceName: reference.sourceName,
            elementId: reference.elementId,
        }));
}

function getMultimodalSlotsForIgnition(references: IgnitionReference[] = []): MultimodalSlot[] {
    return references
        .filter((reference): reference is IgnitionReference & { type: 'image' | 'video' | 'audio'; href: string; mimeType: string } => (
            (reference.type === 'image' || reference.type === 'video' || reference.type === 'audio')
            && typeof reference.href === 'string'
            && reference.href.length > 0
        ))
        .map(reference => ({
            kind: reference.type,
            href: reference.href,
            mimeType: reference.mimeType || (reference.type === 'audio' ? 'audio/mpeg' : reference.type === 'video' ? 'video/mp4' : 'image/png'),
            role: reference.slotRole,
            label: reference.label || reference.sourceName,
        }));
}

function multimodalSlotsFromLegacyReferences(references: VideoImage[] = []): MultimodalSlot[] {
    return references.map(reference => ({
        kind: 'image',
        href: reference.href,
        mimeType: reference.mimeType || 'image/png',
        role: reference.slotRole,
        label: reference.label || reference.sourceName,
    }));
}

function referenceOrdinalLabel(kind: MultimodalSlotKind | 'text' | 'shape', index: number): string {
    if (kind === 'image') return `图片${index + 1}`;
    if (kind === 'video') return `视频${index + 1}`;
    if (kind === 'audio') return `音频${index + 1}`;
    if (kind === 'text') return `文本${index + 1}`;
    return `形状${index + 1}`;
}

function normalizeMentionLabel(label?: string): string {
    const trimmed = label?.trim();
    if (!trimmed) return '';
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function trimReferenceText(value?: string): string {
    const normalized = value?.replace(/\s+/g, ' ').trim() || '';
    if (normalized.length <= 500) return normalized;
    return `${normalized.slice(0, 500)}...`;
}

function buildPromptWithReferenceBindings(prompt: string, references: IgnitionReference[] = []): string {
    const text = prompt.trim();
    const counts: Record<MultimodalSlotKind | 'text' | 'shape', number> = {
        image: 0,
        video: 0,
        audio: 0,
        text: 0,
        shape: 0,
    };
    const lines: string[] = [];

    for (const reference of references) {
        if (reference.type === 'image' || reference.type === 'video' || reference.type === 'audio') {
            if (!reference.href) continue;
        }
        const index = counts[reference.type]++;
        const ordinal = referenceOrdinalLabel(reference.type, index);
        const mention = normalizeMentionLabel(reference.label || reference.sourceName);
        const nameNote = reference.sourceName && mention && reference.sourceName !== mention.replace(/^@/, '')
            ? `（${reference.sourceName}）`
            : '';
        if (reference.type === 'text' || reference.type === 'shape') {
            const referenceText = trimReferenceText(reference.text);
            lines.push(referenceText
                ? `${ordinal} = ${mention || reference.sourceName || reference.elementId || '未命名引用'}${nameNote}: ${referenceText}`
                : `${ordinal} = ${mention || reference.sourceName || reference.elementId || '未命名引用'}${nameNote}`);
        } else {
            const role = reference.slotRole && reference.slotRole !== 'unassigned' ? `，slot=${reference.slotRole}` : '';
            lines.push(`${ordinal} = ${mention || reference.sourceName || reference.elementId || '未命名引用'}${nameNote}${role}`);
        }
    }

    if (lines.length === 0) return text;
    return [
        '引用绑定（请严格按这些绑定理解提示词中的 @名称，尤其不要混淆不同角色、主体、首尾帧或风格参考）：',
        ...lines.map(line => `- ${line}`),
        '',
        '用户提示词：',
        text,
    ].join('\n');
}

function parseTextResponseContent(json: any): string {
    const anthropicContent = Array.isArray(json?.content)
        ? json.content.map((item: { text?: string }) => item.text || '').join('\n').trim()
        : '';
    if (anthropicContent) return anthropicContent;

    const openAIContent = json?.choices?.[0]?.message?.content;
    if (typeof openAIContent === 'string') return openAIContent.trim();

    if (typeof json?.text === 'string') return json.text.trim();
    return '';
}

export async function generateTextWithProvider(
    prompt: string,
    model: string,
    key?: UserApiKey,
    options?: {
        systemPrompt?: string;
        temperature?: number;
        maxTokens?: number;
        signal?: AbortSignal;
    },
): Promise<string> {
    const provider = resolveGenerationProvider(model, key);
    const apiKey = requireApiKey(provider, key);
    const baseUrl = getBaseUrl(provider, key);
    const mappedModel = mapProviderModel(model, key);

    if (provider === 'google') {
        const googleBase = key?.baseUrl ? normalizeProviderBaseUrl('google', key.baseUrl) : getGeminiRestBaseUrl();
        const response = await fetch(`${googleBase}/models/${encodeURIComponent(mappedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: options?.signal,
            body: JSON.stringify({
                systemInstruction: options?.systemPrompt ? { parts: [{ text: options.systemPrompt }] } : undefined,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: options?.temperature ?? 0.7, maxOutputTokens: options?.maxTokens ?? 4096 },
            }),
        });
        if (!response.ok) throw new Error(await readErrorResponse(response, 'Google LLM 请求失败'));
        const json = await readJsonResponse<any>(response, 'Google LLM 响应');
        return json?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('\n').trim() || '';
    }

    if (provider === 'anthropic' || usesAnthropicRequestFormat(key)) {
        const response = await fetch(`${baseUrl}/messages`, {
            method: 'POST',
            headers: buildProviderHeaders(apiKey, key, { anthropic: true }),
            signal: options?.signal,
            body: JSON.stringify({
                model: mappedModel,
                max_tokens: options?.maxTokens ?? 4096,
                system: options?.systemPrompt,
                messages: [{ role: 'user', content: prompt }],
            }),
        });
        if (!response.ok) throw new Error(await readErrorResponse(response, 'Anthropic LLM 请求失败'));
        return parseTextResponseContent(await readJsonResponse<any>(response, 'Anthropic LLM 响应'));
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: provider === 'openrouter' ? buildOpenRouterHeaders(apiKey) : buildProviderHeaders(apiKey, key),
        signal: options?.signal,
        body: JSON.stringify({
            model: mappedModel,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? 4096,
            messages: [
                ...(options?.systemPrompt ? [{ role: 'system', content: options.systemPrompt }] : []),
                { role: 'user', content: prompt },
            ],
        }),
    });
    if (!response.ok) throw new Error(await readErrorResponse(response, `${PROVIDER_LABELS[provider] || provider} LLM 请求失败`));
    return parseTextResponseContent(await readJsonResponse<any>(response, `${PROVIDER_LABELS[provider] || provider} LLM 响应`));
}

export function isGoogleImageEditModel(model: string): boolean {
    const normalized = normalizeModelName(model);
    return inferProviderFromModel(model) === 'google' && /^gemini/.test(normalized) && normalized.includes('image');
}

export function isGoogleTextToImageModel(model: string): boolean {
    return inferProviderFromModel(model) === 'google' && /^imagen/.test(normalizeModelName(model));
}

function isOpenAIImageEditModel(model: string): boolean {
    const normalized = normalizeModelName(model).replace(/^openai\//, '');
    return /^(gpt-image-2|gpt-image-1\.5|gpt-image-1(?:-mini)?|gpt-image-1)$/.test(normalized);
}

const GPT_IMAGE_INPUT_IMAGE_LIMIT = 16;

function limitProviderImageInputs<T>(images: T[], provider: AIProvider, model: string, key?: UserApiKey): T[] {
    const mappedModel = mapProviderModel(model, key);
    const capability = getCapabilityDictionary(mappedModel, provider);
    const maxImages = capability.multimodalSlots.image?.max;
    if (maxImages) {
        return images.slice(0, maxImages);
    }
    return images;
}

export function supportsReferenceImageEditing(model: string): boolean {
    const provider = inferProviderFromModel(model);
    if (provider === 'google') return isGoogleImageEditModel(model);
    return true;
}

export function supportsMaskImageEditing(model: string): boolean {
    const provider = inferProviderFromModel(model);
    if (provider === 'google') return isGoogleImageEditModel(model);
    if (provider === 'openai' || provider === 'custom' || provider === 'openai_compatible') return isOpenAIImageEditModel(model);
    return false;
}

function parseDataUrl(dataUrl: string, fallbackMimeType = 'image/png') {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
        return { mimeType: match[1], base64: match[2] };
    }

    const parts = dataUrl.split(',');
    return {
        mimeType: fallbackMimeType,
        base64: parts.length > 1 ? parts[1] : parts[0],
    };
}

function createBlobFromBase64(base64: string, mimeType: string) {
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
}

function buildOpenAIImageRequestParams(
    capability: CapabilityDictionary,
    input: Record<string, unknown>,
): Record<string, unknown> {
    const params = withSupportedParams(capability, input);
    if (capability.outputFormat && !params.output_format) {
        params.output_format = capability.outputFormat;
    }
    return params;
}

function appendOpenAIImageFormParams(formData: FormData, params: Record<string, unknown>) {
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        formData.append(key, String(value));
    }
}

function decodeDataUrlImage(dataUrl: string) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
        throw new Error('模型返回了无法识别的图片数据格式。');
    }

    return {
        newImageMimeType: match[1],
        newImageBase64: match[2],
        textResponse: null,
    };
}

const DEFAULT_RUNNINGHUB_PROMPT_FIELD = '12##text';
const DEFAULT_RUNNINGHUB_IMAGE_PAYLOAD: Record<string, unknown> = {
    '42##select': '1',
    '43##value': 1024,
    '30##value': 1024,
    '44##file_type': 'PNG',
};

const RUNNINGHUB_STANDARD_MODEL_DEFAULTS: Array<{ pattern: RegExp; payload: Record<string, unknown> }> = [
    { pattern: /^rhart-image-(?:g-2|n-g31-flash)\/(?:text-to-image|image-to-image)$/i, payload: { resolution: '1k' } },
    {
        pattern: /^rhart-video\/sparkvideo-2\.0\/multimodal-video$/i,
        payload: {
            resolution: '720p',
            duration: '5',
            generateAudio: false,
            realPersonMode: true,
            conversionSlots: ['all'],
            returnLastFrame: false,
            seed: -1,
        },
    },
];

function runningHubStandardModelDefaults(modelEndpoint: string) {
    return RUNNINGHUB_STANDARD_MODEL_DEFAULTS.reduce<Record<string, unknown>>((payload, preset) => {
        if (preset.pattern.test(modelEndpoint)) Object.assign(payload, preset.payload);
        return payload;
    }, {});
}

function parseProviderJsonObject(raw: string | undefined, label: string): Record<string, unknown> {
    const trimmed = raw?.trim();
    if (!trimmed) return {};
    try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`${label} 必须是 JSON 对象。`);
        }
        return parsed as Record<string, unknown>;
    } catch (error) {
        if (error instanceof Error && error.message.includes(label)) throw error;
        throw new Error(`${label} 不是有效 JSON，请检查逗号和引号。`);
    }
}

function isRunningHubNodeFieldModel(modelEndpoint: string) {
    return /^(?:rhart-image\/)?f(?:-|_|$)|^f-/i.test(modelEndpoint);
}

function isRunningHubSeedance20Model(modelEndpoint: string) {
    return /(?:sparkvideo|seedance)-2\.0/i.test(modelEndpoint);
}

function isRunningHubVideoEndpoint(modelEndpoint: string) {
    return /rhart-video\/|image-to-video|start-end-to-video|multimodal-video/i.test(modelEndpoint);
}

function runningHubAspectRatioField(modelEndpoint: string) {
    return isRunningHubSeedance20Model(modelEndpoint) ? 'ratio' : 'aspectRatio';
}

function assertRunningHubPublicUrl(href: string | undefined, fieldName: string) {
    const url = href?.trim() || '';
    if (!/^https?:\/\//i.test(url)) {
        throw new Error(`RunningHub ${fieldName} 需要公网 http(s) URL，当前为空或仍是本地引用。`);
    }
    return url;
}

function runningHubReferenceFields(modelEndpoint: string, references: VideoImage[] = []) {
    if (/image-to-image|image-to-video|start-end-to-video/i.test(modelEndpoint) && references.length === 0) {
        throw new Error(`RunningHub ${modelEndpoint} 需要至少一张参考图，请连接图片节点或拖入图片后再生成。`);
    }
    const first = references.find(ref => ref.slotRole === 'first_frame') || references[0];
    const last = references.find(ref => ref.slotRole === 'last_frame') || references[1];
    const urls = references.map((ref, index) => assertRunningHubPublicUrl(ref.href, `imageUrls[${index}]`));
    const output: Record<string, unknown> = {};

    if (/start-end-to-video/i.test(modelEndpoint) || /(?:sparkvideo|seedance)-2\.0\/image-to-video/i.test(modelEndpoint)) {
        if (first?.href) output.firstFrameUrl = assertRunningHubPublicUrl(first.href, 'firstFrameUrl');
        if (last?.href) output.lastFrameUrl = assertRunningHubPublicUrl(last.href, 'lastFrameUrl');
        return output;
    }

    if (/kling|hailuo/i.test(modelEndpoint) && urls[0]) {
        output.imageUrl = urls[0];
        return output;
    }

    if (urls.length > 0) {
        output.imageUrls = urls;
    }
    return output;
}

function runningHubMultimodalFields(
    modelEndpoint: string,
    references: VideoImage[] = [],
    slots: MultimodalSlot[] = [],
) {
    if (!/(?:sparkvideo|seedance)-2\.0\/multimodal-video/i.test(modelEndpoint)) {
        return runningHubReferenceFields(modelEndpoint, references);
    }
    const imageUrls = [
        ...references.map(ref => ref.href),
        ...slots.filter(slot => slot.kind === 'image').map(slot => slot.href),
    ].map((href, index) => assertRunningHubPublicUrl(href, `imageUrls[${index}]`));
    const videoUrls = slots.filter(slot => slot.kind === 'video').map((slot, index) => assertRunningHubPublicUrl(slot.href, `videoUrls[${index}]`));
    const audioUrls = slots.filter(slot => slot.kind === 'audio').map((slot, index) => assertRunningHubPublicUrl(slot.href, `audioUrls[${index}]`));
    const output: Record<string, unknown> = {};
    if (imageUrls.length > 0) output.imageUrls = Array.from(new Set(imageUrls));
    if (videoUrls.length > 0) output.videoUrls = Array.from(new Set(videoUrls));
    if (audioUrls.length > 0) output.audioUrls = Array.from(new Set(audioUrls));
    return output;
}

async function blobToDataUrl(href: string): Promise<string> {
    const res = await fetch(href);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('无法读取本地媒体'));
        reader.readAsDataURL(blob);
    });
}

async function prepareRunningHubReferences(
    apiKey: string,
    references: VideoImage[] = [],
    options?: { baseUrl?: string; signal?: AbortSignal },
): Promise<VideoImage[]> {
    if (references.length === 0) return [];
    const needsUpload = references.some(ref => ref.href.startsWith('data:') || ref.href.startsWith('blob:'));
    const uploadModule = needsUpload ? await import('./runningHubService') : null;
    return Promise.all(references.map(async ref => {
        if (/^https?:\/\//i.test(ref.href)) return ref;
        if (ref.href.startsWith('data:') && uploadModule) {
            return { ...ref, href: assertRunningHubPublicUrl(await uploadModule.rhUploadDataUrl(apiKey, ref.href, options), 'uploaded image URL') };
        }
        if (ref.href.startsWith('blob:') && uploadModule) {
            const dataUrl = await blobToDataUrl(ref.href);
            return { ...ref, href: assertRunningHubPublicUrl(await uploadModule.rhUploadDataUrl(apiKey, dataUrl, options), 'uploaded image URL') };
        }
        throw new Error('RunningHub 标准模型的参考媒体需要公网 URL；本地 data URL 会自动上传，其他本地地址暂不支持。');
    }));
}

async function prepareRunningHubSlots(
    apiKey: string,
    slots: MultimodalSlot[] = [],
    options?: { baseUrl?: string; signal?: AbortSignal },
): Promise<MultimodalSlot[]> {
    if (slots.length === 0) return [];
    const needsUpload = slots.some(slot => slot.href.startsWith('data:') || slot.href.startsWith('blob:'));
    const uploadModule = needsUpload ? await import('./runningHubService') : null;
    return Promise.all(slots.map(async slot => {
        if (/^https?:\/\//i.test(slot.href)) return slot;
        if (slot.href.startsWith('data:') && uploadModule) {
            return { ...slot, href: assertRunningHubPublicUrl(await uploadModule.rhUploadDataUrl(apiKey, slot.href, options), 'uploaded slot URL') };
        }
        if (slot.href.startsWith('blob:') && uploadModule) {
            const dataUrl = await blobToDataUrl(slot.href);
            return { ...slot, href: assertRunningHubPublicUrl(await uploadModule.rhUploadDataUrl(apiKey, dataUrl, options), 'uploaded slot URL') };
        }
        throw new Error('RunningHub 标准模型的参考媒体需要公网 URL；本地 data URL 会自动上传，其他本地地址暂不支持。');
    }));
}

function buildRunningHubStandardPayload(
    prompt: string,
    modelEndpoint: string,
    key?: UserApiKey,
    options?: {
        aspectRatio?: VideoAspectRatio;
        durationSec?: number;
        resolution?: string;
        references?: VideoImage[];
        slots?: MultimodalSlot[];
    },
): Record<string, unknown> {
    const extra = key?.extraConfig || {};
    const nodeFieldModel = isRunningHubNodeFieldModel(modelEndpoint);
    const promptField = extra.runningHubPromptField || (nodeFieldModel ? DEFAULT_RUNNINGHUB_PROMPT_FIELD : 'prompt');
    const disableDefaults = extra.runningHubDisableDefaultPayload === 'true';
    const configuredPayload = {
        ...parseProviderJsonObject(extra.configJson, 'RunningHub 配置 JSON'),
        ...parseProviderJsonObject(extra.runningHubDefaultPayloadJson, 'RunningHub 默认载荷 JSON'),
    };
    const payload: Record<string, unknown> = {
        ...(!disableDefaults && nodeFieldModel ? DEFAULT_RUNNINGHUB_IMAGE_PAYLOAD : {}),
        ...(!disableDefaults && !nodeFieldModel ? runningHubStandardModelDefaults(modelEndpoint) : {}),
        ...configuredPayload,
        [promptField]: prompt,
    };
    if (!nodeFieldModel) {
        if (options?.aspectRatio) payload[runningHubAspectRatioField(modelEndpoint)] = options.aspectRatio;
        if (isRunningHubVideoEndpoint(modelEndpoint)) {
            payload.resolution = options?.resolution || payload.resolution || '720p';
            payload.duration = String(options?.durationSec || payload.duration || 5);
        } else {
            if (options?.durationSec) payload.duration = String(options.durationSec);
            if (options?.resolution) payload.resolution = options.resolution;
        }
        Object.assign(payload, runningHubMultimodalFields(modelEndpoint, options?.references, options?.slots));
    }
    if (extra.runningHubOutputFormatField && extra.runningHubOutputFormat) {
        payload[extra.runningHubOutputFormatField] = extra.runningHubOutputFormat;
    }
    return payload;
}

function extractRunningHubMediaUrl(
    result: { results?: Array<{ url?: string; outputType?: string; text?: string | null }> | null },
    kind: 'image' | 'video',
) {
    const media = result.results?.find(item => {
        if (!item.url) return false;
        const hint = `${item.outputType || ''} ${item.url}`.toLowerCase();
        const isVideo = /\.(mp4|mov|webm)(?:[?#].*)?$/.test(hint) || /\b(mp4|mov|webm|video)\b/.test(hint);
        return kind === 'video' ? isVideo : !isVideo;
    });
    return media?.url || null;
}

/**
 * 下载远程图片 URL 并转为 base64
 */
async function fetchImageUrlToBase64(url: string): Promise<{ newImageBase64: string; newImageMimeType: string; textResponse: null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`下载图片失败 (${res.status}): ${url}`);
        const blob = await res.blob();
        const mimeType = blob.type || 'image/png';
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        // 分块转换避免 call stack 溢出（大图片 >3MB 时 spread 会爆栈）
        const chunks: string[] = [];
        for (let i = 0; i < bytes.length; i += 8192) {
            chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
        }
        return { newImageBase64: btoa(chunks.join('')), newImageMimeType: mimeType, textResponse: null };
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * 统一解析 OpenAI/Custom 图片生成响应 — 兼容多种格式：
 * 1. 标准 /images/generations → data[0].b64_json (纯 base64)
 * 2. 代理/聚合端点返回 data:URL 在 b64_json 字段
 * 3. data[0].url 远程图片链接
 * 4. chat/completions 响应 → markdown 图片链接
 */
async function parseOpenAIImageResponse(json: any): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null }> {
    // 尝试 /images/generations 标准格式
    const firstImage = json?.data?.[0];
    if (firstImage) {
        // b64_json 字段可能是纯 base64 或 data:URL
        if (firstImage.b64_json) {
            const dataUrlMatch = firstImage.b64_json.match(/^data:([^;]+);base64,(.+)$/);
            if (dataUrlMatch) {
                return { newImageBase64: dataUrlMatch[2], newImageMimeType: dataUrlMatch[1], textResponse: null };
            }
            return { newImageBase64: firstImage.b64_json, newImageMimeType: 'image/png', textResponse: null };
        }
        // url 字段
        if (firstImage.url) {
            if (firstImage.url.startsWith('data:')) return decodeDataUrlImage(firstImage.url);
            return fetchImageUrlToBase64(firstImage.url);
        }
    }

    // 尝试 chat/completions 格式 — 代理用 chat 接口生图
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
        // 提取 markdown 图片链接 ![...](https://...)
        const mdMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
        if (mdMatch) return fetchImageUrlToBase64(mdMatch[1]);
        // 纯 URL
        const urlMatch = content.match(/(https?:\/\/\S+\.(?:png|jpg|jpeg|webp|gif))/i);
        if (urlMatch) return fetchImageUrlToBase64(urlMatch[1]);
    }

    return { newImageBase64: null, newImageMimeType: null, textResponse: content || null };
}

function buildOpenRouterHeaders(apiKey: string) {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': globalThis.location?.origin || 'https://flovart.app',
        'X-OpenRouter-Title': 'Flovart',
    };
}

function truncateResponseSnippet(text: string, maxLength = 200) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength)}...`;
}

function looksLikeHtmlResponse(text: string) {
    return /^\s*<(?:!doctype|html|head|body)\b/i.test(text);
}

async function readJsonResponse<T>(response: Response, requestLabel: string): Promise<T> {
    const contentLength = Number(response.headers?.get?.('content-length') || 0);
    if (contentLength > 50 * 1024 * 1024) {
        throw new Error(`${requestLabel} 响应体过大 (${(contentLength / 1024 / 1024).toFixed(1)} MB)，已跳过解析。`);
    }
    const text = await response.text().catch(() => '');
    if (!text) {
        const json = await response.json?.().catch(() => undefined);
        return (json ?? {}) as T;
    }

    if (looksLikeHtmlResponse(text)) {
        throw new Error(`${requestLabel} 返回了 HTML 页面，请检查 Base URL 是否指向 API 接口而不是网站首页。`);
    }

    try {
        return JSON.parse(text) as T;
    } catch {
        const contentType = response.headers?.get?.('Content-Type') || 'unknown';
        throw new Error(`${requestLabel} 返回了非 JSON 响应 (${contentType})：${truncateResponseSnippet(text)}`);
    }
}

async function readErrorResponse(response: Response, requestLabel: string): Promise<string> {
    const text = await response.text().catch(() => '');
    if (!text) return `${requestLabel} (${response.status}): ${response.statusText}`;

    if (looksLikeHtmlResponse(text)) {
        return `${requestLabel} (${response.status}): 返回了 HTML 页面，请检查 Base URL 是否指向 API 接口而不是网站首页。`;
    }

    try {
        const json = JSON.parse(text);
        const detail = json?.error?.message || json?.message || json?.detail || json?.status_msg;
        if (detail) return `${requestLabel} (${response.status}): ${detail}`;
    } catch {
        // Fall back to plain text below.
    }

    return `${requestLabel} (${response.status}): ${truncateResponseSnippet(text)}`;
}

function resolveGenerationProvider(model: string, key?: UserApiKey): AIProvider {
    if (key?.provider === 'custom') {
        const endpointFlavor = key.extraConfig?.endpointFlavor;
        if (endpointFlavor === 'openrouter-compatible') return 'openrouter';
        // 所有 custom key 统一走 OpenAI-compatible 路径，
        // 不再 fallthrough 到 inferProviderFromModel（否则 gemini-xxx 会误路由到 Google SDK）
        return 'custom';
    }
    if (key?.provider) return key.provider;
    return inferProviderFromModel(model);
}

function inferPromptModeHint(request: PromptEnhanceRequest) {
    const modeHintMap: Record<PromptEnhanceRequest['mode'], string> = {
        smart: 'Do intelligent enhancement with richer cinematic details, composition, and lighting.',
        style: `Rewrite with strong style intent. Preferred style preset: ${request.stylePreset || 'cinematic'}.`,
        precise: 'Preserve user intent strictly; only optimize clarity and structure.',
        translate: 'Translate and optimize prompt for model friendliness while preserving semantics.',
    };

    return [
        'You are a professional prompt engineer for image and video generation.',
        'Return ONLY valid JSON with keys: enhancedPrompt, negativePrompt, suggestions, notes.',
        'Keep enhancedPrompt concise but vivid. Do not use markdown.',
        'negativePrompt should be a comma-separated phrase list.',
        'suggestions should be short keyword phrases.',
        modeHintMap[request.mode],
    ].join('\n');
}

function safeParsePromptResult(raw: string, fallbackPrompt: string): PromptEnhanceResult {
    const clean = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```/i, '')
        .replace(/```$/i, '')
        .trim();

    try {
        const parsed = JSON.parse(clean) as Partial<PromptEnhanceResult>;
        return {
            enhancedPrompt: parsed.enhancedPrompt?.trim() || fallbackPrompt,
            negativePrompt: parsed.negativePrompt?.trim() || '',
            suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter(Boolean).slice(0, 8) : [],
            notes: parsed.notes?.trim() || '',
        };
    } catch {
        return {
            enhancedPrompt: fallbackPrompt,
            negativePrompt: '',
            suggestions: [],
            notes: raw || 'No response content returned by model.',
        };
    }
}

export function inferProviderFromModel(model: string): AIProvider {
    const normalized = normalizeModelName(model);
    if (/^(rhart-image|rhart-video|runninghub\/|runninghub-image|runninghub-video)/i.test(normalized)) return 'runningHub';
    if (/^(gemini|imagen|veo)/.test(normalized)) return 'google';
    if (/^(dall-e|gpt-image|gpt-5|gpt-4o|gpt-4\.1|o\d)/.test(normalized)) return 'openai';
    if (/^claude/i.test(model)) return 'anthropic';
    if (/^qwen/i.test(model)) return 'qwen';
    if (/^deepseek/i.test(model)) return 'deepseek';
    if (/^(siliconflow|deepseek-ai|Qwen)/i.test(model)) return 'siliconflow';
    if (/^(kling|keling)/i.test(model)) return 'keling';
    if (/^flux/i.test(model)) return 'flux';
    if (/^midjourney/i.test(model)) return 'midjourney';
    if (/^(minimax|abab|video-01)/i.test(model)) return 'minimax';
    if (/^(doubao|skylark|ep-|seedance|dreamina-seedance|doubao-seedance)/i.test(model) || normalized.includes('seedance')) return 'volcengine';
    if (/^(openrouter\/|google\/|anthropic\/|openai\/|meta-llama\/|x-ai\/)/i.test(model)) return 'openrouter';
    return 'custom';
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function uniqueUrls(values: Array<string | undefined>) {
    return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function getUnifiedApiBaseCandidates(baseUrl: string) {
    const trimmed = baseUrl.replace(/\/+$/, '');
    const direct = trimmed.replace(/\/(?:api\/)?v1$/i, '');

    try {
        const parsed = new URL(trimmed);
        const pathname = parsed.pathname.replace(/\/+$/, '');
        const pathnameWithoutVersion = pathname.replace(/\/(?:api\/)?v1$/i, '');
        const pathBase = pathnameWithoutVersion && pathnameWithoutVersion !== '/' ? `${parsed.origin}${pathnameWithoutVersion}` : parsed.origin;
        return uniqueUrls([direct, pathBase, parsed.origin]);
    } catch {
        return uniqueUrls([direct]);
    }
}

function extractTaskId(payload: any) {
    return payload?.task_id
        || payload?.data?.task_id
        || payload?.id
        || payload?.data?.id
        || payload?.task?.id
        || payload?.data?.task?.id;
}

function normalizeSeedanceModel(model: string) {
    const normalized = normalizeModelName(model);
    if (normalized === 'seedance-2.0' || normalized === 'seedance-2-0') {
        return DEFAULT_SEEDANCE_MODEL;
    }
    return model || DEFAULT_SEEDANCE_MODEL;
}

function extractSeedanceQueryTaskId(payload: any) {
    return payload?.id
        || payload?.data?.id
        || payload?.task?.id
        || payload?.data?.task?.id
        || payload?.task_id
        || payload?.data?.task_id;
}

function extractSeedanceUpstreamTaskId(payload: any) {
    return payload?.task_id
        || payload?.data?.task_id
        || payload?.metadata?.upstream_task_id
        || payload?.data?.metadata?.upstream_task_id;
}

function extractVideoStatus(payload: any) {
    const rawStatus = payload?.status
        || payload?.data?.status
        || payload?.data?.task_status
        || payload?.state
        || payload?.task?.status
        || payload?.data?.task?.status;
    const normalized = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
    if (['success', 'succeed', 'succeeded', 'completed', 'complete', 'done'].includes(normalized)) return 'succeeded';
    if (['fail', 'failed', 'error', 'cancelled', 'canceled', 'expired'].includes(normalized)) return 'failed';
    if (['queued', 'pending', 'running', 'processing', 'in_progress', 'created', 'submitted'].includes(normalized)) return 'running';
    return normalized;
}

function extractFailureReason(payload: any) {
    return payload?.fail_reason || payload?.data?.fail_reason || payload?.message || payload?.error?.message || payload?.data?.task_status_msg || payload?.status_msg;
}

function extractVideoOutputUrl(payload: any) {
    return payload?.data?.output
        || payload?.data?.outputs?.[0]
        || payload?.output
        || payload?.outputs?.[0]
        || payload?.content?.video_url
        || payload?.data?.video_url
        || payload?.data?.content?.video_url
        || payload?.video?.url
        || payload?.data?.video?.url
        || payload?.result?.video_url
        || payload?.data?.result?.video_url
        || payload?.result?.videos?.[0]?.url
        || payload?.data?.result?.videos?.[0]?.url
        || payload?.data?.task_result?.videos?.[0]?.url;
}

async function generateVideoWithUnifiedAsyncApi(
    prompt: string,
    model: string,
    key: UserApiKey,
    options?: {
        aspectRatio?: VideoAspectRatio;
        onProgress?: (message: string) => void;
        references?: VideoImage[];
    },
): Promise<{ videoBlob: Blob; mimeType: string }> {
    const apiKey = requireApiKey('custom', key);
    const normalizedBaseUrl = getBaseUrl('custom', key);
    const apiBaseCandidates = getUnifiedApiBaseCandidates(normalizedBaseUrl);
    const aspectRatio = options?.aspectRatio || '16:9';
    const onProgress = options?.onProgress || (() => {});
    let lastError: Error | null = null;

    for (const apiBase of apiBaseCandidates) {
        try {
            onProgress('Submitting video generation task...');
            const createBody: Record<string, unknown> = {
                model,
                prompt,
                aspect_ratio: aspectRatio,
            };

            const imageHrefs = (options?.references ?? [])
                .map(r => r.href)
                .filter(Boolean);
            if (imageHrefs.length) {
                createBody.images = imageHrefs;
            }

            const createRes = await fetch(`${apiBase}/v2/videos/generations`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify(createBody),
            });

            if (!createRes.ok) {
                const failure = await readErrorResponse(createRes, '统一视频接口提交失败');
                if (createRes.status === 404 || createRes.status === 405) {
                    lastError = new Error(failure);
                    continue;
                }
                throw new Error(failure);
            }

            const createJson = await readJsonResponse<any>(createRes, '统一视频接口提交响应');
            const taskId = extractTaskId(createJson);
            if (!taskId) {
                throw new Error('统一视频接口未返回 task_id');
            }

            let delay = 2000;
            const pollStart = Date.now();
            const MAX_POLL_MS = 600_000; // 10 分钟超时
            while (true) {
                if (Date.now() - pollStart > MAX_POLL_MS) {
                    throw new Error('视频生成超时（已等待超过 10 分钟）');
                }
                onProgress(delay <= 2000 ? '任务已提交，正在排队...' : '正在生成视频，请稍候...');
                const queryRes = await fetch(`${apiBase}/v2/videos/generations/${encodeURIComponent(taskId)}`, {
                    headers: { Authorization: `Bearer ${apiKey}` },
                });

                if (!queryRes.ok) {
                    throw new Error(await readErrorResponse(queryRes, '统一视频接口查询失败'));
                }

                const queryJson = await readJsonResponse<any>(queryRes, '统一视频接口查询响应');
                const status = extractVideoStatus(queryJson);

                if (status === 'failed') {
                    throw new Error(`视频生成失败: ${extractFailureReason(queryJson) || 'Unknown error'}`);
                }

                if (status === 'succeeded') {
                    const outputUrl = extractVideoOutputUrl(queryJson);
                    if (!outputUrl) {
                        throw new Error('视频生成完成但未返回下载链接');
                    }

                    onProgress('Downloading generated video...');
                    const videoRes = await fetch(outputUrl);
                    if (!videoRes.ok) {
                        throw new Error(`视频下载失败: ${videoRes.statusText}`);
                    }
                    const videoBlob = await videoRes.blob();
                    const mimeType = videoRes.headers.get('Content-Type') || 'video/mp4';
                    return { videoBlob, mimeType };
                }

                await sleep(delay);
                delay = Math.min(delay * 2, 8000);
            }
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
        }
    }

    throw lastError || new Error('当前自定义端点未暴露可用的视频统一接口。');
}

function seedanceReferenceLabel(kind: MultimodalSlotKind, index: number): string {
    if (kind === 'image') return `图片${index + 1}`;
    if (kind === 'video') return `视频${index + 1}`;
    return `音频${index + 1}`;
}

function buildSeedancePromptText(prompt: string, slots: MultimodalSlot[]): string {
    const counts: Partial<Record<MultimodalSlotKind, number>> = {};
    const labels = slots.map((slot) => {
        counts[slot.kind] = counts[slot.kind] || 0;
        const label = seedanceReferenceLabel(slot.kind, counts[slot.kind]);
        counts[slot.kind] = counts[slot.kind] + 1;
        const alias = normalizeMentionLabel(slot.label);
        return alias ? `${label}=${alias}` : label;
    });
    const text = prompt.trim();
    if (!labels.length) return text;
    return `参考素材编号：${labels.join('、')}。请按这些编号理解提示词中的图片、视频和音频引用，角色和主体不要混淆。\n\n${text}`;
}

function buildSeedanceContentItems(prompt: string, slots: MultimodalSlot[], capability: CapabilityDictionary): Array<Record<string, unknown>> {
    const filteredSlots = filterMultimodalSlots(slots, capability);
    const text = buildSeedancePromptText(prompt, filteredSlots);
    const contentItems: Array<Record<string, unknown>> = text ? [{ type: 'text', text }] : [];
    for (const slot of filteredSlots) {
        const role = normalizeMultimodalRole(slot);
        if (slot.kind === 'image') {
            contentItems.push({
                type: 'image_url',
                image_url: { url: slot.href },
                role,
            });
        } else if (slot.kind === 'video') {
            contentItems.push({
                type: 'video_url',
                video_url: { url: slot.href },
                role,
            });
        } else if (slot.kind === 'audio') {
            contentItems.push({
                type: 'audio_url',
                audio_url: { url: slot.href },
                role,
            });
        }
    }
    return contentItems;
}

/** 返回模型支持的能力标签（emoji 形式） */
export function getModelCapabilityTags(model: string): string {
    const provider = inferProviderFromModel(model);
    const caps = DEFAULT_PROVIDER_MODELS[provider];
    if (!caps) return '';
    const tags: string[] = [];
    if (caps.text?.includes(model)) tags.push('💬');
    if (caps.image?.includes(model)) tags.push('🖼️');
    if (caps.video?.includes(model)) tags.push('🎬');
    return tags.join('');
}

async function enhancePromptWithOpenAICompatible(
    request: PromptEnhanceRequest,
    model: string,
    provider: AIProvider,
    key?: UserApiKey
): Promise<PromptEnhanceResult> {
    const apiKey = requireApiKey(provider, key);
    const baseUrl = getBaseUrl(provider, key);
    const headers: Record<string, string> = provider === 'openrouter'
        ? buildOpenRouterHeaders(apiKey)
        : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        };
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model,
            temperature: 0.6,
            messages: [
                { role: 'system', content: inferPromptModeHint(request) },
                { role: 'user', content: request.prompt },
            ],
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${provider} LLM 请求失败 (${response.status}): ${text || response.statusText}`);
    }

    const json = await response.json();
    const raw = json?.choices?.[0]?.message?.content || '';
    return safeParsePromptResult(raw, request.prompt);
}

async function enhancePromptWithAnthropic(
    request: PromptEnhanceRequest,
    model: string,
    key?: UserApiKey
): Promise<PromptEnhanceResult> {
    const apiKey = requireApiKey('anthropic', key);
    const baseUrl = getBaseUrl('anthropic', key);
    const response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model,
            max_tokens: 1024,
            system: inferPromptModeHint(request),
            messages: [{ role: 'user', content: request.prompt }],
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Anthropic 请求失败 (${response.status}): ${text || response.statusText}`);
    }

    const json = await response.json();
    const raw = Array.isArray(json?.content)
        ? json.content.map((item: { text?: string }) => item.text || '').join('\n')
        : '';
    return safeParsePromptResult(raw, request.prompt);
}

/**
 * 【函数】统一的提示词润色入口
 *
 * 根据模型名称自动推断 provider，路由到对应的润色实现。
 * 所有 provider 都通过 key 参数即时传入 API Key，避免依赖全局状态。
 *
 * @param request  - 润色请求（原始提示词 + 模式）
 * @param model    - 模型名称（用于推断 provider）
 * @param key      - 用户配置的 API Key（可选，从 App.tsx state 传入）
 */
export async function enhancePromptWithProvider(
    request: PromptEnhanceRequest,
    model: string,
    key?: UserApiKey
): Promise<PromptEnhanceResult> {
    const provider = resolveGenerationProvider(model, key);

    if (provider === 'google') {
        // 传入 key?.key 确保使用用户配置的 API Key，而非仅依赖全局 runtimeConfig
        return enhancePromptWithGemini(request, key?.key);
    }

    if (provider === 'anthropic') {
        return enhancePromptWithAnthropic(request, model, key);
    }

    return enhancePromptWithOpenAICompatible(request, model, provider, key);
}

/**
 * 构建反推 Prompt 的系统指令。
 * 根据 UI 语言 + 图片元数据动态生成，确保输出跟随用户语言偏好。
 * 风格统一为 AI 图像生成器可直接使用的自然语言描述。
 */
function buildReversePromptInstruction(lang: 'en' | 'zho', meta?: { width?: number; height?: number }): string {
    const metaHint = meta?.width && meta?.height
        ? (lang === 'zho'
            ? `\n图片尺寸 ${meta.width}×${meta.height}，宽高比约 ${(meta.width / meta.height).toFixed(2)}。请将宽高比信息融入描述。`
            : `\nImage dimensions ${meta.width}×${meta.height}, aspect ratio ~${(meta.width / meta.height).toFixed(2)}. Incorporate aspect ratio context.`)
        : '';
    if (lang === 'zho') {
        return [
            '你是一名顶级 AI 图像提示词工程师。',
            '分析给定图片，生成一段可用于 AI 图像生成器直接重现该图的详细提示词。',
            '包含：主体、构图、拍摄角度、光线、色彩、情绪、艺术风格、媒介及精细细节。',
            '如果画面中有明显应避免的元素（如水印、模糊、畸变），在末尾用「负面提示：」列出。',
            '仅输出提示词文本，使用中文，不加解释、不加 markdown、不加前缀。',
            metaHint,
        ].filter(Boolean).join('\n');
    }
    return [
        'You are an expert AI image prompt engineer.',
        'Analyze the given image and generate a detailed prompt that could recreate it with an AI image generator.',
        'Include: subject, composition, camera angle, lighting, color palette, mood, artistic style, medium, and fine details.',
        'If there are obvious elements to avoid (e.g. watermarks, blur, distortion), append them at the end after "Negative prompt:".',
        'Output ONLY the prompt text. No explanations, no markdown, no prefix.',
        metaHint,
    ].filter(Boolean).join('\n');
}

/**
 * 【函数】图片反推提示词（Reverse Prompt / Describe Image）— 非流式版本
 *
 * 根据用户配置的 text model 路由到支持 vision 的 LLM，传入图片并返回描述提示词。
 * 当前支持：google、openai（及兼容接口）、anthropic、openrouter。
 */
export async function reversePromptWithProvider(
    imageHref: string,
    mimeType: string,
    model: string,
    key?: UserApiKey,
    lang: 'en' | 'zho' = 'en',
    meta?: { width?: number; height?: number },
): Promise<string> {
    const instruction = buildReversePromptInstruction(lang, meta);
    const provider = resolveGenerationProvider(model, key);

    if (provider === 'google') {
        const apiKey = requireApiKey(provider, key);
        const effectiveModel = model || 'gemini-2.5-flash';
        const base64Data = imageHref.includes(',') ? imageHref.split(',')[1] : imageHref;
        const googleBase = key?.baseUrl ? normalizeProviderBaseUrl('google', key.baseUrl) : getGeminiRestBaseUrl();
        const url = `${googleBase}/models/${encodeURIComponent(effectiveModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: instruction },
                        { inlineData: { mimeType, data: base64Data } },
                    ],
                }],
            }),
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Google Vision 请求失败 (${response.status}): ${text || response.statusText}`);
        }
        const json = await response.json();
        return json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    }

    if (provider === 'anthropic') {
        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);
        const base64Data = imageHref.includes(',') ? imageHref.split(',')[1] : imageHref;
        const mediaType = mimeType || 'image/png';
        const response = await fetch(`${baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: model || 'claude-sonnet-4-6',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: instruction },
                        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
                    ],
                }],
            }),
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Anthropic Vision 请求失败 (${response.status}): ${text || response.statusText}`);
        }
        const json = await response.json();
        return (json?.content || []).map((b: { text?: string }) => b.text || '').join('\n').trim();
    }

    if (usesAnthropicRequestFormat(key)) {
        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);
        const base64Data = imageHref.includes(',') ? imageHref.split(',')[1] : imageHref;
        const mediaType = mimeType || 'image/png';
        const response = await fetch(`${baseUrl}/messages`, {
            method: 'POST',
            headers: buildProviderHeaders(apiKey, key, { anthropic: true }),
            body: JSON.stringify({
                model: mapProviderModel(model, key),
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: instruction },
                        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
                    ],
                }],
            }),
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Anthropic Vision 请求失败 (${response.status}): ${text || response.statusText}`);
        }
        const json = await response.json();
        return (json?.content || []).map((b: { text?: string }) => b.text || '').join('\n').trim();
    }

    // OpenAI / OpenRouter / Custom / DeepSeek / Qwen / etc. (OpenAI-compatible vision)
    const apiKey = requireApiKey(provider, key);
    const baseUrl = getBaseUrl(provider, key);
    const headers: Record<string, string> = provider === 'openrouter'
        ? buildOpenRouterHeaders(apiKey)
        : buildProviderHeaders(apiKey, key);

    const imageContent = imageHref.startsWith('data:')
        ? { type: 'image_url' as const, image_url: { url: imageHref } }
        : { type: 'image_url' as const, image_url: { url: imageHref } };

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: mapProviderModel(model || 'gpt-5.4-mini', key),
            max_tokens: 1024,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: instruction },
                    imageContent,
                ],
            }],
        }),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${PROVIDER_LABELS[provider] || provider} Vision 请求失败 (${response.status}): ${text || response.statusText}`);
    }
    const json = await response.json();
    return json?.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * 【函数】图片反推提示词 — 流式版本 (SSE Streaming)
 *
 * 逐 token 回传文本到 onChunk 回调，配合 AbortSignal 支持随时取消。
 * Google 使用 streamGenerateContent，OpenAI/Anthropic 使用 SSE stream。
 * 返回完整文本（所有 chunk 拼接）。
 */
export async function reversePromptStreamWithProvider(
    imageHref: string,
    mimeType: string,
    model: string,
    key: UserApiKey | undefined,
    onChunk: (text: string) => void,
    signal?: AbortSignal,
    lang: 'en' | 'zho' = 'en',
    meta?: { width?: number; height?: number },
): Promise<string> {
    const instruction = buildReversePromptInstruction(lang, meta);
    const provider = resolveGenerationProvider(model, key);
    let full = '';

    if (provider === 'google') {
        const apiKey = requireApiKey(provider, key);
        const effectiveModel = model || 'gemini-2.5-flash';
        const base64Data = imageHref.includes(',') ? imageHref.split(',')[1] : imageHref;
        const googleBase = key?.baseUrl ? normalizeProviderBaseUrl('google', key.baseUrl) : getGeminiRestBaseUrl();
        const url = `${googleBase}/models/${encodeURIComponent(effectiveModel)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: instruction },
                        { inlineData: { mimeType, data: base64Data } },
                    ],
                }],
            }),
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Google Vision 请求失败 (${response.status}): ${text || response.statusText}`);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('无法获取响应流');
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const payload = line.slice(6).trim();
                if (payload === '[DONE]') continue;
                try {
                    const json = JSON.parse(payload);
                    const chunk = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    if (chunk) { full += chunk; onChunk(chunk); }
                } catch { /* skip malformed JSON */ }
            }
        }
        return full.trim();
    }

    if (provider === 'anthropic') {
        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);
        const base64Data = imageHref.includes(',') ? imageHref.split(',')[1] : imageHref;
        const mediaType = mimeType || 'image/png';
        const response = await fetch(`${baseUrl}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            signal,
            body: JSON.stringify({
                model: model || 'claude-sonnet-4-6',
                max_tokens: 1024,
                stream: true,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: instruction },
                        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
                    ],
                }],
            }),
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Anthropic Vision 请求失败 (${response.status}): ${text || response.statusText}`);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('无法获取响应流');
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const payload = line.slice(6).trim();
                if (payload === '[DONE]') continue;
                try {
                    const json = JSON.parse(payload);
                    if (json.type === 'content_block_delta') {
                        const chunk = json.delta?.text || '';
                        if (chunk) { full += chunk; onChunk(chunk); }
                    }
                } catch { /* skip malformed JSON */ }
            }
        }
        return full.trim();
    }

    // OpenAI / OpenRouter / Custom / DeepSeek / Qwen / etc. (OpenAI-compatible SSE)
    const apiKey = requireApiKey(provider, key);
    const baseUrl = getBaseUrl(provider, key);
    const headers: Record<string, string> = provider === 'openrouter'
        ? buildOpenRouterHeaders(apiKey)
        : buildProviderHeaders(apiKey, key);

    const imageContent = imageHref.startsWith('data:')
        ? { type: 'image_url' as const, image_url: { url: imageHref } }
        : { type: 'image_url' as const, image_url: { url: imageHref } };

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
            model: mapProviderModel(model || 'gpt-5.4-mini', key),
            max_tokens: 1024,
            stream: true,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: instruction },
                    imageContent,
                ],
            }],
        }),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${PROVIDER_LABELS[provider] || provider} Vision 请求失败 (${response.status}): ${text || response.statusText}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法获取响应流');
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') continue;
            try {
                const json = JSON.parse(payload);
                const chunk = json.choices?.[0]?.delta?.content || '';
                if (chunk) { full += chunk; onChunk(chunk); }
            } catch { /* skip malformed JSON */ }
        }
    }
    return full.trim();
}

/**
 * 【函数】统一的图片生成入口
 *
 * 根据模型名称路由到 Google Imagen / OpenAI DALL-E 等。
 * 当前支持：google、openai、custom。
 *
 * @param prompt - 图片描述提示词
 * @param model  - 模型名称
 * @param key    - 用户 API Key
 */
export async function generateImageWithProvider(
    prompt: string,
    model: string,
    key?: UserApiKey,
    images?: VideoImage[],
    options?: { signal?: AbortSignal },
): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null }> {
    const provider = resolveGenerationProvider(model, key);
    const refs = limitProviderImageInputs(images ?? [], provider, model, key);

    if (provider === 'google') {
        if (refs.length > 0) {
            if (!supportsReferenceImageEditing(model)) {
                return generateImageFromText(prompt, key?.key, options?.signal);
            }
            return editImage(refs, prompt, undefined, key?.key, options?.signal);
        }
        return generateImageFromText(prompt, key?.key, options?.signal);
    }

    if (provider === 'runningHub') {
        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);
        const modelEndpoint = assertRunningHubModelEndpoint(mapProviderModel(model, key) || key?.defaultModel || model);
        const runningHubRefs = await prepareRunningHubReferences(apiKey, refs, {
            baseUrl,
            signal: options?.signal,
        });
        const { rhRunTask } = await import('./runningHubService');
        const result = await rhRunTask(apiKey, modelEndpoint, buildRunningHubStandardPayload(prompt, modelEndpoint, key, {
            references: runningHubRefs,
        }), {
            baseUrl,
            signal: options?.signal,
        });
        const imageUrl = extractRunningHubMediaUrl(result, 'image');
        if (!imageUrl) {
            return {
                newImageBase64: null,
                newImageMimeType: null,
                textResponse: result.results?.map(item => item.text).filter(Boolean).join('\n') || 'RunningHub 未返回图片 URL。',
            };
        }
        return fetchImageUrlToBase64(imageUrl);
    }

    if (provider === 'openrouter') {
        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);
        const content: any[] = [{ type: 'text', text: prompt }];
        for (const image of refs) {
            content.push({ type: 'image_url', image_url: { url: image.href } });
        }
        const response = await fetch(`${baseUrl}/chat/completions`, {
            signal: options?.signal,
            method: 'POST',
            headers: buildOpenRouterHeaders(apiKey),
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content }],
                modalities: ['image', 'text'],
                stream: false,
            }),
        });

        if (!response.ok) {
            throw new Error(await readErrorResponse(response, 'OpenRouter 图片生成失败'));
        }

        const json = await readJsonResponse<any>(response, 'OpenRouter 图片生成响应');
        const imageUrl = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (!imageUrl) {
            return {
                newImageBase64: null,
                newImageMimeType: null,
                textResponse: json?.choices?.[0]?.message?.content || 'OpenRouter 未返回图片结果。',
            };
        }

        return decodeDataUrlImage(imageUrl);
    }

    if (provider === 'openai' || provider === 'custom' || provider === 'openai_compatible') {
        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);
        const mappedModel = mapProviderModel(model, key);
        const capability = getCapabilityDictionary(mappedModel, provider);
        const officialGptImage = provider === 'openai' && isOpenAIImageEditModel(mappedModel);

        // With reference images: use /images/edits (multipart) or chat/completions fallback
        if (refs.length > 0) {
            const formData = new FormData();
            formData.append('model', mappedModel);
            formData.append('prompt', prompt);
            if (!officialGptImage) {
                formData.append('response_format', provider === 'custom' ? 'url' : 'b64_json');
            }
            appendOpenAIImageFormParams(formData, buildOpenAIImageRequestParams(capability, {
                size: '1024x1024',
                quality: key?.extraConfig?.imageQuality,
                background: key?.extraConfig?.imageBackground,
                moderation: key?.extraConfig?.moderation,
                output_format: key?.extraConfig?.outputFormat,
                output_compression: key?.extraConfig?.outputCompression ? Number(key.extraConfig.outputCompression) : undefined,
            }));

            refs.forEach((image, index) => {
                const parsed = parseDataUrl(image.href, image.mimeType);
                formData.append(
                    'image',
                    createBlobFromBase64(parsed.base64, image.mimeType),
                    `reference-${index}.${image.mimeType.split('/')[1] || 'png'}`,
                );
            });

            try {
                const editsRes = await fetch(`${baseUrl}/images/edits`, {
                    signal: options?.signal,
                    method: 'POST',
                    headers: buildProviderHeaders(apiKey, key, { contentType: false }),
                    body: formData,
                });
                if (editsRes.ok) {
                    const json = await readJsonResponse<any>(editsRes, `${PROVIDER_LABELS[provider]} 图片编辑响应`);
                    const parsed = await parseOpenAIImageResponse(json);
                    if (parsed.newImageBase64) return parsed;
                }
                if (provider !== 'custom') {
                    throw new Error(await readErrorResponse(editsRes, `${PROVIDER_LABELS[provider]} 图片生成失败`));
                }
            } catch (err) {
                if (options?.signal?.aborted) throw err;
                if (provider !== 'custom') throw err;
            }

            // Custom fallback: chat/completions with images
            if (provider === 'custom') {
                const chatContent: any[] = [{ type: 'text', text: prompt }];
                for (const image of refs) {
                    chatContent.push({ type: 'image_url', image_url: { url: image.href } });
                }
                const chatResponse = await fetch(`${baseUrl}/chat/completions`, {
                    signal: options?.signal,
                    method: 'POST',
                    headers: buildProviderHeaders(apiKey, key),
                    body: JSON.stringify({
                        model: mappedModel,
                        messages: [{ role: 'user', content: chatContent }],
                        stream: false,
                    }),
                });
                if (!chatResponse.ok) {
                    throw new Error(await readErrorResponse(chatResponse, `${PROVIDER_LABELS[provider]} 图片生成失败`));
                }
                const chatJson = await readJsonResponse<any>(chatResponse, `${PROVIDER_LABELS[provider]} 图片生成响应`);
                return parseOpenAIImageResponse(chatJson);
            }

            return { newImageBase64: null, newImageMimeType: null, textResponse: null };
        }

        // Text-only: try /images/generations first
        const preferredFormat = provider === 'custom' ? 'url' : 'b64_json';
        const imageParams = buildOpenAIImageRequestParams(capability, {
            size: '1024x1024',
            quality: key?.extraConfig?.imageQuality,
            background: key?.extraConfig?.imageBackground,
            moderation: key?.extraConfig?.moderation,
            output_format: key?.extraConfig?.outputFormat,
            output_compression: key?.extraConfig?.outputCompression ? Number(key.extraConfig.outputCompression) : undefined,
        });
        try {
            const response = await fetch(`${baseUrl}/images/generations`, {
                signal: options?.signal,
                method: 'POST',
                headers: buildProviderHeaders(apiKey, key),
                body: JSON.stringify({
                    model: mappedModel,
                    prompt,
                    ...imageParams,
                    ...(!officialGptImage ? { response_format: preferredFormat } : {}),
                }),
            });

            if (response.ok) {
                const json = await readJsonResponse<any>(response, `${PROVIDER_LABELS[provider]} 图片生成响应`);
                const parsed = await parseOpenAIImageResponse(json);
                if (parsed.newImageBase64) return parsed;
            }

            if (provider !== 'custom') {
                throw new Error(await readErrorResponse(response, `${PROVIDER_LABELS[provider]} 图片生成失败`));
            }
        } catch (err) {
            if (options?.signal?.aborted) throw err;
            if (provider !== 'custom') throw err;
        }

        // Custom fallback: chat/completions text-only
        if (provider === 'custom') {
            const chatResponse = await fetch(`${baseUrl}/chat/completions`, {
                signal: options?.signal,
                method: 'POST',
                headers: buildProviderHeaders(apiKey, key),
                body: JSON.stringify({
                    model: mappedModel,
                    messages: [{ role: 'user', content: prompt }],
                    stream: false,
                }),
            });

            if (!chatResponse.ok) {
                throw new Error(await readErrorResponse(chatResponse, `${PROVIDER_LABELS[provider]} 图片生成失败`));
            }

            const chatJson = await readJsonResponse<any>(chatResponse, `${PROVIDER_LABELS[provider]} 图片生成响应`);
            return parseOpenAIImageResponse(chatJson);
        }

        return { newImageBase64: null, newImageMimeType: null, textResponse: null };
    }

    // Generic chat/completions path for all other providers (anthropic, qwen, deepseek, siliconflow, volcengine, etc.)
    const apiKey = requireApiKey(provider, key);
    const baseUrl = getBaseUrl(provider, key);
    const mappedModel = mapProviderModel(model, key);
    const content: any[] = [{ type: 'text', text: prompt }];
    for (const image of refs) {
        content.push({ type: 'image_url', image_url: { url: image.href } });
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
        signal: options?.signal,
        method: 'POST',
        headers: buildProviderHeaders(apiKey, key),
        body: JSON.stringify({
            model: mappedModel,
            messages: [{ role: 'user', content }],
            stream: false,
        }),
    });

    if (!response.ok) {
        throw new Error(await readErrorResponse(response, `${PROVIDER_LABELS[provider] || provider} 图片生成失败`));
    }

    const json = await readJsonResponse<any>(response, `${PROVIDER_LABELS[provider] || provider} 图片生成响应`);
    return parseOpenAIImageResponse(json);
}

export async function editImageWithProvider(
    images: ImageInput[],
    prompt: string,
    model: string,
    key?: UserApiKey,
    options?: { mask?: ImageInput }
): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null }> {
    const provider = resolveGenerationProvider(model, key);
    const inputImages = limitProviderImageInputs(images, provider, model, key);

    if (provider === 'google') {
        if (!supportsReferenceImageEditing(model)) {
            throw new Error('当前 Google 图片模型只支持纯文本生图，请切换到 Gemini 图像编辑模型。');
        }
        return editImage(inputImages, prompt, options?.mask, key?.key);
    }

    if (provider === 'openrouter') {
        if (options?.mask) {
            throw new Error('OpenRouter 当前不支持遮罩局部重绘。请切换到 Google Gemini 或 OpenAI GPT Image 模型。');
        }

        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);
        const content = [
            { type: 'text', text: prompt },
            ...inputImages.map((image) => ({
                type: 'image_url',
                image_url: { url: image.href },
            })),
        ];

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: buildOpenRouterHeaders(apiKey),
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content }],
                modalities: ['image', 'text'],
                stream: false,
            }),
        });

        if (!response.ok) {
            throw new Error(await readErrorResponse(response, 'OpenRouter 参考图生成失败'));
        }

        const json = await readJsonResponse<any>(response, 'OpenRouter 参考图生成响应');
        const imageUrl = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (!imageUrl) {
            return {
                newImageBase64: null,
                newImageMimeType: null,
                textResponse: json?.choices?.[0]?.message?.content || 'OpenRouter 未返回图片结果。',
            };
        }

        return decodeDataUrlImage(imageUrl);
    }

    if (provider === 'openai' || provider === 'custom' || provider === 'openai_compatible') {
        // custom/openai_compatible provider 跳过模型名检测——聚合端点的模型名不一定匹配 OpenAI 命名规则
        if (provider === 'openai') {
            if (!supportsReferenceImageEditing(model)) {
                throw new Error('当前 OpenAI 图片模型不支持参考图编辑。请切换到 GPT Image 模型。');
            }
            if (options?.mask && !supportsMaskImageEditing(model)) {
                throw new Error('当前模型不支持遮罩局部重绘。请切换到支持编辑的 GPT Image 或 Gemini 模型。');
            }
        }

        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);
        const mappedModel = mapProviderModel(model, key);
        const capability = getCapabilityDictionary(mappedModel, provider);
        const officialGptImage = provider === 'openai' && isOpenAIImageEditModel(mappedModel);
        const formData = new FormData();
        formData.append('model', mappedModel);
        formData.append('prompt', prompt);
        if (!officialGptImage) {
            formData.append('response_format', provider === 'custom' || provider === 'openai_compatible' ? 'url' : 'b64_json');
        }
        appendOpenAIImageFormParams(formData, buildOpenAIImageRequestParams(capability, {
            size: '1024x1024',
            quality: key?.extraConfig?.imageQuality,
            background: key?.extraConfig?.imageBackground,
            moderation: key?.extraConfig?.moderation,
            output_format: key?.extraConfig?.outputFormat,
            output_compression: key?.extraConfig?.outputCompression ? Number(key.extraConfig.outputCompression) : undefined,
        }));

        inputImages.forEach((image, index) => {
            const parsed = parseDataUrl(image.href, image.mimeType);
            formData.append(
                'image',
                createBlobFromBase64(parsed.base64, image.mimeType),
                `reference-${index}.${image.mimeType.split('/')[1] || 'png'}`,
            );
        });

        if (options?.mask) {
            const parsedMask = parseDataUrl(options.mask.href, options.mask.mimeType);
            formData.append(
                'mask',
                createBlobFromBase64(parsedMask.base64, options.mask.mimeType),
                `mask.${options.mask.mimeType.split('/')[1] || 'png'}`,
            );
        }

        // 尝试 /images/edits 标准端点
        try {
            const response = await fetch(`${baseUrl}/images/edits`, {
                method: 'POST',
                headers: buildProviderHeaders(apiKey, key, { contentType: false }),
                body: formData,
            });

            if (response.ok) {
                const json = await readJsonResponse<any>(response, `${PROVIDER_LABELS[provider]} 图片编辑响应`);
                const parsed = await parseOpenAIImageResponse(json);
                if (parsed.newImageBase64) return parsed;
            }

            if (provider !== 'custom' && provider !== 'openai_compatible') {
                throw new Error(await readErrorResponse(response, `${PROVIDER_LABELS[provider]} 图片编辑失败`));
            }
        } catch (err) {
            if (provider !== 'custom' && provider !== 'openai_compatible') throw err;
        }

        // Custom fallback: 通过 chat/completions 进行图片编辑
        if (provider === 'custom' || provider === 'openai_compatible') {
            const content: any[] = [{ type: 'text', text: prompt }];
            for (const image of images) {
                content.push({ type: 'image_url', image_url: { url: image.href } });
            }
            if (options?.mask) {
                content.push({ type: 'image_url', image_url: { url: options.mask.href } });
            }

            const chatResponse = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: buildProviderHeaders(apiKey, key),
                body: JSON.stringify({
                    model: mappedModel,
                    messages: [{ role: 'user', content }],
                    stream: false,
                }),
            });

            if (!chatResponse.ok) {
                throw new Error(await readErrorResponse(chatResponse, `${PROVIDER_LABELS[provider]} 图片编辑失败`));
            }

            const chatJson = await readJsonResponse<any>(chatResponse, `${PROVIDER_LABELS[provider]} 图片编辑响应`);
            return parseOpenAIImageResponse(chatJson);
        }

        return {
            newImageBase64: null,
            newImageMimeType: null,
            textResponse: '图片编辑请求成功，但未返回图片结果。',
        };
    }

    throw new Error(`当前模型 ${model} 暂不支持参考图编辑。`);
}

export interface SeedanceVideoTaskHandle {
    providerId: 'volcengine';
    modelId: string;
    taskId: string;
    baseUrl: string;
    createdAt: number;
    metadata?: Record<string, unknown>;
}

export type SeedanceVideoPollResult =
    | { status: 'running'; remoteStatus?: string; raw?: unknown }
    | { status: 'succeeded'; videoUrl: string; raw?: unknown }
    | { status: 'failed'; error: string; remoteStatus?: string; raw?: unknown };

export async function submitSeedanceVideoTask(
    prompt: string,
    model: string,
    key?: UserApiKey,
    options?: {
        aspectRatio?: VideoAspectRatio;
        slots?: MultimodalSlot[];
        references?: VideoImage[];
        durationSec?: number;
        resolution?: string;
        frames?: number;
        seed?: number;
        cameraFixed?: boolean;
        watermark?: boolean;
        returnLastFrame?: boolean;
        generateAudio?: boolean;
        serviceTier?: string;
        safetyIdentifier?: string;
    },
): Promise<SeedanceVideoTaskHandle> {
    const apiKey = requireApiKey('volcengine', key);
    const baseUrl = getBaseUrl('volcengine', key);
    const mappedModel = normalizeSeedanceModel(mapProviderModel(model || DEFAULT_SEEDANCE_MODEL, key));
    const capability = getCapabilityDictionary(mappedModel, 'volcengine');
    const slots = options?.slots?.length ? options.slots : multimodalSlotsFromLegacyReferences(options?.references ?? []);
    validateSeedanceSlots(slots, capability);
    const resolvedSlots = await resolveSeedanceSlotUrls(slots);

    const createBody: Record<string, unknown> = {
        model: mappedModel,
        content: buildSeedanceContentItems(prompt, resolvedSlots, capability),
        ...withSupportedParams(capability, {
            ratio: normalizeSeedanceRatio(options?.aspectRatio || '16:9'),
            duration: normalizeSeedanceDuration(options?.durationSec),
            resolution: normalizeSeedanceResolution(options?.resolution, mappedModel),
            frames: options?.frames,
            seed: options?.seed,
            camera_fixed: options?.cameraFixed,
            watermark: options?.watermark,
            return_last_frame: options?.returnLastFrame,
            generate_audio: options?.generateAudio,
            service_tier: options?.serviceTier,
            safety_identifier: options?.safetyIdentifier,
        }),
    };

    const createRes = await fetch(`${baseUrl}/contents/generations/tasks`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(createBody),
    });
    if (!createRes.ok) {
        throw new Error(await readErrorResponse(createRes, 'Seedance 视频生成请求失败'));
    }
    const createJson = await readJsonResponse<any>(createRes, 'Seedance 视频生成创建响应');
    const taskId = extractSeedanceQueryTaskId(createJson);
    const upstreamTaskId = extractSeedanceUpstreamTaskId(createJson);
    if (!taskId) throw new Error('Seedance 视频生成未返回任务 id');

    return {
        providerId: 'volcengine',
        modelId: mappedModel,
        taskId: String(taskId),
        baseUrl,
        createdAt: Date.now(),
        metadata: {
            rawSubmission: createJson,
            upstreamTaskId: upstreamTaskId ? String(upstreamTaskId) : undefined,
        },
    };
}

export async function pollSeedanceVideoTask(
    handle: SeedanceVideoTaskHandle,
    key?: UserApiKey,
): Promise<SeedanceVideoPollResult> {
    const apiKey = requireApiKey('volcengine', key);
    const baseUrl = handle.baseUrl || getBaseUrl('volcengine', key);
    const queryRes = await fetch(`${baseUrl}/contents/generations/tasks/${encodeURIComponent(handle.taskId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!queryRes.ok) {
        throw new Error(await readErrorResponse(queryRes, 'Seedance 任务查询失败'));
    }
    const queryJson = await readJsonResponse<any>(queryRes, 'Seedance 任务查询响应');
    const status = extractVideoStatus(queryJson);

    if (status === 'failed') {
        return {
            status: 'failed',
            error: extractFailureReason(queryJson) || 'Unknown error',
            remoteStatus: status,
            raw: queryJson,
        };
    }

    if (status === 'succeeded') {
        const videoUrl = extractVideoOutputUrl(queryJson);
        if (!videoUrl) {
            return {
                status: 'failed',
                error: 'Seedance 视频生成完成但未返回下载链接',
                remoteStatus: status,
                raw: queryJson,
            };
        }
        return { status: 'succeeded', videoUrl, raw: queryJson };
    }

    return { status: 'running', remoteStatus: status || undefined, raw: queryJson };
}

export async function downloadSeedanceVideoResult(videoUrl: string): Promise<{ videoBlob: Blob; mimeType: string }> {
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`视频下载失败: ${response.statusText}`);
    return {
        videoBlob: await response.blob(),
        mimeType: response.headers.get('Content-Type') || 'video/mp4',
    };
}

/**
 * 【函数】统一的视频生成入口
 *
 * 根据模型名称路由到 Google Veo / MiniMax video-01 等。
 * 当前支持：google、minimax、custom（OpenAI-compatible /videos）。
 *
 * @param prompt  - 视频描述提示词
 * @param model   - 模型名称（如 veo-3.1-generate-preview, video-01）
 * @param key     - 用户 API Key
 * @param options - 可选参数：aspectRatio、onProgress、image（首帧图）
 */
export async function generateVideoWithProvider(
    prompt: string,
    model: string,
    key?: UserApiKey,
    options?: {
        aspectRatio?: VideoAspectRatio;
        onProgress?: (message: string) => void;
        references?: VideoImage[];
        slots?: MultimodalSlot[];
        durationSec?: number;
        resolution?: string;
        frames?: number;
        seed?: number;
        cameraFixed?: boolean;
        watermark?: boolean;
        returnLastFrame?: boolean;
        generateAudio?: boolean;
        serviceTier?: string;
        safetyIdentifier?: string;
        signal?: AbortSignal;
    },
): Promise<{ videoBlob: Blob; mimeType: string }> {
    const provider = resolveGenerationProvider(model, key);
    const onProgress = options?.onProgress || (() => {});
    const aspectRatio = options?.aspectRatio || '16:9';
    const references = options?.references ?? [];
    const hasExplicitSlots = !!options?.slots?.length;
    const multimodalSlots = hasExplicitSlots ? options.slots! : multimodalSlotsFromLegacyReferences(references);
    const firstImageSlot = multimodalSlots.find(slot => slot.kind === 'image' && slot.role === 'first_frame')
        || multimodalSlots.find(slot => slot.kind === 'image');
    const firstFrame = references.find(r => r.slotRole === 'first_frame')
        || references[0]
        || (firstImageSlot ? { href: firstImageSlot.href, mimeType: firstImageSlot.mimeType, slotRole: String(firstImageSlot.role || 'unassigned') } : undefined);

    if (provider === 'runningHub') {
        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);
        const modelEndpoint = assertRunningHubModelEndpoint(mapProviderModel(model, key) || key?.defaultModel || model);
        const allImageRefs = hasExplicitSlots
            ? [
                ...references,
                ...multimodalSlots
                    .filter(slot => slot.kind === 'image')
                    .map(slot => ({ href: slot.href, mimeType: slot.mimeType, slotRole: String(slot.role || 'unassigned') })),
            ]
            : references;
        const uploadOptions = { baseUrl, signal: options?.signal };
        const runningHubRefs = await prepareRunningHubReferences(apiKey, allImageRefs, uploadOptions);
        const runningHubSlots = await prepareRunningHubSlots(apiKey, hasExplicitSlots ? multimodalSlots : [], uploadOptions);
        const { rhRunTask } = await import('./runningHubService');
        onProgress('Submitting RunningHub video task...');
        const result = await rhRunTask(apiKey, modelEndpoint, buildRunningHubStandardPayload(prompt, modelEndpoint, key, {
            aspectRatio,
            durationSec: options?.durationSec,
            resolution: options?.resolution,
            references: runningHubRefs,
            slots: runningHubSlots,
        }), {
            baseUrl,
            signal: options?.signal,
            onProgress: (status, attempt) => onProgress(`RunningHub ${status} (${attempt})`),
        });
        const videoUrl = extractRunningHubMediaUrl(result, 'video');
        if (!videoUrl) {
            throw new Error(result.results?.map(item => item.text).filter(Boolean).join('\n') || 'RunningHub 视频任务完成但未返回视频 URL。');
        }
        onProgress('Downloading generated video...');
        return downloadSeedanceVideoResult(videoUrl);
    }

    if (provider === 'google') {
        return generateVideo(prompt, aspectRatio, onProgress, firstFrame, key?.key);
    }

    if (provider === 'minimax') {
        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);

        // Step 1: Submit video generation task
        onProgress('Submitting video generation task...');
        const createBody: Record<string, unknown> = { model, prompt };
        if (firstFrame) {
            createBody.first_frame_image = firstFrame.href;
        }

        const createRes = await fetch(`${baseUrl}/video_generation`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(createBody),
        });

        if (!createRes.ok) {
            throw new Error(await readErrorResponse(createRes, 'MiniMax 视频生成请求失败'));
        }

        const createJson = await readJsonResponse<any>(createRes, 'MiniMax 视频生成创建响应');
        const taskId = createJson?.task_id;
        if (!taskId) {
            throw new Error('MiniMax 视频生成未返回 task_id');
        }

        // Step 2: Poll for completion
        const progressMessages = ['Rendering frames...', 'Compositing video...', 'Applying final touches...', 'Almost there...'];
        let messageIndex = 0;
        onProgress('Generation started, this may take a few minutes.');

        let fileId: string | undefined;
        const miniMaxPollStart = Date.now();
        while (true) {
            if (Date.now() - miniMaxPollStart > 600_000) {
                throw new Error('MiniMax 视频生成超时（已等待超过 10 分钟）');
            }
            onProgress(progressMessages[messageIndex % progressMessages.length]);
            messageIndex++;
            await new Promise(resolve => setTimeout(resolve, 10000));

            const queryRes = await fetch(`${baseUrl}/query/video_generation?task_id=${encodeURIComponent(taskId)}`, {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (!queryRes.ok) {
                throw new Error(await readErrorResponse(queryRes, 'MiniMax 任务查询失败'));
            }
            const queryJson = await readJsonResponse<any>(queryRes, 'MiniMax 任务查询响应');
            const status = queryJson?.status;

            if (status === 'Fail' || status === 'fail') {
                throw new Error(`MiniMax 视频生成失败: ${queryJson?.status_msg || 'Unknown error'}`);
            }
            if (status === 'Success' || status === 'success') {
                fileId = queryJson?.file_id;
                break;
            }
            // Otherwise still processing, continue polling
        }

        if (!fileId) {
            throw new Error('MiniMax 视频生成完成但未返回 file_id');
        }

        // Step 3: Download via file retrieve endpoint
        onProgress('Downloading generated video...');
        const fileRes = await fetch(`${baseUrl}/files/retrieve?file_id=${encodeURIComponent(fileId)}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!fileRes.ok) {
            throw new Error(await readErrorResponse(fileRes, 'MiniMax 文件下载失败'));
        }
        const fileJson = await readJsonResponse<any>(fileRes, 'MiniMax 文件下载响应');
        const downloadUrl = fileJson?.file?.download_url;
        if (!downloadUrl) {
            throw new Error('MiniMax 未返回视频下载链接');
        }

        const videoRes = await fetch(downloadUrl);
        if (!videoRes.ok) {
            throw new Error(`视频下载失败: ${videoRes.statusText}`);
        }
        const videoBlob = await videoRes.blob();
        const mimeType = videoRes.headers.get('Content-Type') || 'video/mp4';
        return { videoBlob, mimeType };
    }

    if (provider === 'keling') {
        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);

        // Kling AI video generation
        onProgress('Submitting video generation task...');
        const createBody: Record<string, unknown> = {
            model_name: model || 'kling-v1',
            prompt,
            cfg_scale: 0.5,
            mode: 'std',
            aspect_ratio: aspectRatio.replace(':', ':'),
            duration: '5',
        };
        if (firstFrame) {
            createBody.image = firstFrame.href;
            createBody.type = 'img2video';
        } else {
            createBody.type = 'text2video';
        }

        const createRes = await fetch(`${baseUrl}/videos/generations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(createBody),
        });

        if (!createRes.ok) {
            throw new Error(await readErrorResponse(createRes, 'Keling 视频生成请求失败'));
        }

        const createJson = await readJsonResponse<any>(createRes, 'Keling 视频生成创建响应');
        const taskId = createJson?.data?.task_id;
        if (!taskId) throw new Error('Keling 视频生成未返回 task_id');

        // Poll for completion
        const progressMessages = ['Rendering frames...', 'Compositing video...', 'Applying final touches...', 'Almost there...'];
        let messageIndex = 0;
        onProgress('Generation started, this may take a few minutes.');

        let videoUrl: string | undefined;
        const kelingPollStart = Date.now();
        while (true) {
            if (Date.now() - kelingPollStart > 600_000) {
                throw new Error('Keling 视频生成超时（已等待超过 10 分钟）');
            }
            onProgress(progressMessages[messageIndex % progressMessages.length]);
            messageIndex++;
            await new Promise(resolve => setTimeout(resolve, 10000));

            const queryRes = await fetch(`${baseUrl}/videos/generations/${encodeURIComponent(taskId)}`, {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            if (!queryRes.ok) {
                throw new Error(await readErrorResponse(queryRes, 'Keling 任务查询失败'));
            }
            const queryJson = await readJsonResponse<any>(queryRes, 'Keling 任务查询响应');
            const status = queryJson?.data?.task_status;

            if (status === 'failed') {
                throw new Error(`Keling 视频生成失败: ${queryJson?.data?.task_status_msg || 'Unknown error'}`);
            }
            if (status === 'succeed') {
                videoUrl = queryJson?.data?.task_result?.videos?.[0]?.url;
                break;
            }
        }

        if (!videoUrl) throw new Error('Keling 视频生成完成但未返回下载链接');

        onProgress('Downloading generated video...');
        const videoRes = await fetch(videoUrl);
        if (!videoRes.ok) throw new Error(`视频下载失败: ${videoRes.statusText}`);
        const videoBlob = await videoRes.blob();
        const mimeType = videoRes.headers.get('Content-Type') || 'video/mp4';
        return { videoBlob, mimeType };
    }

    if (provider === 'volcengine') {
        const handle = await submitSeedanceVideoTask(prompt, model, key, {
            ...options,
            aspectRatio,
            slots: multimodalSlots,
        });
        const seedanceProgressMessages = ['Rendering frames...', 'Compositing video...', 'Applying final touches...', 'Almost there...'];
        let seedanceMsgIndex = 0;
        onProgress('Generation started, this may take a few minutes.');
        const seedancePollStart = Date.now();

        while (true) {
            if (Date.now() - seedancePollStart > 600_000) {
                throw new Error('Seedance 视频生成超时（已等待超过 10 分钟）');
            }
            onProgress(seedanceProgressMessages[seedanceMsgIndex % seedanceProgressMessages.length]);
            seedanceMsgIndex++;
            await new Promise(resolve => setTimeout(resolve, 10000));

            const result = await pollSeedanceVideoTask(handle, key);
            if (result.status === 'failed') {
                throw new Error(`Seedance 视频生成失败: ${result.error || 'Unknown error'}`);
            }
            if (result.status === 'succeeded') {
                onProgress('Downloading generated video...');
                return downloadSeedanceVideoResult(result.videoUrl);
            }
        }
    }

    if (provider === 'custom') {
        if (!key) {
            throw new Error('未配置自定义视频端点的 API Key。');
        }
        return generateVideoWithUnifiedAsyncApi(prompt, model, key, options);
    }

    throw new Error(
        `当前暂不支持使用 ${PROVIDER_LABELS[provider] || provider} 进行视频生成。` +
        `请切换到 Google Veo、MiniMax video-01、Keling 或 Seedance 视频模型。`
    );
}

export async function executeUnifiedIgnition(input: UnifiedIgnitionInput): Promise<UnifiedIgnitionResult> {
    const capability = inferCapabilityFromModelName(input.modelId);
    const prompt = input.prompt.trim();

    if (!prompt) {
        return { ok: false, elementId: input.elementId, capability, errorMessage: '请输入提示词后再点火。' };
    }

    try {
        if (input.signal?.aborted) throw input.signal.reason || new DOMException('生成已停止', 'AbortError');
        const effectivePrompt = buildPromptWithReferenceBindings(prompt, input.references);
        if (capability === 'video') {
            const videoRefs = getImageReferencesForIgnition(input.references);
            const videoSlots = getMultimodalSlotsForIgnition(input.references);
            const result = await generateVideoWithProvider(effectivePrompt, input.modelId, input.apiKeyPayload, {
                aspectRatio: input.aspectRatio || getDynamicParamSchema(input.modelId).defaultAspectRatio || '16:9',
                durationSec: input.durationSec,
                resolution: input.resolution,
                generateAudio: input.generateAudio,
                watermark: input.watermark,
                references: videoRefs,
                slots: videoSlots,
                onProgress: message => input.onProgress?.(35, message),
            });
            const mediaUrl = URL.createObjectURL(result.videoBlob);
            return { ok: true, elementId: input.elementId, mediaUrl, mimeType: result.mimeType, capability };
        }

        const imageReferences = getImageReferencesForIgnition(input.references);
        const result = await generateImageWithProvider(effectivePrompt, input.modelId, input.apiKeyPayload, imageReferences, { signal: input.signal });

        if (!result.newImageBase64 || !result.newImageMimeType) {
            return {
                ok: false,
                elementId: input.elementId,
                capability,
                errorMessage: result.textResponse || '生成网关未返回可用图片。',
            };
        }

        return {
            ok: true,
            elementId: input.elementId,
            mediaUrl: `data:${result.newImageMimeType};base64,${result.newImageBase64}`,
            mimeType: result.newImageMimeType,
            capability,
            textResponse: result.textResponse,
        };
    } catch (error) {
        const reason = input.signal?.aborted ? input.signal.reason : error;
        const aborted = input.signal?.aborted || (error instanceof Error && error.name === 'AbortError');
        return {
            ok: false,
            elementId: input.elementId,
            capability,
            errorMessage: aborted
                ? (reason instanceof Error && reason.name === 'TimeoutError' ? reason.message : '生成已停止，可重新发起。')
                : error instanceof Error ? error.message : '多模态点火失败。',
        };
    }
}

export interface ImageToolInput {
    href: string;
    mimeType: string;
}

export interface ImageToolLayer {
    name: string;
    dataUrl: string;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
}

export type ImageToolTask = 'upscale' | 'remove-background' | 'enhance';

export interface ImageToolResult {
    dataUrl: string;
    mimeType: string;
    width: number;
    height: number;
}

function getAgentBaseUrl(provider: AIProvider, key?: UserApiKey): string {
    return getBaseUrl(provider, key).replace(/\/$/, '');
}

function dataUrlFromMaybeBase64(value: unknown, mimeType: string): string | null {
    if (typeof value !== 'string' || !value) return null;
    return value.startsWith('data:') ? value : `data:${mimeType};base64,${value}`;
}

export async function splitImageLayersWithProvider(
    image: ImageToolInput,
    model: string,
    key?: UserApiKey,
): Promise<ImageToolLayer[]> {
    const provider = key?.provider || resolveGenerationProvider(model, key);
    if (!key?.baseUrl) {
        throw new Error('未配置图像工具端点 Base URL。请在供应商设置中填写支持 /split-layers 的 API 地址。');
    }

    const apiKey = requireApiKey(provider, key);
    const base64Payload = image.href.includes(',') ? image.href.split(',')[1] : image.href;
    const response = await fetch(`${getAgentBaseUrl(provider, key)}/split-layers`, {
        method: 'POST',
        headers: buildProviderHeaders(apiKey, key),
        body: JSON.stringify({
            model: mapProviderModel(model, key),
            task: 'layer-segmentation',
            image: { data: base64Payload, mimeType: image.mimeType },
        }),
    });
    if (!response.ok) throw new Error(await readErrorResponse(response, '图层拆分请求失败'));
    const json = await readJsonResponse<any>(response, '图层拆分响应');
    const rawLayers = (json.layers || json.results || json.data || []) as Array<Record<string, any>>;
    return rawLayers.map((layer, index) => {
        const mimeType = layer.mimeType || layer.mime_type || image.mimeType || 'image/png';
        const dataUrl = dataUrlFromMaybeBase64(layer.imageBase64 || layer.base64 || layer.image_data || layer.dataUrl || layer.image_url, mimeType);
        if (!dataUrl) return null;
        return {
            name: layer.name || layer.label || `Layer ${index + 1}`,
            dataUrl,
            width: Number(layer.width || layer.bbox?.width || layer.box?.width || layer.bounds?.width || 0),
            height: Number(layer.height || layer.bbox?.height || layer.box?.height || layer.bounds?.height || 0),
            offsetX: Number(layer.x || layer.bbox?.x || layer.box?.x || layer.bounds?.x || 0),
            offsetY: Number(layer.y || layer.bbox?.y || layer.box?.y || layer.bounds?.y || 0),
        };
    }).filter((layer): layer is ImageToolLayer => !!layer);
}

export async function runImageAgentWithProvider(
    image: ImageToolInput,
    task: ImageToolTask,
    model: string,
    key?: UserApiKey,
    options?: Record<string, unknown>,
): Promise<ImageToolResult> {
    const provider = key?.provider || resolveGenerationProvider(model, key);
    if (!key?.baseUrl) {
        throw new Error('未配置图像工具端点 Base URL。请在供应商设置中填写支持 /agent 的 API 地址。');
    }

    const apiKey = requireApiKey(provider, key);
    const base64Payload = image.href.includes(',') ? image.href.split(',')[1] : image.href;
    const response = await fetch(`${getAgentBaseUrl(provider, key)}/agent`, {
        method: 'POST',
        headers: buildProviderHeaders(apiKey, key),
        body: JSON.stringify({
            model: mapProviderModel(model, key),
            task,
            image: { data: base64Payload, mimeType: image.mimeType },
            options: options || {},
        }),
    });
    if (!response.ok) throw new Error(await readErrorResponse(response, '图片代理请求失败'));
    const json = await readJsonResponse<any>(response, '图片代理响应');
    const raw = json.result || json.image || json.data || json;
    const mimeType = raw.mimeType || raw.mime_type || image.mimeType || 'image/png';
    const dataUrl = dataUrlFromMaybeBase64(raw.imageBase64 || raw.base64 || raw.image_data || raw.dataUrl || raw.image_url, mimeType);
    if (!dataUrl) throw new Error('图片代理未返回可用图片数据。');
    return {
        dataUrl,
        mimeType,
        width: Number(raw.width || 0),
        height: Number(raw.height || 0),
    };
}

/**
 * 自省诊断 — 根据用户已配置的 API Key 集合，检查各能力覆盖情况并返回警告
 *
 * @param keys - 用户当前所有 API Key（来自 App.tsx state: userApiKeys）
 * @returns covered: 已覆盖能力列表，missing: 缺失的能力，warnings: 具体提示信息
 */
export function diagnoseKeyCapabilities(keys: UserApiKey[]): {
    covered: AICapability[];
    missing: AICapability[];
    warnings: string[];
} {
    const ALL_CAPS: AICapability[] = ['text', 'image', 'video'];
    const coveredSet = new Set<AICapability>();
    const warnings: string[] = [];

    for (const key of keys) {
        const caps = key.capabilities?.length ? key.capabilities : inferCapabilitiesByProvider(key.provider);
        for (const c of caps) coveredSet.add(c);
    }

    const covered = ALL_CAPS.filter(c => coveredSet.has(c));
    const missing = ALL_CAPS.filter(c => !coveredSet.has(c));

    if (missing.includes('text')) warnings.push('未配置文本模型 API Key — 提示词润色、AI 对话功能不可用');
    if (missing.includes('image')) warnings.push('未配置图片模型 API Key — AI 绘图、图片编辑功能不可用');
    if (missing.includes('video')) warnings.push('未配置视频模型 API Key — AI 视频生成功能不可用');

    // 检查是否有 Google key (核心能力依赖)
    const hasGoogle = keys.some(k => k.provider === 'google' && k.key);
    if (!hasGoogle && keys.length > 0) {
        warnings.push('建议配置 Google API Key — Gemini 3 / Imagen 4 / Veo 3.1 是当前最强图像和视频模型');
    }

    if (keys.length === 0) {
        warnings.push('尚未配置任何 API Key — 所有 AI 功能不可用，请先在设置中添加');
    }

    return { covered, missing, warnings };
}

// --- Structured capability reasons ---------------------------------------------------

export type CapabilityStatus = {
    capability: AICapability;
    supported: boolean;
    reason: string;
};

/**
 * Return per-capability support status **with human-readable reasons**.
 * Unlike `diagnoseKeyCapabilities` (which is consumed by DiagnosticBar),
 * this function is intended for panels that need to explain *why*
 * a capability is available or missing.
 */
export function explainKeyCapabilities(keys: UserApiKey[]): CapabilityStatus[] {
    const covered = new Set<AICapability>(
        keys.flatMap(key =>
            key.capabilities?.length
                ? key.capabilities
                : inferCapabilitiesByProvider(key.provider),
        ),
    );

    return [
        {
            capability: 'text',
            supported: covered.has('text'),
            reason: covered.has('text')
                ? '至少一个文本模型 Key 可用。'
                : '未找到文本模型 Key — 提示词润色、AI 对话不可用。',
        },
        {
            capability: 'image',
            supported: covered.has('image'),
            reason: covered.has('image')
                ? '至少一个图片模型 Key 可用。'
                : '未找到图片模型 Key — AI 绘图、图片编辑不可用。',
        },
        {
            capability: 'video',
            supported: covered.has('video'),
            reason: covered.has('video')
                ? '至少一个视频模型 Key 可用。'
                : '未找到视频模型 Key — AI 视频生成不可用。',
        },
    ];
}
