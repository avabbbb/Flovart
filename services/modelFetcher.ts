/**
 * 联网模型拉取服务
 * 通过 API Key 调用各 Provider 的接口获取可用模型列表。
 * 优先支持：Google Gemini、DeepSeek、OpenAI 及兼容接口。
 */

import type { AIProvider, AICapability } from '../types';
import { getOpenAICompatibleBaseUrlCandidates, normalizeProviderBaseUrl } from './baseUrl';
import { isLikelyRunningHubModelEndpoint, normalizeRunningHubModelEndpoint, rhTestApiKey, BUILTIN_RUNNINGHUB_MODELS } from './runningHubService';

export interface FetchedModel {
    id: string;
    name: string;
    capability: AICapability;
    description?: string;
    inputModalities?: string[];
    outputModalities?: string[];
    supportedParameters?: string[];
}

export interface FetchModelsResult {
    ok: boolean;
    models: FetchedModel[];
    error?: string;
    endpointFlavor?: 'google' | 'openai-compatible' | 'openrouter-compatible';
    capabilitySummary?: AICapability[];
    effectiveBaseUrl?: string;
}

// ── Capability 推断规则 ─────────────────────────────
function stripProviderPrefix(modelId: string): string {
    const normalized = modelId.toLowerCase();
    const parts = normalized.split('/');
    return parts.length > 1 ? parts.slice(1).join('/') : normalized;
}

function inferCapability(modelId: string, model?: any): AICapability {
    const categoryText = `${model?.categoryName || ''} ${model?.sourceTypeName || ''}`.toLowerCase();
    if (/video/.test(categoryText)) return 'video';
    if (/image/.test(categoryText)) return 'image';

    const outputModalities = model?.architecture?.output_modalities || model?.output_modalities || [];
    if (Array.isArray(outputModalities)) {
        if (outputModalities.includes('video')) return 'video';
        if (outputModalities.includes('image')) return 'image';
    }

    const id = stripProviderPrefix(modelId);
    if (/^(veo|video|wan|seedance|vidu|pika|runway|higgsfield|luma|kling|keling|sora|sdols|hailuo|qwen-video|liveportrait|videoretalk|emo|gemini-omni|happyhorse|ltx|pixverse|skyreels)/.test(id)) return 'video';
    if (/(^|[-_/])(text|image|reference|start|end|multimodal)?-?to-video|video-edit|edit-video|motion-control|video-extend/.test(id)) return 'video';
    if (/^(imagen|image-generation|dall-e|gpt-image|stable-diffusion|sdxl|flux|midjourney|recraft|ideogram|qwen-image|seededit|seedream|nano-banana|jimeng|doubao-image|omni-image|grok-image|rhart-image|f-|z-image|xai\/rhart|xai\/grok-imagine-image)/.test(id)) return 'image';
    if (/(^|[-_/])(text|image)-to-image|image-edit|edit-channel|edit-official|\/edit(?:-|$)/.test(id)) return 'image';
    if (/image/.test(id) && /gemini/.test(id)) return 'image';
    return 'text';
}

function summarizeCapabilities(models: FetchedModel[]): AICapability[] {
    return Array.from(new Set(models.map(model => model.capability)));
}

function detectEndpointFlavor(baseUrl: string, rawModels: any[]): 'openai-compatible' | 'openrouter-compatible' {
    if (/openrouter/i.test(baseUrl)) return 'openrouter-compatible';
    if (rawModels.some(model => model?.architecture?.output_modalities || model?.supported_parameters)) {
        return 'openrouter-compatible';
    }
    return 'openai-compatible';
}

