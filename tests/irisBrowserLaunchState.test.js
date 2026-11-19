import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BROWSER_LAUNCH_PENDING_MS,
  clearBrowserLaunchState,
  isBrowserLaunchPending,
  readBrowserLaunchState,
  writeBrowserLaunchState,
} from '../tools/iris/browser-launch-state.js';

describe('Browser launch guard', () => {
  it('stores a short-lived, secret-free pending marker', () => {
    const directory = mkdtempSync(join(tmpdir(), 'iris-browser-launch-'));
    try {
      const env = { IRIS_BROWSER_LAUNCH_STATE: join(directory, 'browser-launch.json') };
      const connection = { url: 'http://127.0.0.1:17373', token: 'secret-token' };
      writeBrowserLaunchState({ frontendUrl: 'http://127.0.0.1:37522/#/app', connection, openedAt: 1000 }, env);
      const state = readBrowserLaunchState(env, 1000);
      expect(state).toMatchObject({ frontendUrl: 'http://127.0.0.1:37522', agentUrl: 'http://127.0.0.1:17373', openedAt: 1000 });
      expect(JSON.stringify(state)).not.toContain('secret-token');
      expect(isBrowserLaunchPending(state, { frontendUrl: 'http://127.0.0.1:37522', connection, now: 1001 })).toBe(true);
      expect(isBrowserLaunchPending(state, { frontendUrl: 'http://127.0.0.1:37522', connection: { ...connection, token: 'other' }, now: 1001 })).toBe(false);
      expect(readBrowserLaunchState(env, 1000 + BROWSER_LAUNCH_PENDING_MS + 1)).toBeNull();
      expect(clearBrowserLaunchState(env)).toBe(true);
      expect(readBrowserLaunchState(env, 1000)).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
