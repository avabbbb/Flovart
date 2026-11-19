export const LEGACY_STORAGE_KEYS = [
  'flovart_api_keys_v2',
  'flovart_user_api_keys',
  'flovart_pending_image',
  'flovart_pending_prompt',
  'flovart_collected_images',
  'flovart_last_reverse_prompt',
];

export async function purgeLegacyExtensionStorage(storage = globalThis.chrome?.storage?.local) {
  if (storage) await storage.remove(LEGACY_STORAGE_KEYS);
}

// 2026-11-20 Flovart → Iris 更名：chrome.storage 里的 key 改名。首次读取前把旧 key 复制到新 key，
// 新 key 已有值就不覆盖；旧 key 本版本保留不删（回滚旧版扩展仍可用）。
export const RENAMED_STORAGE_KEYS = [
  ['flovartWebKeys', 'irisWebKeys'],
  ['flovartWebPairings', 'irisWebPairings'],
  ['flovartImportHistory', 'irisImportHistory'],
  ['flovartBridgeStatus', 'irisBridgeStatus'],
];

export async function migrateRenamedExtensionStorage(storage = globalThis.chrome?.storage?.local) {
  if (!storage?.get || !storage?.set) return 0;
  let copied = 0;
  for (const [legacyKey, key] of RENAMED_STORAGE_KEYS) {
    const current = await storage.get(key);
    if (current?.[key] !== undefined) continue;
    const legacy = await storage.get(legacyKey);
    if (legacy?.[legacyKey] === undefined) continue;
    await storage.set({ [key]: legacy[legacyKey] });
    copied += 1;
  }
  return copied;
}

const renameMigrations = new WeakMap();

/** 每个 storage 区只迁移一次；读取配对 / Key 之前 await 它。失败不阻塞读取。 */
export function ensureRenamedExtensionStorage(storage) {
  if (!storage || typeof storage !== 'object') return Promise.resolve();
  let pending = renameMigrations.get(storage);
  if (!pending) {
    pending = migrateRenamedExtensionStorage(storage).catch(error => {
      console.error('[Iris Browser Import] 迁移旧 Flovart 扩展数据失败', error);
    });
    renameMigrations.set(storage, pending);
  }
  return pending;
}
