// 扩展直连上游的白名单：必须与 Cloudflare Worker 代理 server/llmProxy.ts 完全一致（不是开放转发）。
// tests/extensionDirectFetch.test.js 会对拍 LLM_PROXY_UPSTREAMS / LLM_PROXY_PUBLIC_DOC_UPSTREAMS 与 manifest.host_permissions。

/** host → 允许的路径前缀 */
export const DIRECT_UPSTREAMS = {
  'opencode.ai': ['/inference/', '/zen/'],
  'www.runninghub.cn': ['/runninghub-api-doc-cn/'],
  'www.runninghub.ai': ['/runninghub-api-doc-en/'],
};

/** 公开文档上游：只允许 GET .md / llms.txt，且不转发任何凭证。 */
export const DIRECT_PUBLIC_DOC_UPSTREAMS = {
  'www.runninghub.cn': ['/runninghub-api-doc-cn/'],
  'www.runninghub.ai': ['/runninghub-api-doc-en/'],
};

export const DIRECT_HOST_PERMISSIONS = Object.keys(DIRECT_UPSTREAMS).map(host => 'https://' + host + '/' + String.fromCharCode(42));

export const DIRECT_FORWARDED_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'x-api-key',
  'x-goog-api-key',
  'anthropic-version',
  'anthropic-beta',
  'x-opencode-session',
  'x-session-id',
];

export const DIRECT_FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'retry-after',
  'x-request-id',
  'x-opencode-log-id',
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-reset-requests',
];

export const DIRECT_MAX_BODY_BYTES = 32 * 1024 * 1024;

const own = (table, key) => Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;

function isPublicDoc(url) {
  const prefixes = own(DIRECT_PUBLIC_DOC_UPSTREAMS, url.hostname);
  if (!prefixes || !prefixes.some(prefix => url.pathname.startsWith(prefix))) return false;
  const leaf = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  return leaf === 'llms.txt' || /^[A-Za-z0-9_-]+\.md$/.test(leaf);
}

/**
 * 校验网页请求的上游 URL 与方法。返回 { url, publicDoc } 或 { error }。
 * 规则与 server/llmProxy.ts 的 resolveUpstreamUrl + 文档限制一致。
 */
export function checkDirectUpstream(rawUrl, method) {
  const verb = String(method || 'GET').toUpperCase();
  if (verb !== 'GET' && verb !== 'POST') return { error: 'method_not_allowed' };
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('https://')) return { error: 'upstream_not_allowed' };
  // 先在原始字符串上拦截穿越/编码技巧（URL 解析会把 .. 规范化掉）。
  const afterScheme = rawUrl.slice('https://'.length);
  const slash = afterScheme.indexOf('/');
  if (slash <= 0) return { error: 'upstream_not_allowed' };
  const rawHost = afterScheme.slice(0, slash);
  const rawPath = afterScheme.slice(slash).split(/[?#]/)[0];
  if (rawHost !== rawHost.toLowerCase() || /[@:\\]/.test(rawHost)) return { error: 'upstream_not_allowed' };
  if (rawPath.includes('..') || /%2e|%2f|%5c|\\/i.test(rawPath)) return { error: 'upstream_not_allowed' };
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: 'upstream_not_allowed' };
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return { error: 'upstream_not_allowed' };
  if (url.hostname !== rawHost) return { error: 'upstream_not_allowed' };
  const prefixes = own(DIRECT_UPSTREAMS, url.hostname);
  if (!prefixes || !prefixes.some(prefix => url.pathname.startsWith(prefix))) return { error: 'upstream_not_allowed' };
  const publicDoc = isPublicDoc(url);
  if (own(DIRECT_PUBLIC_DOC_UPSTREAMS, url.hostname) && (!publicDoc || verb !== 'GET')) return { error: 'upstream_not_allowed' };
  return { url, publicDoc, method: verb };
}
