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

/**
 * 远程媒体下载失败。corsBlocked 表示浏览器层面拒绝（跨域拦截或网络不可达），
 * 此时供应商通常已生成成功，不应误报为生成失败。
 */
export class RemoteMediaFetchError extends Error {
  readonly url: string;
  readonly corsBlocked: boolean;
  readonly status?: number;

  constructor(message: string, url: string, corsBlocked: boolean, status?: number) {
    super(message);
    this.name = 'RemoteMediaFetchError';
    this.url = url;
    this.corsBlocked = corsBlocked;
    this.status = status;
  }
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

  let response: Response;
  try {
    response = await fetch(url, { signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    // 浏览器对跨域拦截只抛不透明的 TypeError，无法读取状态码；统一给出可操作的提示并保留远程链接。
    throw new RemoteMediaFetchError(
      '结果已生成，但浏览器无法下载远程媒体（可能被跨域 CORS 策略拦截或网络不可达）。请改用桌面端，或直接打开远程链接：' + url,
      url,
      true,
    );
  }
  if (!response.ok) throw new RemoteMediaFetchError(`无法下载远程媒体 (HTTP ${response.status})`, url, false, response.status);
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

function downloadBlobInBrowser(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'application/json': 'json',
  'application/zip': 'zip',
};

function withExtension(filename: string, mimeType: string): string {
  if (/\.[a-z0-9]{1,5}$/i.test(filename)) return filename;
  const extension = EXTENSION_BY_MIME[mimeType.split(';')[0].trim().toLowerCase()];
  return extension ? filename + '.' + extension : filename;
}

// jsdom 等环境的 Blob 可能没有 arrayBuffer()，回退 FileReader。
function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then(buffer => new Uint8Array(buffer));
  const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();
  const reader = new FileReader();
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
  reader.onerror = () => reject(reader.error || new Error('无法读取文件数据'));
  reader.readAsArrayBuffer(blob);
  return promise;
}

// 保存文件到本地。桌面端弹系统“另存为”并由 Rust 写盘（打包后 WebView 的 <a download> 不可靠）；
// Web 端走浏览器下载。返回 false 表示用户在桌面端取消了保存。
export async function saveBlob(blob: Blob, filename: string): Promise<boolean> {
  const name = withExtension(filename, blob.type);
  if (typeof window !== 'undefined' && isTauri()) {
    const savedPath = await invoke<string | null>('desktop_save_file', await blobBytes(blob), {
      headers: { 'x-iris-file-name': encodeURIComponent(name) },
    });
    return savedPath !== null;
  }
  downloadBlobInBrowser(blob, name);
  return true;
}

// 下载并保存任意媒体地址（https / blob: / data:），不再依赖 <a href download>：
// 跨域链接上的 download 属性会被忽略，桌面端会把主窗口导航到媒体 URL。
// Web 端被 CORS 拦截时退回新窗口打开远程链接。
export async function saveMediaUrl(url: string, filename: string): Promise<boolean> {
  let blob: Blob;
  try {
    blob = await fetchRemoteMediaBlob(url);
  } catch (error) {
    if (error instanceof RemoteMediaFetchError && error.corsBlocked) {
      await openRemoteMediaUrl(url);
      return false;
    }
    throw error;
  }
  return saveBlob(blob, filename);
}
