/**
 * Web-only fetch shim: route calls to LLM gateways that block browser CORS
 * (currently OpenCode Go / Zen at opencode.ai) through Flovart's same-origin
 * proxy `/api/llm-proxy/<host>/<path>`.
 *
 * - Desktop (Tauri) is untouched: native networking has no CORS.
 * - Every other provider is untouched: only hosts in PROXIED_HOSTS rewrite.
 * - OpenCode Go asks for a stable `x-opencode-session`; if the caller did not
 *   set one, a per-tab stable id is added so routing / prompt caching work.
 * - When the paired Flovart browser extension advertises `llm.fetch`, the same
 *   requests (and same-origin `/api/llm-proxy/...` calls such as the RunningHub
 *   docs) go straight to the upstream through the extension instead, so they do
 *   not cost Worker invocations. Any extension failure before the response head
 *   falls back to the proxy unchanged.
 */
import { isTauri } from '@tauri-apps/api/core';
import { getExtensionBridge } from './extensionBridge';
import {
  canUseExtensionDirect,
  extensionDirectFetch,
  ExtensionDirectUnavailableError,
  type DirectFetchRequest,
} from './extensionDirectFetch';

export const LLM_PROXY_PATH = '/api/llm-proxy/';
const PROXIED_HOSTS = new Set(['opencode.ai']);
const SESSION_STORAGE_KEY = 'flovart.opencodeSessionId';

let installed = false;

function createSessionId(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `ses_flovart_${rand}`;
}

export function getStableOpenCodeSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const next = createSessionId();
    sessionStorage.setItem(SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return (globalThis as { __flovartOpenCodeSession?: string }).__flovartOpenCodeSession ??=
      createSessionId();
  }
}

/** Returns the same-origin proxy URL for an allowlisted upstream, else null. */
export function toProxiedUrl(input: string, pageOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(input, pageOrigin);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !PROXIED_HOSTS.has(url.hostname.toLowerCase())) return null;
  return `${pageOrigin}${LLM_PROXY_PATH}${url.hostname.toLowerCase()}${url.pathname}${url.search}`;
}

function requestUrlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function shouldInstallLlmCorsProxy(): boolean {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return false;
  if (!/^https?:$/.test(window.location.protocol)) return false;
  try {
    if (isTauri()) return false;
  } catch {
    // not in Tauri
  }
  return import.meta.env?.VITE_LLM_PROXY !== 'off';
}

/** `/api/llm-proxy/<host>/<path>?q` on this origin → `https://<host>/<path>?q`; else null. */
export function upstreamFromProxyUrl(input: string, pageOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(input, pageOrigin);
  } catch {
    return null;
  }
  if (url.origin !== pageOrigin || !url.pathname.startsWith(LLM_PROXY_PATH)) return null;
  const rest = url.pathname.slice(LLM_PROXY_PATH.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  return `https://${rest.slice(0, slash).toLowerCase()}${rest.slice(slash)}${url.search}`;
}

export type LlmTransportMode = 'extension' | 'proxy';

type DirectBridge = Parameters<typeof extensionDirectFetch>[0];

export interface LlmProxyFetchOptions {
  nativeFetch: typeof fetch;
  origin: string;
  /** Paired extension bridge (or null). Called per request so pairing changes apply immediately. */
  getDirectBridge?: () => DirectBridge | null;
  /**
   * Called when a gateway request goes through the Worker proxy ('proxy'), and again when the
   * proxy answers 429 ('quota'). Used to suggest installing / pairing the extension; never blocks.
   */
  onProxy?: (reason: 'proxy' | 'quota') => void;
}

let lastTransport: LlmTransportMode | null = null;
/** Transport the most recent gateway request actually used (null before the first one). */
export function getLastLlmTransport(): LlmTransportMode | null {
  return lastTransport;
}

