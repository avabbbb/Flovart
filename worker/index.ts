// Cloudflare Workers entry for flovart.avabbbb.com (Workers + static assets).
// Same job as functions/api/llm-proxy/[[path]].ts on Pages: /api/llm-proxy/* goes to the
// guarded same-origin LLM proxy (server/llmProxy.ts); everything else is served from assets.
// run_worker_first: true so every asset passes through here: some uploaded assets came back
// as application/octet-stream, and browsers refuse module scripts without a JS MIME type.
import { handleLlmProxy, LLM_PROXY_PREFIX } from '../server/llmProxy';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Optional comma-separated extra origins, e.g. a preview domain. */
  LLM_PROXY_ALLOWED_ORIGINS?: string;
}

const MIME: Record<string, string> = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  wasm: 'application/wasm',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
};

export function mimeFor(pathname: string): string | undefined {
  const ext = pathname.split('/').pop()?.split('.').pop()?.toLowerCase();
  return ext ? MIME[ext] : undefined;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(LLM_PROXY_PREFIX)) {
      const allowedOrigins = (env.LLM_PROXY_ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return handleLlmProxy(request, { allowedOrigins });
    }
    const res = await env.ASSETS.fetch(request);
    const want = mimeFor(pathname);
    const got = res.headers.get('content-type') || '';
    if (!want || !res.ok || got.split(';')[0] === want.split(';')[0]) return res;
    const fixed = new Response(res.body, res);
    fixed.headers.set('content-type', want);
    return fixed;
  },
};
