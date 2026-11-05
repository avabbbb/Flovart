// 网页画布同步来的 API Key（BYOK）。
// - 按画布 origin 分区存放，密文写 chrome.storage.local，明文只在内存中短暂存在。
// - AES-GCM 密钥由插件生成且不可导出，以 CryptoKey 对象形式存在 IndexedDB；拷走 storage 导出也解不开。
// - 每次写入带 revision；delta 的 baseRevision 对不上就拒绝，网页侧会改发全量 snapshot。
// - 配对被撤销或拒绝时清空该 origin 的全部 Key。
import { PAIRINGS_KEY, readPairings } from './web-pairings.js';

export const WEB_KEYS_KEY = 'flovartWebKeys';
export const REVISION_MISMATCH = 'keys.revision-mismatch';
const MAX_KEYS = 200;
const DB_NAME = 'flovart-extension';
const DB_STORE = 'crypto';
const CRYPTO_ID = 'web-keys-aes-gcm';

function limitedString(value, max) {
  return typeof value === 'string' && value && value.length <= max ? value : null;
}

// 只保留插件真正用得到的字段，其余一律丢弃。
export function sanitizeKeyEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = limitedString(entry.id, 128);
  const provider = limitedString(entry.provider, 64);
  const key = limitedString(entry.key, 4096);
  if (!id || !provider || !key) return null;
  const clean = { id, provider, key };
  const baseUrl = limitedString(entry.baseUrl, 2048);
  if (baseUrl) clean.baseUrl = baseUrl;
  const defaultModel = limitedString(entry.defaultModel, 256);
  if (defaultModel) clean.defaultModel = defaultModel;
  if (Array.isArray(entry.capabilities)) {
    clean.capabilities = entry.capabilities.filter(item => limitedString(item, 64)).slice(0, 16);
  }
  return clean;
}

export function sanitizeKeys(entries) {
  if (!Array.isArray(entries)) return [];
  const byId = new Map();
  for (const entry of entries) {
    const clean = sanitizeKeyEntry(entry);
    if (clean) byId.set(clean.id, clean);
  }
  return [...byId.values()].slice(0, MAX_KEYS);
}

function revisionOf(value) {
  if (!Number.isInteger(value) || value < 0) throw new Error('无效的 revision');
  return value;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function idb(run, mode) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const request = run(db.transaction(DB_STORE, mode).objectStore(DB_STORE));
      request.onsuccess = () => {
        resolve(request.result);
        db.close();
      };
      request.onerror = () => {
        reject(request.error);
        db.close();
      };
    };
  });
}

let defaultKeyPromise = null;

// 不可导出的 AES-GCM 密钥；首次使用时生成。若 IndexedDB 被清理，旧密文解不开，按空处理并等网页重发。
export function defaultCryptoKey() {
  defaultKeyPromise ||= (async () => {
    const existing = await idb(store => store.get(CRYPTO_ID), 'readonly');
    if (existing) return existing;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await idb(store => store.put(key, CRYPTO_ID), 'readwrite');
    return key;
  })().catch(error => {
    defaultKeyPromise = null;
    throw error;
  });
  return defaultKeyPromise;
}

