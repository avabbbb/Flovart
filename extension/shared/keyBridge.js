// Flovart 扩展 ↔ Tauri 桌面端 key 桥。
//
// 真源策略：Tauri 桌面端 (127.0.0.1:7421) 是 API key 权威存储（走 OS keyring）。
// 扩展本身只做 UI 透传 + chrome.storage 离线 fallback。
//
// 用法：
//   <script src="../shared/crypto.js"></script>
//   <script src="../shared/keyBridge.js"></script>
//   const { listKeys, getKey, saveKey, deleteKey, getDefaultKey, isTauriAvailable }
//     = globalThis.FlovartKeyBridge;
//
// 返回的 key 对象统一带 _source 字段：'tauri' | 'local'。
// Tauri 模式下列表只含元数据（provider, keyId, label, updatedAt），
// 调 getKey(provider, keyId) 或 getDefaultKey() 才会拉 secret。

(function (global) {
  'use strict';

  const TAURI_BASE = 'http://127.0.0.1:7421';
  const STORAGE_KEY_V2 = 'flovart_api_keys_v2';
  const STORAGE_KEY_OLD = 'flovart_user_api_keys';
  const TAURI_CHECK_TTL_MS = 30_000;
  const TAURI_CHECK_TIMEOUT_MS = 1500;

  const state = {
    tauriAvailable: null,
    tauriLastCheck: 0,
  };

  // ─── Tauri 健康检查 ──────────────────────────────────────────────
  async function pingTauri(timeoutMs = TAURI_CHECK_TIMEOUT_MS) {
    if (!global.fetch) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(`${TAURI_BASE}/status`, { signal: controller.signal });
      return resp.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function isTauriAvailable(force = false) {
    const now = Date.now();
    if (!force && state.tauriAvailable !== null && now - state.tauriLastCheck < TAURI_CHECK_TTL_MS) {
      return state.tauriAvailable;
    }
    state.tauriAvailable = await pingTauri();
    state.tauriLastCheck = now;
    return state.tauriAvailable;
  }

  function invalidateTauriCheck() {
    state.tauriAvailable = null;
    state.tauriLastCheck = 0;
  }

  // ─── Tauri HTTP 客户端 ──────────────────────────────────────────
  async function tauriFetch(path, method = 'GET', body = null) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body !== null && body !== undefined) opts.body = JSON.stringify(body);
    let resp;
    try {
      resp = await fetch(`${TAURI_BASE}${path}`, opts);
    } catch (e) {
      const err = new Error(`Tauri 不可达 (${TAURI_BASE}): ${e.message || e}`);
      err.code = 'TAURI_UNREACHABLE';
      throw err;
    }
    const text = await resp.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { ok: false, error: text }; }
    }
    if (!resp.ok) {
      const err = new Error((payload && payload.error) || `Tauri HTTP ${resp.status}`);
      err.code = (payload && payload.code) || 'TAURI_HTTP_ERROR';
      err.status = resp.status;
      throw err;
    }
    return payload;
  }

  // ─── Tauri 侧 key 操作 ──────────────────────────────────────────
  function normalizeTauriEntry(e) {
    return {
      provider: e.provider,
      keyId: e.key_id,
      id: e.key_id,
      label: e.label || null,
      updatedAt: e.updated_at || 0,
      _source: 'tauri',
      _hasSecret: true,
    };
  }

  async function tauriListKeys() {
    const list = await tauriFetch('/state/keys');
    if (!Array.isArray(list)) return [];
    return list.map(normalizeTauriEntry);
  }

  async function tauriGetSecret(provider, keyId) {
    const resp = await tauriFetch(
      `/state/keys/${encodeURIComponent(provider)}/${encodeURIComponent(keyId)}`
    );
    return (resp && resp.secret) || null;
  }

  async function tauriSaveKey({ provider, keyId, secret, label }) {
    if (!provider || !keyId || typeof secret !== 'string') {
      throw new Error('provider / keyId / secret 都是必填');
    }
    const resp = await tauriFetch('/state/keys', 'POST', {
      provider, key_id: keyId, secret, label: label || null,
    });
    return normalizeTauriEntry(resp);
  }

  function toTauriEntry(userKey) {
    return {
      provider: userKey.provider,
      keyId: userKey.keyId || userKey.id,
      secret: userKey.key,
      label: userKey.label || userKey.name || null,
    };
  }

  async function tauriDeleteKey(provider, keyId) {
    return tauriFetch(
      `/state/keys/${encodeURIComponent(provider)}/${encodeURIComponent(keyId)}`,
      'DELETE'
    );
  }

  // ─── chrome.storage 离线 fallback ──────────────────────────────
  function ensureCrypto() {
    if (!global.FlovartCrypto) {
      throw new Error('FlovartCrypto 未加载 — 请先引入 shared/crypto.js');
    }
    return global.FlovartCrypto;
  }

  async function localLoadKeys() {
    if (!global.chrome || !chrome.storage || !chrome.storage.local) return [];
    const result = await chrome.storage.local.get([STORAGE_KEY_V2, STORAGE_KEY_OLD]);
    if (result[STORAGE_KEY_V2] && result[STORAGE_KEY_V2].d) {
      const decoded = await ensureCrypto().decryptJson(result[STORAGE_KEY_V2].d);
      if (Array.isArray(decoded)) {
        return decoded.map((k) => ({ ...k, _source: 'local' }));
      }
    }
    const old = result[STORAGE_KEY_OLD];
    if (Array.isArray(old)) {
      return old.map((k) => ({ ...k, _source: 'local' }));
    }
    return [];
  }

  async function localSaveKeys(keys) {
    if (!global.chrome || !chrome.storage || !chrome.storage.local) return;
    const Crypto = ensureCrypto();
    const encrypted = await Crypto.encryptJson(keys);
    await chrome.storage.local.set({ [STORAGE_KEY_V2]: { d: encrypted, v: 3 } });
    // 清理旧 key
    await chrome.storage.local.remove(STORAGE_KEY_OLD);
  }

  async function localDeleteKey(provider, keyId) {
    const keys = await localLoadKeys();
    const filtered = keys.filter(
      (k) => !(k.provider === provider && (k.id === keyId || k.keyId === keyId))
    );
    if (filtered.length === keys.length) return { removed: false };
    await localSaveKeys(filtered);
    return { removed: true };
  }

  // ─── 统一 API ──────────────────────────────────────────────────
  async function listKeys(opts = {}) {
    const { preferTauri = true, requireTauri = false } = opts;
    if (requireTauri) {
      if (!(await isTauriAvailable(true))) {
        const err = new Error('Tauri 桌面端未运行');
        err.code = 'TAURI_UNREACHABLE';
        throw err;
      }
      return tauriListKeys();
    }
    if (preferTauri && (await isTauriAvailable())) {
      try { return await tauriListKeys(); } catch { /* fall through to local */ }
    }
    return localLoadKeys();
  }

  async function getKey(provider, keyId, opts = {}) {
    if (!provider || !keyId) return null;
    const { preferTauri = true } = opts;
    if (preferTauri && (await isTauriAvailable())) {
      try {
        const meta = await tauriListKeys();
        const found = meta.find(
          (k) => k.provider === provider && (k.keyId === keyId || k.id === keyId)
        );
        if (!found) return null;
        const secret = await tauriGetSecret(provider, found.keyId);
        if (secret === null) return null;
        return { ...found, key: secret };
      } catch { /* fall through to local */ }
    }
    const keys = await localLoadKeys();
    return (
      keys.find(
        (k) => k.provider === provider && (k.id === keyId || k.keyId === keyId)
      ) || null
    );
  }

  function pickKeyId(existing, keyData) {
    if (existing && (existing.keyId || existing.id)) return existing.keyId || existing.id;
    if (keyData.keyId) return keyData.keyId;
    if (keyData.id) return keyData.id;
    return ensureCrypto().generateId();
  }

  async function saveKey(keyData, opts = {}) {
    if (!keyData || !keyData.provider) {
      throw new Error('keyData.provider 是必填');
    }
    if (typeof keyData.key !== 'string' || keyData.key.length === 0) {
      throw new Error('keyData.key (API secret) 是必填');
    }
    const { preferTauri = true, forceLocal = false } = opts;
    const { provider, keyId, id, key, ...rest } = keyData;
    const finalKeyId = keyId || id || ensureCrypto().generateId();
    const userKey = {
      ...rest,
      provider,
      key,
      keyId: finalKeyId,
      id: finalKeyId,
    };

    if (!forceLocal && preferTauri && (await isTauriAvailable())) {
      try {
        const saved = await tauriSaveKey(toTauriEntry(userKey));
        return { ...userKey, ...saved, _source: 'tauri' };
      } catch (e) {
        console.warn('[Flovart] Tauri save failed, falling back to local:', e);
        invalidateTauriCheck();
      }
    }
    const keys = await localLoadKeys();
    const filtered = keys.filter(
      (k) => !(k.provider === provider && (k.id === finalKeyId || k.keyId === finalKeyId))
    );
    filtered.push({ ...userKey, _source: 'local' });
    await localSaveKeys(filtered);
    return { ...userKey, _source: 'local' };
  }

  async function deleteKey(provider, keyId, opts = {}) {
    if (!provider || !keyId) {
      throw new Error('provider / keyId 是必填');
    }
    const { preferTauri = true } = opts;
    if (preferTauri && (await isTauriAvailable())) {
      try { return await tauriDeleteKey(provider, keyId); } catch { /* fall through */ }
    }
    return localDeleteKey(provider, keyId);
  }

  // ─── 默认 key 解析（给 content script 反推 prompt 用）─────────
  async function getDefaultKey({ capability = null } = {}) {
    const keys = await listKeys();
    if (keys.length === 0) return null;

    let key = keys.find((k) => k.isDefault) || keys[0];

    if (capability) {
      const capKey = keys.find(
        (k) =>
          (Array.isArray(k.capabilities) && k.capabilities.includes(capability)) ||
          (capability === 'image' && k.provider === 'google')
      );
      if (capKey) key = capKey;
    }

    if (key._source === 'tauri') {
      try {
        const secret = await tauriGetSecret(key.provider, key.keyId);
        if (!secret) return null;
        return { ...key, key: secret };
      } catch {
        return null;
      }
    }
    return key;
  }

  // ─── Provider 能力默认值（与 Web App DEFAULT_PROVIDER_MODELS 对齐） ──
  const PROVIDER_CAPABILITIES = {
    google: ['text', 'image', 'video'],
    openai: ['text', 'image'],
    openrouter: ['text', 'image'],
    deepseek: ['text'],
    siliconflow: ['text'],
    anthropic: ['text'],
    minimax: ['text', 'image', 'video'],
    volcengine: ['text'],
    qwen: ['text'],
    custom: ['text', 'image', 'video'],
  };

  global.FlovartKeyBridge = {
    TAURI_BASE,
    isTauriAvailable,
    pingTauri,
    invalidateTauriCheck,
    listKeys,
    getKey,
    saveKey,
    deleteKey,
    getDefaultKey,
    tauriFetch,
    PROVIDER_CAPABILITIES,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
