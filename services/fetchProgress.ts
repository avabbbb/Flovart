// 带字节进度的 HTTP 传输：下载按响应流计数；上传走 XMLHttpRequest，因为 fetch 拿不到已发送字节。

// 与 fetch 一致：signal 自带 DOMException 原因（如 AbortSignal.timeout 的 TimeoutError）时沿用，否则抛 AbortError。
function abortReason(signal?: AbortSignal): DOMException {
  const reason = signal?.reason;
  return reason instanceof DOMException ? reason : new DOMException('The operation was aborted.', 'AbortError');
}

// 读取响应体并上报已下载字节。
// 没有 Content-Length，或响应被压缩（头里是压缩后长度，流里是解压后字节）时 total 为 undefined。
export async function readBodyWithProgress(
  response: Response,
  onProgress?: (loaded: number, total?: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!onProgress || !response.body) return response.blob();
  const encoding = (response.headers.get('Content-Encoding') || '').trim().toLowerCase();
  const declared = Number(response.headers.get('Content-Length'));
  const total = declared > 0 && (!encoding || encoding === 'identity') ? declared : undefined;
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw abortReason(signal);
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, total);
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  if (signal?.aborted) throw abortReason(signal);
  return new Blob(chunks as BlobPart[], { type: response.headers.get('Content-Type') || '' });
}

export interface UploadRequestInit {
  method: string;
  headers?: HeadersInit;
  body?: XMLHttpRequestBodyInit | null;
  signal?: AbortSignal;
  timeoutMs?: number;
}

// Response 构造器不允许这些状态带响应体。
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

// 与 fetch 语义一致的上传请求。传入 onUploadProgress 且环境有 XMLHttpRequest 时走 XHR，通过 upload.onprogress 上报已发送字节；否则直接用全局 fetch。
// 返回标准 Response，调用方的 res.ok / res.json() 不变；停止抛 AbortError，超时抛 TimeoutError，网络错误抛 TypeError。
export function requestWithUpload(
  url: string,
  init: UploadRequestInit,
  onUploadProgress?: (loaded: number, total?: number) => void,
): Promise<Response> {
  if (!onUploadProgress || typeof XMLHttpRequest === 'undefined') {
    const signals: AbortSignal[] = [];
    if (init.signal) signals.push(init.signal);
    if (init.timeoutMs && init.timeoutMs > 0) signals.push(AbortSignal.timeout(init.timeoutMs));
    return fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body as BodyInit | null | undefined,
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    });
  }
  const { promise, resolve, reject } = Promise.withResolvers<Response>();
  const { signal } = init;
  if (signal?.aborted) {
    reject(abortReason(signal));
    return promise;
  }
  const xhr = new XMLHttpRequest();
  xhr.open(init.method, url);
  xhr.responseType = 'arraybuffer';
  new Headers(init.headers).forEach((value, name) => xhr.setRequestHeader(name, value));
  if (init.timeoutMs && init.timeoutMs > 0) xhr.timeout = init.timeoutMs;
  const onAbort = () => xhr.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const settle = (outcome: () => void) => {
    signal?.removeEventListener('abort', onAbort);
    outcome();
  };
  xhr.upload.onprogress = event => onUploadProgress(event.loaded, event.lengthComputable ? event.total : undefined);
  xhr.onload = () => settle(() => {
    const headers = new Headers();
    for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
      const separator = line.indexOf(':');
      if (separator > 0) headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
    const body = NULL_BODY_STATUSES.has(xhr.status) ? null : (xhr.response as ArrayBuffer | null);
    resolve(new Response(body, { status: xhr.status, statusText: xhr.statusText, headers }));
  });
  xhr.onerror = () => settle(() => reject(new TypeError('Failed to fetch')));
  xhr.onabort = () => settle(() => reject(abortReason(signal)));
  xhr.ontimeout = () => settle(() => reject(new DOMException('The operation timed out.', 'TimeoutError')));
  xhr.send(init.body ?? null);
  return promise;
}
