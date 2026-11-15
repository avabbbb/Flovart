// Cloudflare Workers entry for flovart.avabbbb.com (Workers + static assets).
// Same job as functions/api/llm-proxy/[[path]].ts on Pages: /api/llm-proxy/* goes to the
// guarded same-origin LLM proxy (server/llmProxy.ts); everything else is served from assets.
// Needs assets.run_worker_first: ["/api/*"] so the SPA fallback never swallows /api routes.
import { handleLlmProxy, LLM_PROXY_PREFIX } from '../server/llmProxy';

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Optional comma-separated extra origins, e.g. a preview domain. */
  LLM_PROXY_ALLOWED_ORIGINS?: string;
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
    return env.ASSETS.fetch(request);
  },
};
