import type { AICapability, AIProvider, PromptEnhanceRequest, PromptEnhanceResult, UserApiKey } from '../types';
import { editImage, enhancePromptWithGemini, generateImageFromText, generateVideo, validateGeminiApiKey, getGeminiRestBaseUrl } from './geminiService';
import { fetchModelsForProvider, type FetchModelsResult } from './modelFetcher';
import { normalizeProviderBaseUrl } from './baseUrl';

type ImageInput = { href: string; mimeType: string };

type ProviderModelMap = { text: string[]; image: string[]; video: string[] };

type IgnitionReference = {
    type: 'image' | 'video' | 'text' | 'shape';
    href?: string;
    mimeType?: string;
    slotRole?: string;
};

export interface UnifiedIgnitionInput {
    elementId: string;
    prompt: string;
    modelId: string;
    apiKeyPayload?: UserApiKey;
    references?: IgnitionReference[];
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
        image: ['gpt-image-1', 'dall-e-3'],
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
        image: ['rhart-image-n-pro-official'],
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
        video: [],
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
}

type CustomProviderExtraConfig = Record<string, string> | undefined;

type VideoAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';

/**
 * Provider → supported video aspect ratios.
 * If a provider is not listed, all 6 ratios are assumed to pass through as-is (custom/openrouter).
 */
export const PROVIDER_VIDEO_RATIOS: Partial<Record<AIProvider, VideoAspectRatio[]>> = {
    google:  ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], // Veo accepts all 6
    minimax: ['16:9', '9:16', '1:1'],                        // MiniMax only supports 16:9/9:16/1:1
    keling:  ['16:9', '9:16', '1:1'],                        // Kling AI: 16:9/9:16/1:1
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
            const { rhTestApiKey } = await import('./runningHubService');
            const valid = await rhTestApiKey(apiKey);
            return valid ? { ok: true, capabilitySummary: ['image'] } : { ok: false, message: 'API Key 无效' };
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

function mapProviderModel(model: string, key?: UserApiKey): string {
    return parseModelMappings(key.extraConfig)[model] || model;
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
    return model.trim().toLowerCase();
}

function stripModelProviderPrefix(model: string): string {
    const normalized = normalizeModelName(model);
    const parts = normalized.split('/');
    return parts.length > 1 ? parts.slice(1).join('/') : normalized;
}

