import { describe, expect, it } from 'vitest';
import { BootstrapCredentialError, BootstrapCredentialStore } from '../agent/bootstrap-credentials.js';

describe('browser bootstrap credentials', () => {
  it('is one-use and only produces a short-lived session credential', () => {
    let now = 10_000;
    let sequence = 0;
    const store = new BootstrapCredentialStore({ now: () => now, randomToken: () => `credential-${++sequence}`, bootstrapTtlMs: 100, sessionTtlMs: 500 });
    const issued = store.issue();
    const exchanged = store.exchange(issued.bootstrapToken);

    expect(exchanged.sessionToken).toBe('credential-2');
    expect(store.isSessionToken(exchanged.sessionToken)).toBe(true);
    expect(() => store.exchange(issued.bootstrapToken)).toThrow(BootstrapCredentialError);
  });

  it('expires unused bootstrap and session credentials', () => {
    let now = 10_000;
    const store = new BootstrapCredentialStore({ now: () => now, randomToken: () => String(now), bootstrapTtlMs: 100, sessionTtlMs: 500 });
    const issued = store.issue();
    now += 101;
    expect(() => store.exchange(issued.bootstrapToken)).toThrow(/无效/);

    now = 20_000;
    const next = store.issue();
    const session = store.exchange(next.bootstrapToken);
    now += 501;
    expect(store.isSessionToken(session.sessionToken)).toBe(false);
  });
});
