/**
 * Web-only fetch shim: route calls to LLM gateways that block browser CORS
 * (currently OpenCode Go / Zen at opencode.ai) through Flovart's same-origin
 * proxy `/api/llm-proxy/<host>/<path>`.
 *
 * - Desktop (Tauri) is untouched: native networking has no CORS.
 * - Every other provider is untouched: only hosts in PROXIED_HOSTS rewrite.
 * - OpenCode Go asks for a stable `x-opencode-session`; if the caller did not
 *   set one, a per-tab stable id is added so routing / prompt caching work.
 */
import { isTauri } from '@tauri-apps/api/core';

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

export function installLlmCorsProxy(): void {
  if (installed || !shouldInstallLlmCorsProxy()) return;
  installed = true;
  const nativeFetch = window.fetch.bind(window);
  const origin = window.location.origin;

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const proxied = toProxiedUrl(requestUrlOf(input), origin);
    if (!proxied) return nativeFetch(input, init);

    const base = input instanceof Request ? input : undefined;
    const headers = new Headers(init?.headers ?? base?.headers);
    if (!headers.has('x-opencode-session')) headers.set('x-opencode-session', getStableOpenCodeSessionId());

    const nextInit: RequestInit = {
      method: init?.method ?? base?.method,
      body: init?.body ?? (base ? base.body : undefined),
      signal: init?.signal ?? base?.signal,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    };
    if (nextInit.body && typeof ReadableStream !== 'undefined' && nextInit.body instanceof ReadableStream) {
      (nextInit as RequestInit & { duplex?: string }).duplex = 'half';
    }
    return nativeFetch(proxied, nextInit);
  };
}
