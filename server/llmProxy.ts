/**
 * Same-origin LLM proxy core (shared by the Cloudflare Pages Function and the
 * Vite dev middleware).
 *
 * Why: some OpenAI-compatible gateways (OpenCode Go / Zen at opencode.ai) do
 * not answer the browser's CORS preflight (OPTIONS → 404, no
 * Access-Control-Allow-Origin), so the hosted Web build cannot call them
 * directly. The browser instead calls `/api/llm-proxy/<host>/<path>` on its own
 * origin and this handler forwards the request server-side.
 *
 * Guard rails — this must never become an open relay:
 * - upstream host + path prefix allowlist (UPSTREAMS below);
 * - same-origin only (Origin / Sec-Fetch-Site checked);
 * - GET/POST only, Authorization (or provider key header) required;
 * - request body size cap;
 * - only a fixed set of request headers is forwarded (no cookies);
 * - nothing about the request (keys, prompts) is logged.
 *
 * BYOK note: the user's API key passes through this proxy in transit (TLS on
 * both legs). It is never stored or logged.
 */

export const LLM_PROXY_PREFIX = '/api/llm-proxy/';

/** host → allowed path prefixes. Keep this list short and explicit. */
export const LLM_PROXY_UPSTREAMS: Record<string, readonly string[]> = {
  'opencode.ai': ['/inference/', '/zen/'],
};

const FORWARDED_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'x-api-key',
  'x-goog-api-key',
  'anthropic-version',
  'anthropic-beta',
  'x-opencode-session',
  'x-session-id',
] as const;

const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'retry-after',
  'x-request-id',
  'x-opencode-log-id',
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-reset-requests',
] as const;

export const LLM_PROXY_MAX_BODY_BYTES = 32 * 1024 * 1024;
export const LLM_PROXY_USER_AGENT = 'flovart-web/0.3 (+https://github.com/avabbbb/Flovart)';

function jsonError(status: number, message: string, code: string): Response {
  return new Response(JSON.stringify({ error: { message, type: 'flovart_proxy_error', code } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Parse `/api/llm-proxy/<host>/<path>?<query>` into an allowlisted upstream URL. */
export function resolveUpstreamUrl(requestUrl: URL): URL | null {
  if (!requestUrl.pathname.startsWith(LLM_PROXY_PREFIX)) return null;
  const rest = requestUrl.pathname.slice(LLM_PROXY_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const host = rest.slice(0, slash).toLowerCase();
  const path = rest.slice(slash);
  const prefixes = LLM_PROXY_UPSTREAMS[host];
  if (!prefixes) return null;
  // Reject traversal / encoded tricks before matching the prefix.
  if (path.includes('..') || /%2e|%2f|%5c|\\/i.test(path)) return null;
  if (!prefixes.some((p) => path.startsWith(p))) return null;
  const upstream = new URL(`https://${host}${path}`);
  if (upstream.hostname !== host) return null;
  upstream.search = requestUrl.search;
  return upstream;
}

function isSameOrigin(request: Request, requestUrl: URL): boolean {
  const origin = request.headers.get('origin');
  if (origin) return origin === requestUrl.origin;
  const site = request.headers.get('sec-fetch-site');
  // Same-origin GETs may omit Origin; browsers always send Sec-Fetch-Site.
  return site === 'same-origin';
}

export interface LlmProxyOptions {
  /** Extra allowed origins (e.g. a preview domain). */
  allowedOrigins?: readonly string[];
  fetchImpl?: typeof fetch;
}

export async function handleLlmProxy(request: Request, options: LlmProxyOptions = {}): Promise<Response> {
  const requestUrl = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    // Same-origin callers never preflight; answering cross-origin ones would only widen access.
    return new Response(null, { status: 204, headers: { allow: 'GET, POST' } });
  }
  if (method !== 'GET' && method !== 'POST') {
    return jsonError(405, 'Method not allowed', 'method_not_allowed');
  }

  const origin = request.headers.get('origin');
  const allowedExtra = origin && options.allowedOrigins?.includes(origin);
  if (!allowedExtra && !isSameOrigin(request, requestUrl)) {
    return jsonError(403, 'Cross-origin use of the Flovart LLM proxy is not allowed', 'forbidden_origin');
  }

  const upstream = resolveUpstreamUrl(requestUrl);
  if (!upstream) {
    return jsonError(400, 'Upstream is not on the Flovart LLM proxy allowlist', 'upstream_not_allowed');
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has('authorization') && !headers.has('x-api-key') && !headers.has('x-goog-api-key')) {
    return jsonError(401, 'Missing API key', 'missing_api_key');
  }
  headers.set('user-agent', LLM_PROXY_USER_AGENT);
  // OpenCode Go rejects requests without a session id (400 MissingSessionID).
  // The Web shim always sends a stable one; this is only a last-resort fallback.
  if (upstream.hostname === 'opencode.ai' && !headers.has('x-opencode-session')) {
    headers.set('x-opencode-session', `ses_flovart_${crypto.randomUUID().replace(/-/g, '')}`);
  }

  let body: ArrayBuffer | undefined;
  if (method === 'POST') {
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > LLM_PROXY_MAX_BODY_BYTES) return jsonError(413, 'Request body too large', 'body_too_large');
    body = await request.arrayBuffer();
    if (body.byteLength > LLM_PROXY_MAX_BODY_BYTES) return jsonError(413, 'Request body too large', 'body_too_large');
  }

  const doFetch = options.fetchImpl ?? fetch;
  let upstreamResponse: Response;
  try {
    upstreamResponse = await doFetch(upstream.toString(), {
      method,
      headers,
      body,
      // Client abort (stop button / tab close) cancels the upstream call too.
      signal: request.signal,
      redirect: 'manual',
    });
  } catch (error) {
    if (request.signal?.aborted) return jsonError(499, 'Client closed request', 'client_closed');
    return jsonError(502, 'Upstream request failed', 'upstream_unreachable');
  }

  const responseHeaders = new Headers({ 'cache-control': 'no-store', 'x-flovart-proxy': '1' });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstreamResponse.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if ((upstreamResponse.headers.get('content-type') || '').includes('text/event-stream')) {
    responseHeaders.set('cache-control', 'no-cache, no-transform');
    responseHeaders.set('x-accel-buffering', 'no');
  }
  // Body is streamed through untouched: SSE chunks and error JSON both pass as-is.
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
