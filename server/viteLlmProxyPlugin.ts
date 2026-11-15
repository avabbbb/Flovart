/**
 * Vite dev/preview middleware mounting the same LLM proxy as the Cloudflare
 * Pages Function, so `npm run dev` / `vite preview` behave like production.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { Plugin, Connect } from 'vite';
import { handleLlmProxy, LLM_PROXY_PREFIX } from './llmProxy';

function toWebRequest(req: IncomingMessage, abort: AbortController): Request {
  const host = req.headers.host || '127.0.0.1';
  const url = new URL((req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '/', `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = (req.method || 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(url, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
    signal: abort.signal,
    // @ts-expect-error Node fetch requires duplex for streamed bodies
    duplex: hasBody ? 'half' : undefined,
  });
}

const middleware: Connect.NextHandleFunction = (req, res: ServerResponse, next) => {
  const raw = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '';
  if (!raw.startsWith(LLM_PROXY_PREFIX)) return next();
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });
  void (async () => {
    try {
      const response = await handleLlmProxy(toWebRequest(req as IncomingMessage, abort));
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (!response.body) return res.end();
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch {
      if (!res.headersSent) res.statusCode = 502;
      res.end();
    }
  })();
};

export function llmProxyPlugin(): Plugin {
  return {
    name: 'flovart-llm-proxy',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
