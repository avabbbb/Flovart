import { mkdirSync } from 'node:fs';
import { parse, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// Keep Vitest's mkdtemp/tmpdir fixtures off the system drive. The repository
// is on H:, so every test-owned temporary file belongs under this ignored H:
// workspace directory instead of the user's Windows TEMP directory.
const testTempRoot = resolve(process.cwd(), '.tmp', 'vitest');
if (parse(testTempRoot).root.toUpperCase() !== 'H:\\') throw new Error(`Vitest temporary files must use an H: root: ${testTempRoot}`);
mkdirSync(testTempRoot, { recursive: true });
process.env.TEMP = testTempRoot;
process.env.TMP = testTempRoot;
process.env.TMPDIR = testTempRoot;

// Polyfill WebCrypto for jsdom (Node 18+)
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto as unknown as Crypto,
    writable: true,
  });
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class TestResizeObserver implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { value: TestResizeObserver, writable: true });
}

// Mock URL.createObjectURL / revokeObjectURL (jsdom does not implement them)
let _blobCounter = 0;
const _activeUrls = new Set<string>();

// Override unconditionally — jsdom's stubs don't track object URLs
URL.createObjectURL = (blob: Blob | MediaSource): string => {
  const url = `blob:test/${++_blobCounter}`;
  _activeUrls.add(url);
  return url;
};

URL.revokeObjectURL = (url: string): void => {
  _activeUrls.delete(url);
};

/** Helper: return currently active blob URLs (for leak assertions). */
export function getActiveBlobUrls(): ReadonlySet<string> {
  return _activeUrls;
}

/** Helper: clear all tracked blob URLs between tests. */
export function resetBlobUrls(): void {
  _activeUrls.clear();
  _blobCounter = 0;
}
