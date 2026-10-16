import { invoke, isTauri } from '@tauri-apps/api/core';

const PREFIX = 'flovart-browser-import:';
const cache = new Map<string, Promise<Blob>>();

interface BrowserImportArtifactPayload {
  mimeType: string;
  bytes: number[];
}

export function browserImportHref(importId: string) {
  return `${PREFIX}${encodeURIComponent(importId)}`;
}

export function parseBrowserImportHref(href: string): string | null {
  if (!href.startsWith(PREFIX)) return null;
  try {
    const importId = decodeURIComponent(href.slice(PREFIX.length));
    return importId || null;
  } catch {
    return null;
  }
}

export async function loadBrowserImportArtifactBlob(importId: string, fallbackMimeType?: string): Promise<Blob> {
  if (typeof window === 'undefined' || !isTauri()) {
    throw new Error('浏览器导入 Artifact 只能在 Flovart Desktop 中读取');
  }
  const cached = cache.get(importId);
  if (cached) return cached;
  const pending = invoke<BrowserImportArtifactPayload>('browser_import_artifact_read', { importId })
    .then(payload => new Blob(
      [new Uint8Array(payload.bytes)],
      { type: payload.mimeType || fallbackMimeType || 'application/octet-stream' },
    ))
    .catch(error => {
      cache.delete(importId);
      throw error;
    });
  cache.set(importId, pending);
  return pending;
}
