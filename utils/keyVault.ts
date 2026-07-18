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
 * 使用 origin + userAgent 与随机 salt 通过 PBKDF2 派生。
 * 这只保护浏览器静态存储，不等同于 Windows Credential Manager；
 * 同源脚本被攻破时仍可能代表用户使用 Secret。
 */
async function deriveKey(salt: Uint8Array): Promise<CryptoKey> {
    // 使用 origin + userAgent 作为伪设备指纹
    const passphrase = `${location.origin}::${navigator.userAgent}`;
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
    return btoa(String.fromCharCode(...packed));
}

export async function decryptKeys<T = unknown>(encoded: string): Promise<T | null> {
    try {
        const salt = await getOrCreateSalt();
        const key = await deriveKey(salt);
        const packed = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
        const iv = packed.slice(0, 12);
        const ciphertext = packed.slice(12);
        const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
        return JSON.parse(DECODER.decode(plaintext)) as T;
    } catch {
        return null;
    }
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
    if (vault) {
        const result = await decryptKeys<T>(vault);
        if (result !== null) return result;
    }
    return null;
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