/** Transport the next gateway request will try first. */
export function getLlmTransportMode(bridge: DirectBridge | null = safeBridge()): LlmTransportMode {
  return canUseExtensionDirect(bridge) ? 'extension' : 'proxy';
}

function safeBridge(): DirectBridge | null {
  try {
    return getExtensionBridge();
  } catch {
    return null;
  }
}

async function bufferBody(body: BodyInit | null | undefined, headers: Headers, method: string): Promise<ArrayBuffer | undefined> {
  if (body == null || method === 'GET' || method === 'HEAD') return undefined;
  // Request normalizes every BodyInit (string, Blob, FormData, URLSearchParams, stream) and its implied content-type.
  const probe = new Request('https://flovart.invalid/', { method: 'POST', body, headers, duplex: 'half' } as RequestInit);
  const contentType = probe.headers.get('content-type');
  if (contentType && !headers.has('content-type')) headers.set('content-type', contentType);
  return probe.arrayBuffer();
}

/** The fetch replacement used on Web: extension direct when available, else the same-origin proxy. */
export function createLlmProxyFetch(options: LlmProxyFetchOptions): typeof fetch {
  const { nativeFetch, origin } = options;
  const viaProxy = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    lastTransport = 'proxy';
    try {
      options.onProxy?.('proxy');
    } catch {
      // the hint must never break the request
    }
    const response = await nativeFetch(input, init);
    if (response.status === 429) {
      try {
        options.onProxy?.('quota');
      } catch {
        // ignore
      }
    }
    return response;
  };
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = requestUrlOf(input);
    const proxied = toProxiedUrl(raw, origin);
    const fromProxyPath = proxied ? null : upstreamFromProxyUrl(raw, origin);
    if (!proxied && !fromProxyPath) return nativeFetch(input, init);

    const base = input instanceof Request ? input : undefined;
    const bridge = options.getDirectBridge?.() ?? null;
    const direct = canUseExtensionDirect(bridge);

    if (!direct && fromProxyPath) {
      // Already a proxy URL (e.g. RunningHub docs): unchanged behaviour.
      return viaProxy(input, init);
    }

    const headers = new Headers(init?.headers ?? base?.headers);
    if (proxied && !headers.has('x-opencode-session')) headers.set('x-opencode-session', getStableOpenCodeSessionId());
    const method = (init?.method ?? base?.method ?? 'GET').toUpperCase();
    const signal = init?.signal ?? base?.signal;
    let body: BodyInit | null | undefined = init?.body ?? (base ? base.body : undefined);

    if (direct && bridge) {
      // Buffer once so the proxy fallback can resend the same bytes.
      const buffered = await bufferBody(body, headers, method);
      body = buffered;
      const upstream = proxied ? new URL(raw, origin).toString() : fromProxyPath!;
      const request: DirectFetchRequest = { url: upstream, method, headers, body: buffered, signal };
      try {
        const response = await extensionDirectFetch(bridge, request);
        lastTransport = 'extension';
        return response;
      } catch (error) {
        if (!(error instanceof ExtensionDirectUnavailableError)) throw error;
        // Extension refused or failed before the first byte: fall back to the proxy.
      }
    }

    const nextInit: RequestInit = {
      method,
      body,
      signal,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    };
    if (nextInit.body && typeof ReadableStream !== 'undefined' && nextInit.body instanceof ReadableStream) {
      (nextInit as RequestInit & { duplex?: string }).duplex = 'half';
    }
    return viaProxy(proxied ?? new URL(raw, origin).toString(), nextInit);
  };
}

export function installLlmCorsProxy(hooks: Pick<LlmProxyFetchOptions, 'onProxy'> = {}): void {
  if (installed || !shouldInstallLlmCorsProxy()) return;
  installed = true;
  window.fetch = createLlmProxyFetch({
    nativeFetch: window.fetch.bind(window),
    origin: window.location.origin,
    getDirectBridge: safeBridge,
    onProxy: hooks.onProxy,
  });
}