export function inferCapabilityFromModel(model: string): AICapability | undefined {
    const normalized = stripModelProviderPrefix(model);
    if (!normalized) return undefined;
    if (/^(veo([-.\d]|$)|video|wan|seedance|vidu|pika|runway|higgsfield|luma|kling|keling|sora|sdols|hailuo|qwen-video|liveportrait|videoretalk|emo)/.test(normalized)) return 'video';
    if (/^(imagen|dall-e|gpt-image|flux|stable-diffusion|sdxl|midjourney|recraft|ideogram|qwen-image|seededit|nano-banana|jimeng|doubao-image|omni-image|grok-image)/.test(normalized)) return 'image';
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

function getImageReferencesForIgnition(references: IgnitionReference[] = []): ImageInput[] {
    return references
        .filter((reference): reference is IgnitionReference & { type: 'image'; href: string; mimeType: string } => (
            reference.type === 'image' && typeof reference.href === 'string' && reference.href.length > 0
        ))
        .map(reference => ({ href: reference.href, mimeType: reference.mimeType || 'image/png' }));
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
    return /^(gpt-image-1(?:\.5|-mini)?|gpt-image-1)$/.test(normalized);
}

export function supportsReferenceImageEditing(model: string): boolean {
    const provider = inferProviderFromModel(model);
    if (provider === 'google') return isGoogleImageEditModel(model);
    if (provider === 'openai' || provider === 'custom') return isOpenAIImageEditModel(model);
    if (provider === 'openrouter') return true;
    return false;
}

export function supportsMaskImageEditing(model: string): boolean {
    const provider = inferProviderFromModel(model);
    if (provider === 'google') return isGoogleImageEditModel(model);
    if (provider === 'openai' || provider === 'custom') return isOpenAIImageEditModel(model);
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
    if (/^(doubao|skylark|ep-)/i.test(model)) return 'volcengine';
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
    return payload?.task_id || payload?.data?.task_id || payload?.id || payload?.data?.id;
}

function extractVideoStatus(payload: any) {
    const rawStatus = payload?.status || payload?.data?.status || payload?.data?.task_status || payload?.state;
    return typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
}

function extractFailureReason(payload: any) {
    return payload?.fail_reason || payload?.data?.fail_reason || payload?.message || payload?.error?.message || payload?.data?.task_status_msg || payload?.status_msg;
}

function extractVideoOutputUrl(payload: any) {
    return payload?.data?.output
        || payload?.data?.outputs?.[0]
        || payload?.output
        || payload?.outputs?.[0]
        || payload?.data?.video_url
        || payload?.data?.task_result?.videos?.[0]?.url;
}

async function generateVideoWithUnifiedAsyncApi(
    prompt: string,
    model: string,
    key: UserApiKey,
    options?: {
        aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
        onProgress?: (message: string) => void;
        image?: ImageInput;
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

            if (options?.image) {
                createBody.images = [options.image.href];
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

                if (['failure', 'failed', 'fail', 'error', 'cancelled', 'canceled'].includes(status)) {
                    throw new Error(`视频生成失败: ${extractFailureReason(queryJson) || 'Unknown error'}`);
                }

                if (['success', 'succeed', 'completed', 'done'].includes(status)) {
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
    key?: UserApiKey
): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null }> {
    const provider = resolveGenerationProvider(model, key);

    if (provider === 'google') {
        // 传入 key?.key 确保使用用户 UI 中配置的 API Key
        return generateImageFromText(prompt, key?.key);
    }

    if (provider === 'openrouter') {
        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: buildOpenRouterHeaders(apiKey),
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
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

    if (provider === 'openai' || provider === 'custom') {
        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);
        const mappedModel = mapProviderModel(model, key);

        // 先尝试标准 /images/generations 端点
        // custom provider 请求 url 格式（代理/聚合端点对大图片 b64_json 响应可能断连），
        // OpenAI 官方端点请求 b64_json（避免额外下载且链接有时效）
        const preferredFormat = provider === 'custom' ? 'url' : 'b64_json';
        try {
            const response = await fetch(`${baseUrl}/images/generations`, {
                method: 'POST',
                headers: buildProviderHeaders(apiKey, key),
                body: JSON.stringify({
                    model: mappedModel,
                    prompt,
                    size: '1024x1024',
                    response_format: preferredFormat,
                }),
            });

            if (response.ok) {
                const json = await readJsonResponse<any>(response, `${PROVIDER_LABELS[provider]} 图片生成响应`);
                const parsed = await parseOpenAIImageResponse(json);
                if (parsed.newImageBase64) return parsed;
            }

            // 对于 custom provider，/images/generations 失败后 fallback 到 chat/completions
            if (provider !== 'custom') {
                throw new Error(await readErrorResponse(response, `${PROVIDER_LABELS[provider]} 图片生成失败`));
            }
        } catch (err) {
            // custom provider 允许 fallback
            if (provider !== 'custom') throw err;
        }

        // Custom fallback: 通过 chat/completions 生图（聚合端点通用方式）
        if (provider === 'custom') {
            const chatResponse = await fetch(`${baseUrl}/chat/completions`, {
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

    throw new Error(`当前暂不支持使用 ${PROVIDER_LABELS[provider] || provider} 进行图片生成。请切换到 Google Gemini、OpenAI 或 OpenRouter 图片模型。`);
}

export async function editImageWithProvider(
    images: ImageInput[],
    prompt: string,
    model: string,
    key?: UserApiKey,
    options?: { mask?: ImageInput }
): Promise<{ newImageBase64: string | null; newImageMimeType: string | null; textResponse: string | null }> {
    const provider = resolveGenerationProvider(model, key);

    if (provider === 'google') {
        if (!supportsReferenceImageEditing(model)) {
            throw new Error('当前 Google 图片模型只支持纯文本生图，请切换到 Gemini 图像编辑模型。');
        }
        return editImage(images, prompt, options?.mask, key?.key);
    }

    if (provider === 'openrouter') {
        if (options?.mask) {
            throw new Error('OpenRouter 当前不支持遮罩局部重绘。请切换到 Google Gemini 或 OpenAI GPT Image 模型。');
        }

        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);
        const content = [
            { type: 'text', text: prompt },
            ...images.map((image) => ({
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

    if (provider === 'openai' || provider === 'custom') {
        // custom provider 跳过模型名检测——聚合端点的模型名不一定匹配 OpenAI 命名规则
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
        const formData = new FormData();
        formData.append('model', mappedModel);
        formData.append('prompt', prompt);
        formData.append('response_format', provider === 'custom' ? 'url' : 'b64_json');

        images.forEach((image, index) => {
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

            if (provider !== 'custom') {
                throw new Error(await readErrorResponse(response, `${PROVIDER_LABELS[provider]} 图片编辑失败`));
            }
        } catch (err) {
            if (provider !== 'custom') throw err;
        }

        // Custom fallback: 通过 chat/completions 进行图片编辑
        if (provider === 'custom') {
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
        aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
        onProgress?: (message: string) => void;
        image?: ImageInput;
    },
): Promise<{ videoBlob: Blob; mimeType: string }> {
    const provider = resolveGenerationProvider(model, key);
    const onProgress = options?.onProgress || (() => {});
    const aspectRatio = options?.aspectRatio || '16:9';

    if (provider === 'google') {
        return generateVideo(prompt, aspectRatio, onProgress, options?.image, key?.key);
    }

    if (provider === 'minimax') {
        const apiKey = requireApiKey(provider, key);
        const baseUrl = getBaseUrl(provider, key);

        // Step 1: Submit video generation task
        onProgress('Submitting video generation task...');
        const createBody: Record<string, unknown> = { model, prompt };
        if (options?.image) {
            createBody.first_frame_image = options.image.href;
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
        if (options?.image) {
            createBody.image = options.image.href;
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

    if (provider === 'custom') {
        if (!key) {
            throw new Error('未配置自定义视频端点的 API Key。');
        }
        return generateVideoWithUnifiedAsyncApi(prompt, model, key, options);
    }

    throw new Error(
        `当前暂不支持使用 ${PROVIDER_LABELS[provider] || provider} 进行视频生成。` +
        `请切换到 Google Veo、MiniMax video-01 或 Keling 视频模型。`
    );
}

export async function executeUnifiedIgnition(input: UnifiedIgnitionInput): Promise<UnifiedIgnitionResult> {
    const capability = inferCapabilityFromModelName(input.modelId);
    const prompt = input.prompt.trim();

    if (!prompt) {
        return { ok: false, elementId: input.elementId, capability, errorMessage: '请输入提示词后再点火。' };
    }

    try {
        if (capability === 'video') {
            const firstFrameReference = input.references?.find(reference => reference.type === 'image' && reference.slotRole === 'first_frame')
                || input.references?.find(reference => reference.type === 'image');
            const firstFrame = firstFrameReference?.href
                ? { href: firstFrameReference.href, mimeType: firstFrameReference.mimeType || 'image/png' }
                : undefined;
            const result = await generateVideoWithProvider(prompt, input.modelId, input.apiKeyPayload, {
                aspectRatio: getDynamicParamSchema(input.modelId).defaultAspectRatio || '16:9',
                image: firstFrame,
                onProgress: message => input.onProgress?.(35, message),
            });
            const mediaUrl = URL.createObjectURL(result.videoBlob);
            return { ok: true, elementId: input.elementId, mediaUrl, mimeType: result.mimeType, capability };
        }

        const imageReferences = getImageReferencesForIgnition(input.references);
        const result = imageReferences.length > 0
            ? await editImageWithProvider(imageReferences, prompt, input.modelId, input.apiKeyPayload)
            : await generateImageWithProvider(prompt, input.modelId, input.apiKeyPayload);

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
        return {
            ok: false,
            elementId: input.elementId,
            capability,
            errorMessage: error instanceof Error ? error.message : '多模态点火失败。',
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
