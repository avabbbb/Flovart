import { invoke, isTauri } from '@tauri-apps/api/core';

export interface RuntimeArtifactPayload {
  mimeType: string;
  bytes: number[];
}

interface CachedArtifactBlob {
  promise: Promise<Blob>;
  lastUsedAt: number;
}

const blobCache = new Map<string, CachedArtifactBlob>();
// 运行时媒体可达数百 MB，缓存无界会长期占用内存；超限按 LRU 淘汰最旧条目。
const MAX_BLOB_CACHE_ENTRIES = 16;

function touchBlobCacheEntry(taskId: string): void {
  const entry = blobCache.get(taskId);
  if (!entry) return;
  entry.lastUsedAt = Date.now();
  if (blobCache.size <= MAX_BLOB_CACHE_ENTRIES) return;
  let oldestId: string | undefined;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (const [id, candidate] of blobCache) {
    if (id !== taskId && candidate.lastUsedAt < oldestAt) {
      oldestAt = candidate.lastUsedAt;
      oldestId = id;
    }
  }
  if (oldestId) blobCache.delete(oldestId);
}

export async function loadRuntimeArtifactBlob(taskId: string, fallbackMimeType?: string): Promise<Blob> {
  if (typeof window === 'undefined' || !isTauri()) {
    throw new Error('Runtime 媒体只能在桌面应用中读取');
  }
  const cached = blobCache.get(taskId);
  if (cached) {
    touchBlobCacheEntry(taskId);
    return cached.promise;
  }
  const pending: CachedArtifactBlob = {
    lastUsedAt: Date.now(),
    promise: invoke<RuntimeArtifactPayload>('runtime_artifact_read', { taskId })
      .then(payload => new Blob([new Uint8Array(payload.bytes)], { type: payload.mimeType || fallbackMimeType || 'application/octet-stream' }))
      .catch(error => {
        blobCache.delete(taskId);
        throw error;
      }),
  };
  blobCache.set(taskId, pending);
  touchBlobCacheEntry(taskId);
  return pending.promise;
}
