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
