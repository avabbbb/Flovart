import { invoke, isTauri } from '@tauri-apps/api/core';

const REMOTE_MEDIA_MIME_HEADER_BYTES = 4;

function decodeNativeMediaPayload(payload: ArrayBuffer | Uint8Array, fallbackMimeType?: string): Blob {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  if (bytes.byteLength < REMOTE_MEDIA_MIME_HEADER_BYTES) {
    throw new Error('桌面媒体响应无效');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mimeLength = view.getUint32(0, true);
  const bodyOffset = REMOTE_MEDIA_MIME_HEADER_BYTES + mimeLength;
  if (bodyOffset > bytes.byteLength) {
    throw new Error('桌面媒体响应无效');
  }

  const mimeBytes = bytes.subarray(REMOTE_MEDIA_MIME_HEADER_BYTES, bodyOffset);
  const mimeType = new TextDecoder().decode(mimeBytes).trim()
    || fallbackMimeType
    || 'application/octet-stream';
  return new Blob([bytes.subarray(bodyOffset)], { type: mimeType });
}

export function shouldUseDesktopNativeFetch(url: string | undefined | null): boolean {
  return Boolean(url && /^https:\/\//i.test(url) && typeof window !== 'undefined' && isTauri());
}

export async function fetchRemoteMediaBlob(
  url: string,
  options: { signal?: AbortSignal; fallbackMimeType?: string } = {},
): Promise<Blob> {
  if (options.signal?.aborted) {
    throw options.signal.reason || new DOMException('Media fetch aborted', 'AbortError');
  }

  if (shouldUseDesktopNativeFetch(url)) {
    const pending = invoke<ArrayBuffer>('desktop_fetch_remote_media', { url })
      .then(payload => decodeNativeMediaPayload(payload, options.fallbackMimeType));

    if (!options.signal) return pending;

    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(options.signal?.reason || new DOMException('Media fetch aborted', 'AbortError'));
        }, { once: true });
      }),
    ]);
  }

  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) throw new Error(`无法下载远程媒体 (HTTP ${response.status})`);
  return response.blob();
}

export async function openRemoteMediaUrl(url: string): Promise<void> {
  if (typeof window !== 'undefined' && isTauri() && /^https:\/\//i.test(url)) {
    await invoke('desktop_open_remote_url', { url });
    return;
  }

  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) throw new Error('无法打开远程媒体链接');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
