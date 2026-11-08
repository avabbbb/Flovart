import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

type BootstrapOptions = { location: { hash: string; search: string } };
const bootstrapSpy = vi.hoisted(() => vi.fn(async (_options: BootstrapOptions) => ({ state: 'ready' as const })));
vi.mock('../services/agentConnectionBootstrap', () => ({ bootstrapLocalAgentConnection: bootstrapSpy }));

import { DSH_EMBED_MESSAGE, installDshEmbedBridge, isDshEmbed, requestDshStartSession } from '../services/dshEmbedBridge';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

const ORIGIN = 'http' + '://127.0.0.1:5173';

function fakeWindow(search = '?embed=dsh') {
  const listeners = new Set<(event: MessageEvent) => void>();
  const parent = { postMessage: vi.fn() } as unknown as Window & { postMessage: Mock };
  const location = { origin: ORIGIN, pathname: '/flovart-app/', search, hash: '#/app' };
  const win = {
    location,
    parent,
    document,
    addEventListener: (_type: string, fn: (event: MessageEvent) => void) => { listeners.add(fn); },
    removeEventListener: (_type: string, fn: (event: MessageEvent) => void) => { listeners.delete(fn); },
  } as unknown as Window;
  const dispatch = (data: unknown, source: unknown = parent, origin = ORIGIN) => {
    for (const fn of listeners) fn({ data, source, origin } as MessageEvent);
  };
  return { win, parent, location, listeners, dispatch };
}

afterEach(() => {
  const root = document.documentElement;
  root.removeAttribute('data-dsh-embed');
  root.removeAttribute('data-color-scheme');
  root.removeAttribute('style');
  bootstrapSpy.mockClear();
});

describe('dshEmbedBridge', () => {
  it('detects the embed flag only from ?embed=dsh', () => {
    expect(isDshEmbed({ search: '?embed=dsh' })).toBe(true);
    expect(isDshEmbed({ search: '?embed=other' })).toBe(false);
    expect(isDshEmbed({ search: '' })).toBe(false);
  });

  it('stays inert for the standalone page', () => {
    const { win, listeners, parent } = fakeWindow('');
    installDshEmbedBridge(win);
    expect(listeners.size).toBe(0);
    expect(parent.postMessage).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute('data-dsh-embed')).toBe(false);
  });

  it('marks the root and announces readiness to the same-origin parent', () => {
    const { win, parent } = fakeWindow();
    const dispose = installDshEmbedBridge(win);
    expect(document.documentElement.dataset.dshEmbed).toBe('1');
    expect(parent.postMessage).toHaveBeenCalledWith({ type: DSH_EMBED_MESSAGE.ready }, ORIGIN);
    dispose();
  });

  it('applies only valid --dsw- tokens from the parent and drops stale ones', () => {
    const { win, dispatch } = fakeWindow();
    const dispose = installDshEmbedBridge(win);
    const root = document.documentElement;
    dispatch({ type: DSH_EMBED_MESSAGE.theme, scheme: 'dark', tokens: { '--dsw-alias-label-primary': '#fafafa', '--dsw-radius-md': '10px', '--other': 'red', '--dsw-bad': 'red; color: blue' } });
    expect(root.style.getPropertyValue('--dsw-alias-label-primary')).toBe('#fafafa');
    expect(root.style.getPropertyValue('--dsw-radius-md')).toBe('10px');
    expect(root.style.getPropertyValue('--other')).toBe('');
    expect(root.style.getPropertyValue('--dsw-bad')).toBe('');
    expect(root.dataset.colorScheme).toBe('dark');
    expect(useWorkspaceStore.getState().themeMode).toBe('dark');

    dispatch({ type: DSH_EMBED_MESSAGE.theme, scheme: 'light', tokens: { '--dsw-alias-label-primary': '#111111' } });
    expect(root.style.getPropertyValue('--dsw-radius-md')).toBe('');
    expect(root.style.getPropertyValue('--dsw-alias-label-primary')).toBe('#111111');
    expect(useWorkspaceStore.getState().themeMode).toBe('light');
    dispose();
  });

  it('ignores messages from another source or origin', () => {
    const { win, dispatch } = fakeWindow();
    const dispose = installDshEmbedBridge(win);
    const message = { type: DSH_EMBED_MESSAGE.theme, scheme: 'dark', tokens: { '--dsw-alias-link': '#00f' } };
    dispatch(message, {});
    dispatch(message, undefined, 'http' + '://127.0.0.1:9999');
    expect(document.documentElement.style.getPropertyValue('--dsw-alias-link')).toBe('');
    expect(document.documentElement.hasAttribute('data-color-scheme')).toBe(false);
    dispose();
  });

  it('maps the DSH locale onto the workspace language', () => {
    const { win, dispatch } = fakeWindow();
    const dispose = installDshEmbedBridge(win);
    dispatch({ type: DSH_EMBED_MESSAGE.locale, lang: 'en-US' });
    expect(useWorkspaceStore.getState().language).toBe('en');
    dispatch({ type: DSH_EMBED_MESSAGE.locale, lang: 'zh-CN' });
    expect(useWorkspaceStore.getState().language).toBe('zho');
    dispatch({ type: DSH_EMBED_MESSAGE.locale, lang: '<script>' });
    expect(useWorkspaceStore.getState().language).toBe('zho');
    dispose();
  });

  it('hands the one-time bootstrap token to the existing flow without touching the real URL', () => {
    const { win, dispatch, location } = fakeWindow();
    const dispose = installDshEmbedBridge(win);
    const agentUrl = 'http' + '://127.0.0.1:17372';
    dispatch({ type: DSH_EMBED_MESSAGE.bootstrap, agentUrl, bootstrapToken: 'one-time' });
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
    const options = bootstrapSpy.mock.lastCall?.[0];
    if (!options) throw new Error('bootstrapLocalAgentConnection was not called with options');
    const params = new URLSearchParams(options.location.hash.slice(options.location.hash.indexOf('?') + 1));
    expect(params.get('bootstrapToken')).toBe('one-time');
    expect(params.get('agentUrl')).toBe(agentUrl);
    expect(options.location.search).toBe('');
    expect(location.hash).toBe('#/app');
    expect(location.search).toBe('?embed=dsh');
    dispatch({ type: DSH_EMBED_MESSAGE.bootstrap, agentUrl, bootstrapToken: 'x' }, {});
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('asks the DSH parent to start a draft session with targetOrigin pinned', () => {
    const { win, parent } = fakeWindow();
    expect(requestDshStartSession('  make a poster  ', win)).toBe(true);
    expect(parent.postMessage).toHaveBeenCalledWith({ type: DSH_EMBED_MESSAGE.startSession, prompt: 'make a poster' }, ORIGIN);
    expect(requestDshStartSession('   ', win)).toBe(false);
    expect(requestDshStartSession('x', fakeWindow('').win)).toBe(false);
  });
});
