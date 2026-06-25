import type { AIProvider } from '../types';

const OPENAI_COMPATIBLE_PROVIDERS = new Set<AIProvider>([
    'openai',
    'openrouter',
    'deepseek',
    'siliconflow',
    'qwen',
    'minimax',
    'volcengine',
    'openai_compatible',
    'custom',
    'keling',
    'flux',
    'midjourney',
]);

function trimTrailingSlashes(value: string) {
    return value.trim().replace(/\/+$/, '');
}

function safeParseUrl(value: string) {
    try {
        return new URL(value);
    } catch {
        return null;
    }
}

function isRootPath(pathname: string) {
    return pathname === '' || pathname === '/';
}

/**
 * 识别用户误贴的子路径（如 /v1/chat/completions）并裁回到 API 根。
 * 返回裁剪后的完整 URL；如果不匹配则返回 null。
 */
function trimKnownSubPaths(url: URL): string | null {
    const subPathPatterns = [
        /(\/v\d+)\/chat\/completions\/?$/i,
        /(\/v\d+)\/completions\/?$/i,
        /(\/v\d+)\/images\/generations\/?$/i,
        /(\/v\d+)\/models\/?$/i,
        /(\/v\d+)\/embeddings\/?$/i,
        /(\/v\d+)\/audio\/?.*$/i,
        /(\/v\d+)\/videos\/generations\/?$/i,
    ];
    for (const pattern of subPathPatterns) {
        const match = url.pathname.match(pattern);
        if (match) {
            return `${url.origin}${match[1]}`;
        }
    }
    return null;
}

function unique(values: string[]) {
    return Array.from(new Set(values.filter(Boolean)));
}

export function normalizeProviderBaseUrl(provider: AIProvider, baseUrl?: string) {
    const trimmed = trimTrailingSlashes(baseUrl || '');
    if (!trimmed) return trimmed;

    if (provider === 'runningHub') {
        const parsed = safeParseUrl(trimmed);
        if (!parsed) return trimmed;
        const path = parsed.pathname.replace(/\/+$/, '');
        if (!path || path === '/') return `${parsed.origin}/openapi/v2`;
        const apiIndex = path.toLowerCase().indexOf('/openapi/v2');
        if (apiIndex >= 0) return `${parsed.origin}${path.slice(0, apiIndex + '/openapi/v2'.length)}`;
        return trimmed;
    }

    if (provider === 'google') {
        return trimmed.replace(/\/models$/i, '');
    }

    if (!OPENAI_COMPATIBLE_PROVIDERS.has(provider)) {
        return trimmed;
    }

    const parsed = safeParseUrl(trimmed);
    if (!parsed) return trimmed;

    // 先尝试裁剪用户常见的误贴子路径
    const trimmedSub = trimKnownSubPaths(parsed);
    if (trimmedSub) return trimmedSub;

    // 如果路径不是根（也不是可识别的子路径），保持原样
    if (!isRootPath(parsed.pathname)) return trimmed;

    const origin = parsed.origin;
    if (provider === 'openrouter' || /openrouter/i.test(parsed.hostname)) {
        return `${origin}/api/v1`;
    }
    if (provider === 'qwen' || /dashscope\.aliyuncs\.com/i.test(parsed.hostname)) {
        return `${origin}/compatible-mode/v1`;
    }
    if (provider === 'volcengine' || /volces\.com/i.test(parsed.hostname)) {
        return `${origin}/api/v3`;
    }
    return `${origin}/v1`;
}

export function getOpenAICompatibleBaseUrlCandidates(provider: AIProvider, baseUrl: string) {
    const trimmed = trimTrailingSlashes(baseUrl);
    if (!trimmed) return [];

    const normalized = normalizeProviderBaseUrl(provider, trimmed);
    const parsed = safeParseUrl(trimmed);
    if (!parsed) return unique([normalized, trimmed]);

    // 即使用户输入了子路径，normalize 已裁剪过，这里比较要考虑两种
    if (!isRootPath(parsed.pathname) && !trimKnownSubPaths(parsed)) {
        return unique([normalized, trimmed]);
    }

    const origin = parsed.origin;
    const candidates = provider === 'openrouter' || /openrouter/i.test(parsed.hostname)
        ? [`${origin}/api/v1`, normalized, trimmed, `${origin}/v1`]
        : [normalized, trimmed, `${origin}/v1`, `${origin}/api/v1`];

    if (provider === 'qwen' || /dashscope\.aliyuncs\.com/i.test(parsed.hostname)) {
        candidates.push(`${origin}/compatible-mode/v1`);
    }
    if (provider === 'volcengine' || /volces\.com/i.test(parsed.hostname)) {
        candidates.push(`${origin}/api/v3`);
    }

    return unique(candidates);
}
