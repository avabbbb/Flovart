// 插件内反推：用网页画布同步过来的 Key（web-keys.js 的 allKeys()）直接请求模型。
// 指令、请求体、端点与解析来自 reverse-prompt-core.js，和网页 aiGateway 是同一份代码。
// 这里只负责：选哪把 Key、用哪种线格式、鉴权头、图片字节转 data:URL。
// 请求从 Service Worker 发出，不申请额外 host 权限，依赖各厂商 API 的 CORS。
import {
  buildReversePromptBody,
  buildReversePromptInstruction,
  parseReversePromptResponse,
  reversePromptEndpoint,
} from './reverse-prompt-core.js';

// 20 MiB：反推要把整张图转 base64 放进一次请求，比导入上限（64 MiB）收紧。
export const MAX_REVERSE_IMAGE_BYTES = 20971520;
const BASE64_CHUNK = 32768;

const https = host => 'https' + '://' + host;

export const REVERSE_ROUTES = {
  google: { format: 'google', baseUrl: https('generativelanguage.googleapis.com/v1beta'), model: 'gemini-2.5-flash' },
  openai: { format: 'openai', baseUrl: https('api.openai.com/v1'), model: 'gpt-5.4-mini' },
  anthropic: { format: 'anthropic', baseUrl: https('api.anthropic.com/v1'), model: 'claude-sonnet-4-6' },
  openrouter: { format: 'openai', baseUrl: https('openrouter.ai/api/v1'), model: 'openai/gpt-5.4-mini' },
};

// 已知厂商按此顺序优先；都没有时退到带 baseUrl + defaultModel 的 OpenAI 兼容自定义 Key。
const PROVIDER_PREFERENCE = ['google', 'openai', 'anthropic', 'openrouter'];

const trimSlash = url => String(url).replace(/\/+$/, '');

export function resolveReverseRoute(keys) {
  const usable = (Array.isArray(keys) ? keys : []).filter(key => key && typeof key.key === 'string' && key.key);
  for (const provider of PROVIDER_PREFERENCE) {
    const key = usable.find(candidate => candidate.provider === provider);
    if (!key) continue;
    const route = Reflect.get(REVERSE_ROUTES, provider);
    return { key, format: route.format, baseUrl: trimSlash(key.baseUrl || route.baseUrl), model: key.defaultModel || route.model };
  }
  const custom = usable.find(key => key.baseUrl && key.defaultModel);
  if (custom) return { key: custom, format: 'openai', baseUrl: trimSlash(custom.baseUrl), model: custom.defaultModel };
  return null;
}

const HEADER_BUILDERS = {
  google: apiKey => ({ 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }),
  // 浏览器环境直连 Anthropic 必须显式声明，否则 CORS 预检会被拒。
  anthropic: apiKey => ({
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  }),
  openai: apiKey => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey }),
};

export function reverseHeaders(route) {
  const build = Reflect.get(HEADER_BUILDERS, route.format);
  return build(route.key.key);
}

export function bytesToDataUrl(bytes, mimeType) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK));
  }
  return 'data:' + mimeType + ';base64,' + btoa(binary);
}

// media：{ bytes: Uint8Array, mimeType, width?, height? }（来自 service-worker 的 inspectMedia）
// keys：web-keys.js 的 allKeys() 结果
// options：{ lang?: 'en' | 'zho', fetchImpl?: fetch }
export async function reversePromptFromMedia(media, keys, options = {}) {
  const { lang = 'zho', fetchImpl = fetch } = options;
  if (media.bytes.length > MAX_REVERSE_IMAGE_BYTES) throw new Error('反推图片不能超过 20 MB');
  const route = resolveReverseRoute(keys);
  if (!route) {
    throw new Error('没有可用于反推的 API Key：请在已配对的网页画布中配置 Google、OpenAI、Anthropic 或 OpenRouter 的 Key');
  }
  const instruction = buildReversePromptInstruction(lang, {
    width: media.width || undefined,
    height: media.height || undefined,
  });
  const body = buildReversePromptBody(route.format, {
    model: route.model,
    instruction,
    imageDataUrl: bytesToDataUrl(media.bytes, media.mimeType),
    mimeType: media.mimeType,
  });
  const response = await fetchImpl(reversePromptEndpoint(route.format, route.baseUrl, route.model), {
    method: 'POST',
    headers: reverseHeaders(route),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('反推请求失败（HTTP ' + response.status + '，' + route.key.provider + '）');
  const prompt = parseReversePromptResponse(route.format, await response.json());
  if (!prompt) throw new Error('模型没有返回反推结果');
  return { prompt, provider: route.key.provider, model: route.model };
}