export function createWebKeyStore({ storage, cryptoKey = defaultCryptoKey } = {}) {
  let chain = Promise.resolve();
  const area = () => {
    const resolved = storage || globalThis.chrome?.storage?.local;
    if (!resolved) throw new Error('chrome.storage.local 不可用');
    return resolved;
  };

  async function readAll() {
    const stored = await area().get(WEB_KEYS_KEY);
    const value = stored?.[WEB_KEYS_KEY];
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  // 串行化读-改-写，避免两个画布标签页同时同步时互相覆盖。
  function mutate(mutator) {
    const run = chain.then(async () => {
      const all = await readAll();
      const result = await mutator(all);
      await area().set({ [WEB_KEYS_KEY]: all });
      return result;
    });
    chain = run.catch(() => {});
    return run;
  }

  async function encryptRecord(revision, keys) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(keys));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(), plain);
    return { revision, iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(cipher)), count: keys.length, updatedAt: Date.now() };
  }

  async function decryptRecord(record) {
    if (!record || typeof record.iv !== 'string' || typeof record.ct !== 'string') return { revision: 0, keys: [] };
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
        await cryptoKey(),
        base64ToBytes(record.ct),
      );
      return { revision: Number.isInteger(record.revision) ? record.revision : 0, keys: sanitizeKeys(JSON.parse(new TextDecoder().decode(plain))) };
    } catch {
      return { revision: 0, keys: [] };
    }
  }

  return {
    async load(origin) {
      return decryptRecord((await readAll())[origin]);
    },

    // 合并所有已同步画布的 Key，供反推等插件内能力使用。
    async allKeys() {
      const all = await readAll();
      const merged = [];
      for (const origin of Object.keys(all)) merged.push(...(await decryptRecord(all[origin])).keys);
      return merged;
    },

    snapshot(origin, revision, keys) {
      const nextRevision = revisionOf(revision);
      return mutate(async all => {
        const clean = sanitizeKeys(keys);
        if (clean.length) all[origin] = await encryptRecord(nextRevision, clean);
        else delete all[origin];
        return { revision: nextRevision, count: clean.length };
      });
    },

    delta(origin, baseRevision, revision, upsert, remove) {
      const base = revisionOf(baseRevision);
      const nextRevision = revisionOf(revision);
      return mutate(async all => {
        const current = await decryptRecord(all[origin]);
        if (current.revision !== base) throw new Error(REVISION_MISMATCH);
        const removed = new Set(Array.isArray(remove) ? remove.filter(id => typeof id === 'string') : []);
        const byId = new Map(current.keys.filter(entry => !removed.has(entry.id)).map(entry => [entry.id, entry]));
        for (const entry of sanitizeKeys(upsert)) byId.set(entry.id, entry);
        const keys = [...byId.values()].slice(0, MAX_KEYS);
        all[origin] = await encryptRecord(nextRevision, keys);
        return { revision: nextRevision, count: keys.length };
      });
    },

    clear(origin) {
      return mutate(all => {
        delete all[origin];
        return { revision: 0, count: 0 };
      });
    },

    // 只保留仍处于已批准状态的 origin（启动时兜底，应对 Service Worker 休眠期间发生的撤销）。
    prune(approvedOrigins) {
      return mutate(all => {
        for (const origin of Object.keys(all)) if (!approvedOrigins.has(origin)) delete all[origin];
      });
    },
  };
}

function bodyOf(message) {
  return message?.payload && typeof message.payload === 'object' ? message.payload : message || {};
}

export function registerWebKeyHandlers(onWebMessage, store, chromeApi = globalThis.chrome) {
  onWebMessage('keys.snapshot', (message, { origin }) => {
    const body = bodyOf(message);
    return store.snapshot(origin, body.revision, body.keys);
  });
  onWebMessage('keys.delta', (message, { origin }) => {
    const body = bodyOf(message);
    return store.delta(origin, body.baseRevision, body.revision, body.upsert, body.remove);
  });
  onWebMessage('keys.clear', (_message, { origin }) => store.clear(origin));

  chromeApi?.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes[PAIRINGS_KEY]) return;
    const after = changes[PAIRINGS_KEY].newValue || {};
    const before = changes[PAIRINGS_KEY].oldValue || {};
    for (const origin of Object.keys(before)) {
      if (after[origin]?.status !== 'approved') void store.clear(origin);
    }
  });

  return readPairings()
    .then(pairings => store.prune(new Set(Object.keys(pairings).filter(origin => pairings[origin]?.status === 'approved'))))
    .catch(error => console.error('[Flovart Web Keys]', error));
}
