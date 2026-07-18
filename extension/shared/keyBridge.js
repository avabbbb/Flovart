// Flovart extension key storage compatibility layer.
//
// S0.2 deliberately removes the unauthenticated fixed-port desktop key API.
// Provider credentials remain extension-local until the typed Native Messaging
// provider flow is implemented; the extension never reads a desktop Keyring secret.

(function (global) {
  'use strict';

  const STORAGE_KEY_V2 = 'flovart_api_keys_v2';
  const STORAGE_KEY_OLD = 'flovart_user_api_keys';

  function runtimeUnavailable() {
    const error = new Error('桌面 Provider 通道尚未在安全 Native Messaging 协议中开放');
    error.code = 'RUNTIME_UNAVAILABLE';
    return error;
  }

  async function pingTauri() {
    return false;
  }

  async function isTauriAvailable() {
    return false;
  }

  function invalidateTauriCheck() {}

  async function tauriFetch() {
    throw runtimeUnavailable();
  }

  function ensureCrypto() {
    if (!global.FlovartCrypto) {
      throw new Error('FlovartCrypto 未加载 — 请先引入 shared/crypto.js');
    }
    return global.FlovartCrypto;
  }

  async function localLoadKeys() {
    if (!global.chrome?.storage?.local) return [];
    const result = await chrome.storage.local.get([STORAGE_KEY_V2, STORAGE_KEY_OLD]);
    if (result[STORAGE_KEY_V2]?.d) {
      const decoded = await ensureCrypto().decryptJson(result[STORAGE_KEY_V2].d);
      if (Array.isArray(decoded)) return decoded.map(key => ({ ...key, _source: 'local' }));
    }
    return Array.isArray(result[STORAGE_KEY_OLD])
      ? result[STORAGE_KEY_OLD].map(key => ({ ...key, _source: 'local' }))
      : [];
  }

  async function localSaveKeys(keys) {
    if (!global.chrome?.storage?.local) return;
    const encrypted = await ensureCrypto().encryptJson(keys);
    await chrome.storage.local.set({ [STORAGE_KEY_V2]: { d: encrypted, v: 3 } });
    await chrome.storage.local.remove(STORAGE_KEY_OLD);
  }

  async function listKeys(options = {}) {
    if (options.requireTauri) throw runtimeUnavailable();
    return localLoadKeys();
  }

  async function getKey(provider, keyId) {
    if (!provider || !keyId) return null;
    const keys = await localLoadKeys();
    return keys.find(key => (
      key.provider === provider && (key.id === keyId || key.keyId === keyId)
    )) || null;
  }

  async function saveKey(keyData) {
    if (!keyData?.provider) throw new Error('keyData.provider 是必填');
    if (typeof keyData.key !== 'string' || !keyData.key) {
      throw new Error('keyData.key (API secret) 是必填');
    }
    const { provider, keyId, id, key, ...rest } = keyData;
    const finalKeyId = keyId || id || ensureCrypto().generateId();
    const saved = {
      ...rest,
      provider,
      key,
      keyId: finalKeyId,
      id: finalKeyId,
      _source: 'local',
    };
    const keys = await localLoadKeys();
    await localSaveKeys([
      ...keys.filter(item => !(
        item.provider === provider && (item.id === finalKeyId || item.keyId === finalKeyId)
      )),
      saved,
    ]);
    return saved;
  }

  async function deleteKey(provider, keyId) {
    if (!provider || !keyId) throw new Error('provider / keyId 是必填');
    const keys = await localLoadKeys();
    const filtered = keys.filter(key => !(
      key.provider === provider && (key.id === keyId || key.keyId === keyId)
    ));
    if (filtered.length === keys.length) return { removed: false };
    await localSaveKeys(filtered);
    return { removed: true };
  }

  async function getDefaultKey({ capability = null } = {}) {
    const keys = await localLoadKeys();
    if (!keys.length) return null;
    let key = keys.find(item => item.isDefault) || keys[0];
    if (capability) {
      key = keys.find(item => (
        (Array.isArray(item.capabilities) && item.capabilities.includes(capability))
        || (capability === 'image' && item.provider === 'google')
      )) || key;
    }
    return key;
  }

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
