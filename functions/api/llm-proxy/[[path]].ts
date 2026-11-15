// Cloudflare Pages Function: same-origin proxy for LLM gateways that do not
// support browser CORS (see server/llmProxy.ts for the guard rails).
import { handleLlmProxy } from '../../../server/llmProxy';

interface Env {
  /** Optional comma-separated extra origins, e.g. a custom preview domain. */
  LLM_PROXY_ALLOWED_ORIGINS?: string;
}

export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> => {
  const allowedOrigins = (context.env.LLM_PROXY_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return handleLlmProxy(context.request, { allowedOrigins });
};
