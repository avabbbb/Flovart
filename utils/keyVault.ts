/**
 * 浏览器 API Key 加密存储。
 * 密文与 salt 保存在 localforage/IndexedDB；桌面端后续由 Rust keyring adapter
 * 接管原始 Secret，不能把项目、媒体与 Secret 混进同一个 store。
 */
import localforage from 'localforage';

const vaultStorage = localforage.createInstance({
    name: 'flovart',
    storeName: 'provider_secret_vault',
});
const VAULT_STORAGE_KEY = 'api_keys';
const VAULT_SALT_KEY = 'salt';
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

async function getOrCreateSalt(): Promise<Uint8Array> {
    const existing = await vaultStorage.getItem<string>(VAULT_SALT_KEY);
    if (existing) {
        return Uint8Array.from(atob(existing), c => c.charCodeAt(0));
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await vaultStorage.setItem(VAULT_SALT_KEY, btoa(String.fromCharCode(...salt)));
    return salt;
}

/**
 * 派生加密密钥。
 * v2：origin + 随机 salt 经 PBKDF2 派生，不依赖 userAgent，浏览器升级后仍能解密。
 * legacy：旧版用 origin + userAgent，只用于读取旧密文，读出后立即以 v2 重写。
 * 这只保护浏览器静态存储，不等同于 Windows Credential Manager；
 * 同源脚本被攻破时仍可能代表用户使用 Secret。
 */
type KeyDerivation = 'v2' | 'legacy';
const V2_PREFIX = 'v2:';
const VAULT_UNREADABLE_KEY = 'api_keys.unreadable';

async function deriveKey(salt: Uint8Array, derivation: KeyDerivation = 'v2'): Promise<CryptoKey> {
    const passphrase = derivation === 'v2'
        ? 'flovart-vault-v2::' + location.origin
        : location.origin + '::' + navigator.userAgent;
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        ENCODER.encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100_000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

export async function encryptKeys(data: unknown): Promise<string> {
    const salt = await getOrCreateSalt();
    const key = await deriveKey(salt);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = ENCODER.encode(JSON.stringify(data));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    // Pack as: iv (12 bytes) + ciphertext
    const packed = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
    packed.set(iv, 0);
    packed.set(new Uint8Array(ciphertext), iv.length);
    return V2_PREFIX + btoa(String.fromCharCode(...packed));
}

async function decryptWith<T>(packedBase64: string, derivation: KeyDerivation): Promise<T | null> {
    try {
        const salt = await getOrCreateSalt();
        const key = await deriveKey(salt, derivation);
        const packed = Uint8Array.from(atob(packedBase64), c => c.charCodeAt(0));
        const iv = packed.slice(0, 12);
        const ciphertext = packed.slice(12);
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
        return JSON.parse(DECODER.decode(plaintext)) as T;
    } catch {
        return null;
    }
}

export async function decryptKeys<T = unknown>(encoded: string): Promise<T | null> {
    if (encoded.startsWith(V2_PREFIX)) return decryptWith<T>(encoded.slice(V2_PREFIX.length), 'v2');
    return decryptWith<T>(encoded, 'legacy');
}

/**
 * 持久化 API Key（加密后写入 localforage/IndexedDB）。
 */
export async function saveKeysEncrypted(keys: unknown): Promise<void> {
    const encrypted = await encryptKeys(keys);
    try {
        await vaultStorage.setItem(VAULT_STORAGE_KEY, encrypted);
    } catch (err) {
        console.error('[Storage] Failed to save encrypted keys', err);
    }
}

/**
 * 读取并解密 API Key。
 */
export async function loadKeysDecrypted<T = unknown>(): Promise<T | null> {
    const vault = await vaultStorage.getItem<string>(VAULT_STORAGE_KEY);
    if (!vault) return null;
    const result = await decryptKeys<T>(vault);
    if (result !== null) {
        // 旧派生（含 userAgent）的密文读出后立刻改写为 v2，下次浏览器升级不再读不出。
        if (!vault.startsWith(V2_PREFIX)) await saveKeysEncrypted(result);
        return result;
    }
    // 解不开（典型：浏览器升级改了 userAgent）：先留存原密文，之后的保存不会把唯一副本覆盖掉。
    if (!(await vaultStorage.getItem<string>(VAULT_UNREADABLE_KEY))) {
        await vaultStorage.setItem(VAULT_UNREADABLE_KEY, vault);
    }
    console.warn('[Storage] Encrypted API keys could not be decrypted; original ciphertext kept as backup.');
    return null;
}

/** 解密失败时留存的原密文；为空表示没有需要恢复的旧 Key。 */
export async function readUnreadableVaultBackup(): Promise<string | null> {
    return vaultStorage.getItem<string>(VAULT_UNREADABLE_KEY);
}

/**
 * 清除浏览器 Vault。调用方不应等待 beforeunload 才开始异步清理。
 */
export async function clearAllKeyData(): Promise<void> {
    await vaultStorage.clear();
}

/** 把当前开发版本的 localStorage Vault 一次性搬到 IndexedDB，避免升级时丢 Key。 */
export async function migrateLegacyKeys(): Promise<void> {
    if (await vaultStorage.getItem<string>(VAULT_STORAGE_KEY)) return;
    const encrypted = localStorage.getItem('userApiKeys.v1.vault');
    const salt = localStorage.getItem('vault.salt');
    if (encrypted && salt) {
        await vaultStorage.setItem(VAULT_SALT_KEY, salt);
        await vaultStorage.setItem(VAULT_STORAGE_KEY, encrypted);
        localStorage.removeItem('userApiKeys.v1.vault');
        localStorage.removeItem('vault.salt');
        localStorage.removeItem('userApiKeys.v1');
        return;
    }
    const legacy = localStorage.getItem('userApiKeys.v1');
    if (!legacy) return;
    try {
        const parsed = JSON.parse(legacy);
        await saveKeysEncrypted(parsed);
        localStorage.removeItem('userApiKeys.v1');
    } catch {
        // 损坏的开发数据保持原样，避免静默删除用户仍可能需要手工恢复的内容。
    }
}
