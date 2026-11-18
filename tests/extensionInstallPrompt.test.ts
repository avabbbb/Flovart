// @vitest-environment node
// 何时提示安装 / 配对插件：检测逻辑、"不再提醒"、代理与 429 触发（请求仍经代理照常完成）。
import { describe, expect, it, vi } from 'vitest';
import {
  EXTENSION_INSTALL_FALLBACK_URL,
  PROMPT_DISMISS_KEY,
  createExtensionPromptStore,
  decideExtensionPrompt,
  extensionInstallUrl,
  hasProxiedProvider,
  isProxyQuotaResponse,
  providerNeedsGatewayProxy,
  type ExtensionPromptInput,
} from '../services/extensionInstallPrompt';
import { createLlmProxyFetch } from '../services/llmCorsProxy';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));

const ORIGIN = 'https://flovart.avabbbb.com';
const base: ExtensionPromptInput = {
  reason: 'configured',
  status: 'not-installed',
  capable: false,
  dismissedForever: false,
  dismissedThisSession: false,
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (key: string) => data[key] ?? null, setItem: (key: string, value: string) => { data[key] = value; } };
}

describe('provider detection', () => {
  it('flags only gateways that need the proxy (OpenCode)', () => {
    expect(providerNeedsGatewayProxy('https://opencode.ai/zen/v1', ORIGIN)).toBe(true);
    expect(providerNeedsGatewayProxy(' https://opencode.ai/inference/go/openai/v1 ', ORIGIN)).toBe(true);
    expect(providerNeedsGatewayProxy('https://api.openai.com/v1', ORIGIN)).toBe(false);
    expect(providerNeedsGatewayProxy(undefined, ORIGIN)).toBe(false);
    expect(hasProxiedProvider([{ baseUrl: 'https://api.anthropic.com' }, {}], ORIGIN)).toBe(false);
    expect(hasProxiedProvider([{ baseUrl: 'https://api.anthropic.com' }, { baseUrl: 'https://opencode.ai/zen/v1' }], ORIGIN)).toBe(true);
  });

  it('treats 429 from the proxy as quota exhaustion', () => {
    expect(isProxyQuotaResponse({ status: 429 })).toBe(true);
    expect(isProxyQuotaResponse({ status: 500 })).toBe(false);
    expect(isProxyQuotaResponse(null)).toBe(false);
  });
});

describe('decideExtensionPrompt', () => {
  it('maps bridge status to the right action', () => {
    expect(decideExtensionPrompt(base)).toEqual({ show: true, action: 'install' });
    for (const status of ['none', 'rejected', 'revoked', 'disconnected'] as const) {
      expect(decideExtensionPrompt({ ...base, status }).action).toBe('pair');
    }
    expect(decideExtensionPrompt({ ...base, status: 'pending' }).action).toBe('approve');
    expect(decideExtensionPrompt({ ...base, status: 'approved' }).action).toBe('update');
    expect(decideExtensionPrompt({ ...base, status: 'unsupported' }).action).toBe('update');
  });

  it('stays hidden when not needed, already capable, undetectable, or on desktop', () => {
    expect(decideExtensionPrompt({ ...base, reason: null }).show).toBe(false);
    expect(decideExtensionPrompt({ ...base, status: 'approved', capable: true }).show).toBe(false);
    for (const status of ['unconfigured', 'idle', 'connecting'] as const) {
      expect(decideExtensionPrompt({ ...base, status }).show).toBe(false);
    }
    expect(decideExtensionPrompt({ ...base, isDesktop: true }).show).toBe(false);
  });

  it('respects dismissal: forever always wins; session dismissal yields only to quota', () => {
    expect(decideExtensionPrompt({ ...base, dismissedForever: true, reason: 'quota' }).show).toBe(false);
    expect(decideExtensionPrompt({ ...base, dismissedThisSession: true, reason: 'proxy' }).show).toBe(false);
    expect(decideExtensionPrompt({ ...base, dismissedThisSession: true, reason: 'quota' }).show).toBe(true);
  });
});

describe('extension prompt store', () => {
  it('escalates the reason and persists "don\'t remind again"', () => {
    const storage = memoryStorage();
    const store = createExtensionPromptStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);
    store.note('proxy');
    store.note('configured');
    expect(store.getState().reason).toBe('proxy');
    store.dismiss(false);
    expect(store.getState()).toMatchObject({ dismissedThisSession: true, dismissedForever: false });
    store.note('quota');
    expect(store.getState()).toMatchObject({ reason: 'quota', dismissedThisSession: false });
    store.dismiss(true);
    expect(storage.data[PROMPT_DISMISS_KEY]).toBe('1');
    expect(createExtensionPromptStore(storage).getState().dismissedForever).toBe(true);
    expect(listener).toHaveBeenCalled();
  });
});

describe('install URL', () => {
  it('picks the store for the browser and falls back to the README until published', () => {
    const chromeUa = 'Mozilla/5.0 Chrome/131.0 Safari/537.36';
    const edgeUa = 'Mozilla/5.0 Chrome/131.0 Safari/537.36 Edg/131.0';
    const urls = { chrome: 'https://chromewebstore.google.com/detail/x', edge: 'https://microsoftedge.microsoft.com/addons/detail/y' };
    expect(extensionInstallUrl(chromeUa, urls)).toBe(urls.chrome);
    expect(extensionInstallUrl(edgeUa, urls)).toBe(urls.edge);
    expect(extensionInstallUrl(edgeUa, { chrome: urls.chrome, edge: '' })).toBe(urls.chrome);
    expect(extensionInstallUrl(chromeUa, { chrome: '', edge: '' })).toBe(EXTENSION_INSTALL_FALLBACK_URL);
    expect(extensionInstallUrl(chromeUa, { chrome: 'javascript:alert(1)', edge: '' })).toBe(EXTENSION_INSTALL_FALLBACK_URL);
  });
});

describe('proxy transport hooks', () => {
  it('reports proxy use and 429 quota while still returning the proxy response', async () => {
    const onProxy = vi.fn();
    const nativeFetch = vi.fn(async () => new Response('slow down', { status: 429 }));
    const fetcher = createLlmProxyFetch({ nativeFetch: nativeFetch as any, origin: ORIGIN, getDirectBridge: () => null, onProxy });
    const response = await fetcher('https://opencode.ai/zen/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer k' }, body: '{}' });
    expect(response.status).toBe(429);
    expect(onProxy.mock.calls.map(call => call[0])).toEqual(['proxy', 'quota']);
  });

  it('does not report anything for non-gateway requests', async () => {
    const onProxy = vi.fn();
    const fetcher = createLlmProxyFetch({ nativeFetch: vi.fn(async () => new Response('ok')) as any, origin: ORIGIN, onProxy });
    await fetcher('https://api.openai.com/v1/models');
    expect(onProxy).not.toHaveBeenCalled();
  });

  it('a throwing hint never breaks the request', async () => {
    const fetcher = createLlmProxyFetch({
      nativeFetch: vi.fn(async () => new Response('ok')) as any,
      origin: ORIGIN,
      onProxy: () => { throw new Error('boom'); },
    });
    expect(await (await fetcher('https://opencode.ai/zen/v1/models')).text()).toBe('ok');
  });
});