function truncateResponseSnippet(text: string, maxLength = 200) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength)}...`;
}

function looksLikeHtmlResponse(text: string) {
    return /^\s*<(?:!doctype|html|head|body)\b/i.test(text);
}

const RUNNINGHUB_DOCS_MODEL_URL = 'https://www.runninghub.ai/page-api';

function runningHubModelToFetchedModel(id: string, model?: any): FetchedModel {
    return {
        id,
        name: id,
        capability: inferCapability(id, model),
        description: model?.description?.slice?.(0, 160) || 'RunningHub 标准模型',
    };
}

function derefNuxtValue(data: unknown[], value: unknown): unknown {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < data.length) {
        return data[value];
    }
    return value;
}

function nuxtString(data: unknown[], value: unknown): string {
    const resolved = derefNuxtValue(data, value);
    return typeof resolved === 'string' ? resolved : '';
}

function parseRunningHubPageModels(html: string): FetchedModel[] {
    const match = html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return [];
    let data: unknown[];
    try {
        data = JSON.parse(match[1]);
    } catch {
        return [];
    }
    if (!Array.isArray(data)) return [];

    const models: FetchedModel[] = [];
    for (const raw of data) {
        if (!raw || Array.isArray(raw) || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        if (!('name' in item) || !('categoryName' in item)) continue;
        const rawName = nuxtString(data, item.name);
        const id = normalizeRunningHubModelEndpoint(rawName);
        if (!rawName || /\[Deprecated\]|Please use/i.test(rawName) || !isLikelyRunningHubModelEndpoint(id)) continue;
        const categoryName = nuxtString(data, item.categoryName);
        const sourceTypeName = nuxtString(data, item.sourceTypeName);
        const description = nuxtString(data, item.description);
        const capability = inferCapability(id, { categoryName, sourceTypeName });
        if (capability !== 'image' && capability !== 'video') continue;
        models.push(runningHubModelToFetchedModel(id, { categoryName, sourceTypeName, description }));
    }
    return models;
}

function mergeModelLists(...lists: FetchedModel[][]): FetchedModel[] {
    const merged = new Map<string, FetchedModel>();
    for (const list of lists) {
        for (const model of list) {
            if (!merged.has(model.id)) merged.set(model.id, model);
        }
    }
    return Array.from(merged.values()).sort((a, b) => {
        if (a.capability !== b.capability) return a.capability === 'image' ? -1 : 1;
        return a.id.localeCompare(b.id);
    });
}

async function readJsonResponse<T>(response: Response, requestLabel: string): Promise<T> {
    const text = await response.text().catch(() => '');
    if (!text) return {} as T;

    if (looksLikeHtmlResponse(text)) {
        throw new Error(`${requestLabel} 返回了 HTML 页面，请检查 Base URL 是否指向 API 接口而不是网站首页。`);
    }

    try {
        return JSON.parse(text) as T;
    } catch {
        const contentType = response.headers.get('Content-Type') || 'unknown';
        throw new Error(`${requestLabel} 返回了非 JSON 响应 (${contentType})：${truncateResponseSnippet(text)}`);
    }
}

async function readErrorMessage(response: Response, requestLabel: string): Promise<string> {
    const text = await response.text().catch(() => '');
    if (!text) return `${requestLabel}: HTTP ${response.status}`;

    if (looksLikeHtmlResponse(text)) {
        return `${requestLabel}: 返回了 HTML 页面，请检查 Base URL 是否指向 API 接口而不是网站首页。`;
    }

    try {
        const json = JSON.parse(text);
        const detail = json?.error?.message || json?.message || json?.detail;
        if (detail) return String(detail);
    } catch {
        // Fall back to plain text below.
    }

    return `${requestLabel}: ${truncateResponseSnippet(text)}`;
}

// ── Google Gemini ──────────────────────────────────
async function fetchGoogleModels(apiKey: string, baseUrl?: string): Promise<FetchModelsResult> {
    try {
        const base = normalizeProviderBaseUrl('google', baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
        const url = `${base}/models?key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url);
        if (!res.ok) {
            return { ok: false, models: [], error: await readErrorMessage(res, 'Google 模型列表拉取失败') };
        }
        const data = await readJsonResponse<any>(res, 'Google 模型列表响应');
        const models: FetchedModel[] = (data.models || [])
            .filter((m: any) => {
                const name: string = m.name || '';
                // 只保留有实用能力的模型，排除 embedding/AQA 等
                return !(/embed|aqa|retrieval|attribution/i.test(name));
            })
            .map((m: any) => {
                const id = (m.name || '').replace(/^models\//, '');
                const methods: string[] = m.supportedGenerationMethods || [];
                let capability: AICapability = 'text';
                if (methods.includes('generateImages') || /imagen/i.test(id)) {
                    capability = 'image';
                } else if (/veo/i.test(id)) {
                    capability = 'video';
                } else if (/image/i.test(id) && /gemini/i.test(id)) {
                    capability = 'image';
                }
                return {
                    id,
                    name: m.displayName || id,
                    capability,
                    description: m.description?.slice(0, 120),
                };
            });
        return { ok: true, models, endpointFlavor: 'google', capabilitySummary: summarizeCapabilities(models), effectiveBaseUrl: base };
    } catch (err) {
        return { ok: false, models: [], error: err instanceof Error ? err.message : '网络错误' };
    }
}

function parseErrorText(response: Response, responseText: string, requestLabel: string) {
    if (!responseText) return `${requestLabel}: HTTP ${response.status}`;

    if (looksLikeHtmlResponse(responseText)) {
        return `${requestLabel}: 返回了 HTML 页面，请检查 Base URL 是否指向 API 接口而不是网站首页。`;
    }

    try {
        const json = JSON.parse(responseText);
        const detail = json?.error?.message || json?.message || json?.detail;
        if (detail) return String(detail);
    } catch {
        // Fall back to plain text below.
    }

    return `${requestLabel}: ${truncateResponseSnippet(responseText)}`;
}

