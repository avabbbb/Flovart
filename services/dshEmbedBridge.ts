// DSH Desktop embed bridge. Active only when the page is loaded with ?embed=dsh
// inside a same-origin DSH iframe. It accepts theme, locale and bootstrap messages
// from window.parent only (source and origin checked) and never sees the
// persistent Operator token: the host hands over a one-time bootstrap token.
import { bootstrapLocalAgentConnection } from './agentConnectionBootstrap';
import { detectWorkspaceLanguage, useWorkspaceStore } from '../stores/useWorkspaceStore';

export const DSH_EMBED_MESSAGE = Object.freeze({
  ready: 'flovart:dsh-ready',
  theme: 'flovart:dsh-theme',
  locale: 'flovart:dsh-locale',
  bootstrap: 'flovart:dsh-bootstrap',
  startSession: 'flovart:start-session',
});

const TOKEN_NAME = /^--dsw-[a-z0-9-]+$/i;
const UNSAFE_TOKEN_VALUE = /[;{}<>]/;
const MAX_TOKEN_VALUE = 256;
const MAX_TOKENS = 400;
const LANG_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,4}$/;
const MAX_PROMPT = 20000;

type EmbedWindow = Pick<Window, 'location' | 'parent' | 'document' | 'addEventListener' | 'removeEventListener'>;
type Payload = Record<string, unknown>;

export function isDshEmbed(location: Pick<Location, 'search'> | null = typeof window === 'undefined' ? null : window.location): boolean {
  if (!location) return false;
  try { return new URLSearchParams(location.search || '').get('embed') === 'dsh'; }
  catch { return false; }
}

function embeddedParent(win: EmbedWindow): Window | null {
  const self = win.document.defaultView;
  return win.parent && win.parent !== self ? win.parent : null;
}

function trustedPayload(event: MessageEvent, win: EmbedWindow): Payload | null {
  const parent = embeddedParent(win);
  if (!parent || event.source !== parent || event.origin !== win.location.origin) return null;
  return typeof event.data === 'object' && event.data !== null ? Object.fromEntries(Object.entries(event.data)) : null;
}

export function applyDshTheme(root: HTMLElement, data: Payload, applied: Set<string>): boolean {
  const scheme = data.scheme;
  if (scheme !== 'light' && scheme !== 'dark') return false;
  const tokens = typeof data.tokens === 'object' && data.tokens !== null ? Object.entries(data.tokens) : [];
  const next = new Set<string>();
  for (const [name, value] of tokens.slice(0, MAX_TOKENS)) {
    if (!TOKEN_NAME.test(name) || typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_TOKEN_VALUE || UNSAFE_TOKEN_VALUE.test(trimmed)) continue;
    root.style.setProperty(name, trimmed);
    next.add(name);
  }
  for (const name of applied) if (!next.has(name)) root.style.removeProperty(name);
  applied.clear();
  for (const name of next) applied.add(name);
  root.dataset.colorScheme = scheme;
  useWorkspaceStore.getState().setThemeMode(scheme);
  return true;
}

export function applyDshLocale(root: HTMLElement, data: Payload): boolean {
  const lang = typeof data.lang === 'string' ? data.lang.trim() : '';
  if (!LANG_TAG.test(lang)) return false;
  root.lang = lang;
  useWorkspaceStore.getState().setLanguage(detectWorkspaceLanguage(lang));
  return true;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function loopbackAgentUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

// Name and code only: a message or stack may echo the synthetic URL that carries the one-time token.
export function safeErrorLabel(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  const code = 'code' in error && typeof error.code === 'string' ? ' ' + error.code : '';
  return error.name + code;
}

export function startDshBootstrap(win: EmbedWindow, data: Payload) {
  const agentUrl = typeof data.agentUrl === 'string' ? loopbackAgentUrl(data.agentUrl.trim()) : null;
  const bootstrapToken = typeof data.bootstrapToken === 'string' ? data.bootstrapToken.trim() : '';
  if (!agentUrl || !bootstrapToken) return null;
  // Synthetic location: the one-time token reaches the existing bootstrap flow
  // without ever being written into the real URL or history.
  const hash = '#/app?' + new URLSearchParams({ agentUrl, bootstrapToken }).toString();
  const { origin, pathname, search } = win.location;
  return bootstrapLocalAgentConnection({
    location: { href: origin + pathname + search + hash, search: '', hash, pathname },
    history: { replaceState: () => undefined },
  });
}

export function requestDshStartSession(prompt: string, win: EmbedWindow = window): boolean {
  const text = String(prompt || '').trim().slice(0, MAX_PROMPT);
  const parent = embeddedParent(win);
  if (!text || !parent || !isDshEmbed(win.location)) return false;
  parent.postMessage({ type: DSH_EMBED_MESSAGE.startSession, prompt: text }, win.location.origin);
  return true;
}

export function installDshEmbedBridge(win: EmbedWindow = window): () => void {
  const parent = embeddedParent(win);
  if (!parent || !isDshEmbed(win.location)) return () => undefined;
  const root = win.document.documentElement;
  root.dataset.dshEmbed = '1';
  const appliedTokens = new Set<string>();
  const onMessage = (event: MessageEvent) => {
    const data = trustedPayload(event, win);
    if (!data) return;
    if (data.type === DSH_EMBED_MESSAGE.theme) applyDshTheme(root, data, appliedTokens);
    else if (data.type === DSH_EMBED_MESSAGE.locale) applyDshLocale(root, data);
    else if (data.type === DSH_EMBED_MESSAGE.bootstrap) {
      void startDshBootstrap(win, data)?.catch(error => console.warn('Flovart DSH embed bootstrap unavailable.', safeErrorLabel(error)));
    }
  };
  win.addEventListener('message', onMessage);
  parent.postMessage({ type: DSH_EMBED_MESSAGE.ready }, win.location.origin);
  return () => win.removeEventListener('message', onMessage);
}
