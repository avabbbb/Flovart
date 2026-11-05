import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AGENT_DIR } from './config.js';

// Same keyring service as src-tauri/src/keyring.rs (KEYRING_SERVICE) so the
// desktop Runtime and the Node Agent read and write the same OS entries.
export const KEYRING_SERVICE = 'com.flovart.desktop';
const METADATA_FILE = 'credentials.json';
const MAX_SECRET_LENGTH = 8192;

export class CredentialError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CredentialError';
    this.code = code;
  }

  toJSON() {
    return { code: this.code, message: this.message, retryable: this.code === 'KEYRING_UNAVAILABLE' };
  }
}

export function entryAccount(provider, keyId) {
  return `${provider}:${keyId}`;
}

/** Mirrors validate_keyring_inputs in keyring.rs: no ':' injection, bounded lengths. */
export function validateCredentialInput({ provider, keyId, label } = {}) {
  const normalizedProvider = String(provider ?? '');
  const normalizedKeyId = String(keyId ?? '');
  if (!normalizedProvider || normalizedProvider.length > 128) throw new CredentialError('INVALID_INPUT', 'provider must be 1-128 characters');
  if (normalizedProvider.includes(':')) throw new CredentialError('INVALID_INPUT', "provider must not contain ':'");
  if (!normalizedKeyId || normalizedKeyId.length > 256) throw new CredentialError('INVALID_INPUT', 'keyId must be 1-256 characters');
  if (normalizedKeyId.includes(':')) throw new CredentialError('INVALID_INPUT', "keyId must not contain ':'");
  const normalizedLabel = label == null || label === '' ? null : String(label);
  if (normalizedLabel && normalizedLabel.length > 256) throw new CredentialError('INVALID_INPUT', 'label must not exceed 256 characters');
  return { provider: normalizedProvider, keyId: normalizedKeyId, label: normalizedLabel };
}

export function maskSecret(secret) {
  const value = String(secret || '');
  return value.length <= 8 ? '****' : `****${value.slice(-4)}`;
}

const isNoEntry = error => /no (matching )?entry|not found|NoEntry/i.test(String(error?.message || error));

async function loadNativeKeyring() {
  let Entry;
  try {
    const mod = await import('@napi-rs/keyring');
    Entry = mod.Entry || mod.default?.Entry;
  } catch (error) {
    throw new CredentialError('KEYRING_UNAVAILABLE', `操作系统 keyring 不可用：${error?.message || error}`);
  }
  if (typeof Entry !== 'function') throw new CredentialError('KEYRING_UNAVAILABLE', '操作系统 keyring 不可用：@napi-rs/keyring 缺少 Entry 导出。');
  return {
    set(service, account, secret) {
      new Entry(service, account).setPassword(secret);
    },
    get(service, account) {
      try {
        return new Entry(service, account).getPassword() ?? null;
      } catch (error) {
        if (isNoEntry(error)) return null;
        throw error;
      }
    },
    delete(service, account) {
      try {
        return new Entry(service, account).deletePassword() !== false;
      } catch (error) {
        if (isNoEntry(error)) return false;
        throw error;
      }
    },
  };
}

const toPublic = entry => ({
  provider: entry.provider,
  keyId: entry.keyId,
  label: entry.label ?? null,
  mask: entry.mask,
  updatedAt: entry.updatedAt,
});

/**
 * Agent-side credential vault. Secrets live only in the OS keyring
 * (service com.flovart.desktop, account provider:keyId). The metadata file
 * under <agent home>/agent-runtime/ holds provider, keyId, label, mask and
 * timestamp, never the secret. HTTP callers only ever see the masked view;
 * readSecret is for in-process Runtime executors.
 */
export class AgentCredentialStore {
  constructor(options = {}) {
    this.dir = options.dir || path.join(AGENT_DIR, 'agent-runtime');
    this.file = path.join(this.dir, METADATA_FILE);
    this.service = options.service || KEYRING_SERVICE;
    this.now = options.now || (() => Date.now());
    this.backendPromise = options.backend ? Promise.resolve(options.backend) : null;
    this.lastSync = null;
    this.queue = Promise.resolve();
  }