function shouldRetryWithAnotherBaseUrl(status: number, responseText: string) {
    if (looksLikeHtmlResponse(responseText)) return true;
    if (status === 404 && /invalid url|you may need|get \/v1\/models/i.test(responseText)) return true;
    return false;
}

// ── OpenAI / 兼容接口（DeepSeek、SiliconFlow、Qwen 等）──
async function fetchOpenAICompatibleModels(
    apiKey: string,
    baseUrl: string,
    provider: AIProvider
): Promise<FetchModelsResult> {
    const candidates = getOpenAICompatibleBaseUrlCandidates(provider, baseUrl);
    let lastError = '网络错误';

    for (const candidateBaseUrl of candidates) {
        try {
            const url = `${candidateBaseUrl}/models`;
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${apiKey}` },
            });
            const text = await res.text().catch(() => '');

            if (!res.ok) {
                lastError = parseErrorText(res, text, '模型列表拉取失败');
                if (shouldRetryWithAnotherBaseUrl(res.status, text)) {
                    continue;
                }
                return { ok: false, models: [], error: lastError };
            }

            if (looksLikeHtmlResponse(text)) {
                lastError = '模型列表响应返回了 HTML 页面，请检查 Base URL 是否指向 API 接口而不是网站首页。';
                continue;
            }

            const data = text ? JSON.parse(text) : {};
            const rawModels: any[] = data.data || data.models || [];
            const endpointFlavor = provider === 'openrouter' ? 'openrouter-compatible' : detectEndpointFlavor(candidateBaseUrl, rawModels);
            const models: FetchedModel[] = rawModels
                .filter((m: any) => {
                    const id: string = m.id || m.name || '';
                    return !(/embed|whisper|tts|moderation|babbage|davinci-002/i.test(id));
                })
                .map((m: any) => {
                    const id = m.id || m.name || '';
                    return {
                        id,
                        name: m.name || id,
                        capability: inferCapability(id, m),
                        description: m.description?.slice?.(0, 160),
                        inputModalities: m.architecture?.input_modalities,
                        outputModalities: m.architecture?.output_modalities,
                        supportedParameters: m.supported_parameters,
                    };
                });
            return {
                ok: true,
                models,
                endpointFlavor,
                capabilitySummary: summarizeCapabilities(models),
                effectiveBaseUrl: candidateBaseUrl,
            };
        } catch (err) {
            lastError = err instanceof Error ? err.message : '网络错误';
        }
    }

    return { ok: false, models: [], error: lastError };
}

// ── RunningHub 标准模型 ─────────────────────────────
async function fetchRunningHubModels(apiKey: string, baseUrl?: string): Promise<FetchModelsResult> {
    const effectiveBaseUrl = normalizeProviderBaseUrl('runningHub', baseUrl || 'https://www.runninghub.cn/openapi/v2');
    const valid = await rhTestApiKey(apiKey, effectiveBaseUrl);
    if (!valid) {
        return { ok: false, models: [], error: 'RunningHub API Key 无效或权限不足' };
    }

    let pageModels: FetchedModel[] = [];
    try {
        const response = await fetch(RUNNINGHUB_DOCS_MODEL_URL);
        if (response.ok) {
            pageModels = parseRunningHubPageModels(await response.text());
        }
    } catch {
        // Public page fetch can fail behind strict networks; the user can still add model IDs manually.
    }

    const builtinModels: FetchedModel[] = BUILTIN_RUNNINGHUB_MODELS.map(item => ({
        id: item.id,
        name: item.id,
        capability: item.capability,
        description: item.description,
    }));

    const models = mergeModelLists(builtinModels, pageModels);
    return {
        ok: true,
        models,
        capabilitySummary: summarizeCapabilities(models),
        effectiveBaseUrl,
    };
}

// ── Provider 默认 Base URL ──────────────────────────
const PROVIDER_BASE_URLS: Partial<Record<AIProvider, string>> = {
    openai: 'https://api.openai.com/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    deepseek: 'https://api.deepseek.com/v1',
    siliconflow: 'https://api.siliconflow.cn/v1',
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    minimax: 'https://api.minimax.chat/v1',
    volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
    runningHub: 'https://www.runninghub.cn/openapi/v2',
};

// ── 主入口 ──────────────────────────────────────────
export async function fetchModelsForProvider(
    provider: AIProvider,
    apiKey: string,
    baseUrl?: string
): Promise<FetchModelsResult> {
    if (provider === 'google') {
        return fetchGoogleModels(apiKey, baseUrl);
    }

    if (provider === 'runningHub') {
        return fetchRunningHubModels(apiKey, baseUrl);
    }

    // OpenAI 兼容类
    if (['openai', 'openrouter', 'deepseek', 'siliconflow', 'qwen', 'minimax', 'volcengine', 'openai_compatible', 'custom'].includes(provider)) {
        const url = baseUrl || PROVIDER_BASE_URLS[provider];
        if (!url) {
            return { ok: false, models: [], error: '未指定 Base URL' };
        }
        return fetchOpenAICompatibleModels(apiKey, url, provider);
    }

    // 其他 Provider 无法联网拉取，返回空（使用内置列表）
    return { ok: true, models: [] };
}

// ── 免费 Key 申请链接 ───────────────────────────────
export const FREE_KEY_LINKS: { provider: AIProvider; label: string; url: string; description: string }[] = [
    {
        provider: 'google',
        label: 'Google AI Studio',
        url: 'https://aistudio.google.com/apikey',
        description: '免费额度：每分钟 15 次请求，支持 Gemini 和 Imagen 模型',
    },
    {
        provider: 'deepseek',
        label: 'DeepSeek 开放平台',
        url: 'https://platform.deepseek.com/api_keys',
        description: '注册即送 500 万 Tokens，DeepSeek-V3 和 DeepSeek-R1',
    },
    {
        provider: 'volcengine',
        label: '火山引擎 (豆包)',
        url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
        description: '注册赠送免费额度，支持豆包大模型',
    },
    {
        provider: 'minimax',
        label: 'MiniMax',
        url: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
        description: '注册即送额度，支持文本、图片和视频生成',
    },
];

// ── 模型缓存 ──────────────────────────────────────
const MODEL_CACHE_TTL = 60 * 60 * 1000; // 1 小时
const CACHE_KEY_PREFIX = 'modelCache.';

interface CachedModels {
    models: FetchedModel[];
    fetchedAt: number;
    endpointFlavor?: string;
}

function getCachedModels(provider: AIProvider, keyFingerprint: string): CachedModels | null {
    try {
        const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${provider}_${keyFingerprint}`);
        if (!raw) return null;
        const cached: CachedModels = JSON.parse(raw);
        if (Date.now() - cached.fetchedAt > MODEL_CACHE_TTL) return null;
        return cached;
    } catch {
        return null;
    }
}

