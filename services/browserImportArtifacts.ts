import { invoke, isTauri } from '@tauri-apps/api/core';
import { workflowMediaStorage } from '../components/workflow/storage';
import { webBrowserImportStorageKey } from './webBrowserImportReceiver';

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

async function readDesktopImportBlob(importId: string, fallbackMimeType?: string): Promise<Blob> {
  const payload = await invoke<BrowserImportArtifactPayload>('browser_import_artifact_read', { importId });
  return new Blob(
    [new Uint8Array(payload.bytes)],
    { type: payload.mimeType || fallbackMimeType || 'application/octet-stream' },
  );
}

// 网页画布经插件导入的媒体由 webBrowserImportReceiver 写入 workflowMediaStorage。
async function readWebImportBlob(importId: string, fallbackMimeType?: string): Promise<Blob> {
  const blob = await workflowMediaStorage.get(webBrowserImportStorageKey(importId));
  if (!blob) throw new Error('浏览器导入的媒体不存在，可能已被清理');
  return blob.type || !fallbackMimeType ? blob : new Blob([blob], { type: fallbackMimeType });
}

export async function loadBrowserImportArtifactBlob(importId: string, fallbackMimeType?: string): Promise<Blob> {
  const cached = cache.get(importId);
  if (cached) return cached;
  const desktop = typeof window !== 'undefined' && isTauri();
  const pending = (desktop ? readDesktopImportBlob(importId, fallbackMimeType) : readWebImportBlob(importId, fallbackMimeType))
    .catch(error => {
      cache.delete(importId);
      throw error;
    });
  cache.set(importId, pending);
  return pending;
}
