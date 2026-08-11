import { describe, expect, it, vi } from 'vitest';
import {
  CHUNK_BYTES,
  bytesToBase64,
  exactOptionalOrigin,
  provenanceUrl,
  sha256Hex,
  splitImportBytes,
} from '../extension/background/import-protocol.js';
import {
  LEGACY_STORAGE_KEYS,
  purgeLegacyExtensionStorage,
} from '../extension/background/storage-migration.js';

describe('thin extension Native Import protocol', () => {
  it('splits bytes below the Native Messaging frame limit and preserves exact bytes', () => {
    const bytes = Uint8Array.from({ length: CHUNK_BYTES * 2 + 17 }, (_, index) => index % 251);
    const chunks = [...splitImportBytes(bytes)];

    expect(chunks.map(chunk => chunk.length)).toEqual([CHUNK_BYTES, CHUNK_BYTES, 17]);
    const decoded = chunks.flatMap(chunk => [...Uint8Array.from(atob(bytesToBase64(chunk)), char => char.charCodeAt(0))]);
    expect(decoded).toEqual([...bytes]);
  });

  it('computes the lowercase SHA-256 sent to Desktop for commit verification', async () => {
    await expect(sha256Hex(new TextEncoder().encode('Flovart'))).resolves.toBe(
      '9acda8eb15837ae83b56956bfe77c1874c2591482b5a8a1698454911d6d54bd7',
    );
  });

  it('requests only the selected cross-origin image origin and never all URLs', () => {
    expect(exactOptionalOrigin(
      'https://cdn.example.com/path/image.png?token=1',
      'https://article.example.org/story',
    )).toBe('https://cdn.example.com/*');
    expect(exactOptionalOrigin(
      'https://article.example.org/image.png',
      'https://article.example.org/story',
    )).toBeNull();
    expect(exactOptionalOrigin('data:image/png;base64,AA==', 'https://example.org/')).toBeNull();
  });

  it('keeps large inline bytes and URL credentials out of persisted provenance', () => {
    expect(provenanceUrl('data:image/png;base64,AA==')).toBeNull();
    expect(provenanceUrl('blob:https://example.org/asset-id')).toBeNull();
    expect(provenanceUrl('https://user:pass@cdn.example.com/image.png?token=secret#preview'))
      .toBe('https://cdn.example.com/image.png');
  });

  it('purges legacy Provider credentials and large browser handoff payloads on upgrade', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    await purgeLegacyExtensionStorage({ remove });

    expect(LEGACY_STORAGE_KEYS).toEqual(expect.arrayContaining([
      'flovart_api_keys_v2',
      'flovart_user_api_keys',
      'flovart_pending_image',
      'flovart_collected_images',
    ]));
    expect(remove).toHaveBeenCalledWith(LEGACY_STORAGE_KEYS);
  });
});