  backend() {
    if (!this.backendPromise) {
      const pending = loadNativeKeyring();
      // A failed load is retried on the next call instead of being cached.
      pending.catch(() => { if (this.backendPromise === pending) this.backendPromise = null; });
      this.backendPromise = pending;
    }
    return this.backendPromise;
  }

  serialize(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  async readMetadata() {
    let raw;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw new CredentialError('METADATA_UNAVAILABLE', `凭证元数据读取失败：${error?.message || error}`);
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.entries) ? parsed.entries : [];
    } catch (error) {
      throw new CredentialError('METADATA_UNAVAILABLE', `凭证元数据损坏：${error?.message || error}`);
    }
  }

  async writeMetadata(entries) {
    await fs.mkdir(this.dir, { recursive: true });
    const tempFile = path.join(this.dir, `.${METADATA_FILE}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    try {
      await fs.writeFile(tempFile, JSON.stringify({ version: 1, entries }, null, 2), 'utf8');
      await fs.rename(tempFile, this.file);
    } catch (error) {
      await fs.rm(tempFile, { force: true }).catch(() => {});
      throw new CredentialError('METADATA_UNAVAILABLE', `凭证元数据写入失败：${error?.message || error}`);
    }
  }

  set(input = {}) {
    return this.serialize(async () => {
      const { provider, keyId, label } = validateCredentialInput(input);
      const secret = typeof input.secret === 'string' ? input.secret.trim() : '';
      if (!secret || secret.length > MAX_SECRET_LENGTH) throw new CredentialError('INVALID_INPUT', `secret must be 1-${MAX_SECRET_LENGTH} characters`);
      const backend = await this.backend();
      try {
        backend.set(this.service, entryAccount(provider, keyId), secret);
      } catch (error) {
        throw new CredentialError('KEYRING_UNAVAILABLE', `写入操作系统 keyring 失败：${error?.message || error}`);
      }
      const entry = { provider, keyId, label, mask: maskSecret(secret), updatedAt: this.now() };
      const entries = (await this.readMetadata()).filter(item => !(item.provider === provider && item.keyId === keyId));
      entries.push(entry);
      await this.writeMetadata(entries);
      return toPublic(entry);
    });
  }

  delete(input = {}) {
    return this.serialize(async () => {
      const { provider, keyId } = validateCredentialInput(input);
      const backend = await this.backend();
      let removed;
      try {
        removed = backend.delete(this.service, entryAccount(provider, keyId));
      } catch (error) {
        throw new CredentialError('KEYRING_UNAVAILABLE', `删除操作系统 keyring 条目失败：${error?.message || error}`);
      }
      const entries = await this.readMetadata();
      const remaining = entries.filter(item => !(item.provider === provider && item.keyId === keyId));
      if (remaining.length !== entries.length) await this.writeMetadata(remaining);
      return Boolean(removed) || remaining.length !== entries.length;
    });
  }

  async list(provider) {
    const entries = await this.readMetadata();
    return entries.filter(entry => !provider || entry.provider === provider).map(toPublic);
  }

  /** In-process only: never expose over HTTP or CLI output. */
  async readSecret(provider, keyId) {
    const normalized = validateCredentialInput({ provider, keyId });
    const backend = await this.backend();
    try {
      return backend.get(this.service, entryAccount(normalized.provider, normalized.keyId));
    } catch (error) {
      throw new CredentialError('KEYRING_UNAVAILABLE', `读取操作系统 keyring 失败：${error?.message || error}`);
    }
  }

  reportSync({ credentialCount, persistenceEnabled } = {}) {
    this.lastSync = {
      credentialCount: Math.max(0, Number(credentialCount) || 0),
      persistenceEnabled: persistenceEnabled !== false,
      syncedAt: this.now(),
    };
    return this.lastSync;
  }

  async status() {
    let available = true;
    let error = null;
    try {
      await this.backend();
    } catch (cause) {
      available = false;
      error = cause instanceof CredentialError ? cause.toJSON() : { code: 'KEYRING_UNAVAILABLE', message: String(cause?.message || cause) };
    }
    const entries = await this.list().catch(() => []);
    return {
      keyring: { available, service: this.service, error },
      count: entries.length,
      providers: [...new Set(entries.map(entry => entry.provider))],
      lastSync: this.lastSync,
    };
  }
}