function setCachedModels(provider: AIProvider, keyFingerprint: string, models: FetchedModel[], endpointFlavor?: string) {
    try {
        const entry: CachedModels = { models, fetchedAt: Date.now(), endpointFlavor };
        localStorage.setItem(`${CACHE_KEY_PREFIX}${provider}_${keyFingerprint}`, JSON.stringify(entry));
    } catch { /* storage full — silent */ }
}

function keyFingerprint(apiKey: string): string {
    return apiKey.slice(0, 6) + '...' + apiKey.slice(-4);
}

/**
 * 带缓存的模型拉取。TTL 内直接返回缓存，过期后自动重新拉取。
 */
export async function fetchModelsWithCache(
    provider: AIProvider,
    apiKey: string,
    baseUrl?: string,
    forceRefresh = false,
): Promise<FetchModelsResult> {
    const fp = keyFingerprint(apiKey);
    if (!forceRefresh) {
        const cached = getCachedModels(provider, fp);
        if (cached) {
            return {
                ok: true,
                models: cached.models,
                endpointFlavor: cached.endpointFlavor as FetchModelsResult['endpointFlavor'],
                capabilitySummary: summarizeCapabilities(cached.models),
            };
        }
    }
    const result = await fetchModelsForProvider(provider, apiKey, baseUrl);
    if (result.ok && result.models.length > 0) {
        setCachedModels(provider, fp, result.models, result.endpointFlavor);
    }
    return result;
}

/**
 * 批量刷新所有 API Key 对应的模型列表。
 * 返回每个 Key 的拉取结果，供 useApiKeys 合并到 userApiKeys 状态。
 */
export async function refreshAllProviderModels(
    keys: { id: string; provider: AIProvider; key: string; baseUrl?: string }[],
    forceRefresh = false,
): Promise<Map<string, FetchedModel[]>> {
    const results = new Map<string, FetchedModel[]>();
    const tasks = keys.map(async (k) => {
        try {
            const result = await fetchModelsWithCache(k.provider, k.key, k.baseUrl, forceRefresh);
            if (result.ok && result.models.length > 0) {
                results.set(k.id, result.models);
            }
        } catch { /* individual key failure doesn't block others */ }
    });
    await Promise.allSettled(tasks);
    return results;
}
