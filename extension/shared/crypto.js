// Flovart 共享加密 / 工具 — popup / content / service-worker 共用。
// 在浏览器上下文 (popup, content) 用 globalThis，service-worker 用 self。
//
// 用法：
//   <script src="../shared/crypto.js"></script>
//   const { encryptJson, decryptJson, generateId } = globalThis.FlovartCrypto;

(function (global) {
  'use strict';

  const ENC_SALT = 'flovart-ext-v3';
  const PBKDF2_ITERATIONS = 100000;
  const AES_KEY_LENGTH = 256;
  const IV_BYTES = 12;

  let cachedKeyPromise = null;

  // 派生 AES-GCM 密钥（per-extension-install，因为用 chrome.runtime.id 当 key material）
  // 同一个 service worker / popup session 内只算一次（PBKDF2 100k iterations 大约 1-2s）
  function getEncryptionKey() {
    if (cachedKeyPromise) return cachedKeyPromise;
    const enc = new TextEncoder();
    const runtimeId = (global.chrome && chrome.runtime && chrome.runtime.id) || 'flovart-fallback';
    cachedKeyPromise = crypto.subtle
      .importKey('raw', enc.encode(runtimeId), 'PBKDF2', false, ['deriveKey'])
      .then((keyMaterial) =>
        crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: enc.encode(ENC_SALT), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
          keyMaterial,
          { name: 'AES-GCM', length: AES_KEY_LENGTH },
          false,
          ['encrypt', 'decrypt']
        )
      );
    return cachedKeyPromise;
  }

  // 解密 chrome.storage 里的加密 blob，失败返回 null
  async function decryptJson(encoded) {
    if (!encoded) return null;
    try {
      if (encoded.iv && encoded.ct) {
        const aesKey = await getEncryptionKey();
        const iv = new Uint8Array(encoded.iv);
        const ct = new Uint8Array(encoded.ct);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
        return JSON.parse(new TextDecoder().decode(pt));
      }
      if (typeof encoded === 'string') {
        // 旧版 base64 混淆（无真实加密，保留以便迁移）
        const s = atob(encoded);
        const bytes = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
        return JSON.parse(new TextDecoder().decode(bytes));
      }
    } catch {
      return null;
    }
    return null;
  }

  // 加密成 { v: 3, iv: [...], ct: [...] } 格式
  async function encryptJson(data) {
    const aesKey = await getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const enc = new TextEncoder();
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      enc.encode(JSON.stringify(data))
    );
    return { v: 3, iv: Array.from(iv), ct: Array.from(new Uint8Array(ct)) };
  }

  function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `id_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  global.FlovartCrypto = {
    ENC_SALT,
    PBKDF2_ITERATIONS,
    getEncryptionKey,
    decryptJson,
    encryptJson,
    generateId,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
