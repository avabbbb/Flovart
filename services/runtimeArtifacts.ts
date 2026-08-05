import { invoke, isTauri } from '@tauri-apps/api/core';

export interface RuntimeArtifactPayload {
  mimeType: string;
  bytes: number[];
}

const blobCache = new Map<string, Promise<Blob>>();

export async function loadRuntimeArtifactBlob(taskId: string, fallbackMimeType?: string): Promise<Blob> {
  if (typeof window === 'undefined' || !isTauri()) {
    throw new Error('Runtime 媒体只能在桌面应用中读取');
  }
  const cached = blobCache.get(taskId);
  if (cached) return cached;
  const pending = invoke<RuntimeArtifactPayload>('runtime_artifact_read', { taskId })
    .then(payload => new Blob([new Uint8Array(payload.bytes)], { type: payload.mimeType || fallbackMimeType || 'application/octet-stream' }))
    .catch(error => {
      blobCache.delete(taskId);
      throw error;
    });
  blobCache.set(taskId, pending);
  return pending;
}
