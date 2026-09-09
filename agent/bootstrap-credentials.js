import crypto from 'node:crypto';

const DEFAULT_BOOTSTRAP_TTL_MS = 60_000;
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export class BootstrapCredentialError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BootstrapCredentialError';
    this.code = code;
  }

  toJSON() {
    return { code: this.code, message: this.message, retryable: this.code === 'BOOTSTRAP_EXPIRED' };
  }
}

/**
 * Ephemeral browser hand-off credentials. The persistent Agent token never
 * leaves the launcher process; the browser receives a one-use credential and
 * exchanges it for a short-lived session token.
 */
export class BootstrapCredentialStore {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.randomToken = options.randomToken || (() => crypto.randomBytes(32).toString('hex'));
    this.bootstrapTtlMs = options.bootstrapTtlMs || DEFAULT_BOOTSTRAP_TTL_MS;
    this.sessionTtlMs = options.sessionTtlMs || DEFAULT_SESSION_TTL_MS;
    this.bootstrap = new Map();
    this.sessions = new Map();
  }

  issue() {
    this.expire();
    const token = this.randomToken();
    const expiresAt = this.now() + this.bootstrapTtlMs;
    this.bootstrap.set(token, expiresAt);
    return { bootstrapToken: token, expiresAt };
  }

  exchange(token) {
    this.expire();
    const bootstrapToken = String(token || '');
    const bootstrapExpiresAt = this.bootstrap.get(bootstrapToken);
    if (!bootstrapExpiresAt) throw new BootstrapCredentialError('BOOTSTRAP_INVALID', 'Browser bootstrap credential 无效。');
    this.bootstrap.delete(bootstrapToken);
    if (bootstrapExpiresAt <= this.now()) throw new BootstrapCredentialError('BOOTSTRAP_EXPIRED', 'Browser bootstrap credential 已过期。');

    const sessionToken = this.randomToken();
    const expiresAt = this.now() + this.sessionTtlMs;
    this.sessions.set(sessionToken, expiresAt);
    return { sessionToken, expiresAt };
  }

  isSessionToken(token) {
    this.expire();
    const expiresAt = this.sessions.get(String(token || ''));
    return Boolean(expiresAt && expiresAt > this.now());
  }

  expire() {
    const now = this.now();
    for (const [token, expiresAt] of this.bootstrap) if (expiresAt <= now) this.bootstrap.delete(token);
    for (const [token, expiresAt] of this.sessions) if (expiresAt <= now) this.sessions.delete(token);
  }
}

export const bootstrapCredentialDefaults = Object.freeze({
  bootstrapTtlMs: DEFAULT_BOOTSTRAP_TTL_MS,
  sessionTtlMs: DEFAULT_SESSION_TTL_MS,
});
