import { webcrypto } from 'node:crypto';
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

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
