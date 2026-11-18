/**
 * 网页画布经已配对的 Flovart 浏览器插件直连模型上游，不经过 Cloudflare Worker `/api/llm-proxy`
 * （省 Workers 每日配额）。协议见 extension/background/direct-fetch.js：每个请求一条 Port。
 *
 * - 只有插件已批准此画布且 hello 能力里声明了 `llm.fetch` 才会走直连；
 * - 拿到上游响应头之前的任何失败都抛 ExtensionDirectUnavailableError，调用方回退到代理；
 * - 拿到响应头之后按流返回（SSE 逐块到达）；AbortSignal 取消会通知插件中止上游请求。
 */
import type { ChromePortLike, ExtensionBridge, ExtensionBridgeMessage } from './extensionBridge';

export const DIRECT_FETCH_PORT_NAME = 'flovart-fetch';
export const DIRECT_FETCH_CAPABILITY = 'llm.fetch';
/** 插件必须在这段时间内确认收到请求（校验通过），否则回退代理。 */
const ACCEPT_TIMEOUT_MS = 4000;
/** 保活：MV3 service worker 空闲 30s 会被回收，等待上游期间定期发消息。 */
const KEEPALIVE_MS = 20_000;

export class ExtensionDirectUnavailableError extends Error {
  readonly code: string;
  constructor(code: string, message = '插件直连不可用') {
    super(message);
    this.name = 'ExtensionDirectUnavailableError';
    this.code = code;
  }
}

type DirectBridge = Pick<ExtensionBridge, 'supports' | 'openChannel'>;

export function canUseExtensionDirect(bridge: DirectBridge | null | undefined): boolean {
  return Boolean(bridge?.supports(DIRECT_FETCH_CAPABILITY));
}

function abortError(): Error {
  return typeof DOMException === 'function'
    ? new DOMException('The operation was aborted.', 'AbortError')
    : Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export interface DirectFetchRequest {
  url: string;
  method: string;
  headers: Headers;
  body?: ArrayBuffer;
  signal?: AbortSignal | null;
}

/** 经插件发出请求。响应头到达后 resolve；之前失败一律抛 ExtensionDirectUnavailableError（取消除外）。 */
export function extensionDirectFetch(bridge: DirectBridge, request: DirectFetchRequest): Promise<Response> {
  const { signal } = request;
  if (signal?.aborted) return Promise.reject(abortError());
  if (!canUseExtensionDirect(bridge)) return Promise.reject(new ExtensionDirectUnavailableError('not_available'));
  const port: ChromePortLike | null = bridge.openChannel(DIRECT_FETCH_PORT_NAME);
  if (!port) return Promise.reject(new ExtensionDirectUnavailableError('no_channel'));

  return new Promise<Response>((resolve, reject) => {
    let headReceived = false;
    let closed = false;
    let stream: ReadableStreamDefaultController<Uint8Array> | null = null;
    const keepalive = setInterval(() => safePost({ type: 'fetch.ping' }), KEEPALIVE_MS);
    let acceptTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      fail(new ExtensionDirectUnavailableError('accept_timeout'));
    }, ACCEPT_TIMEOUT_MS);

    function safePost(message: unknown) {
      if (closed) return;
      try {
        port!.postMessage(message);
      } catch {
        // 插件已断开，onDisconnect 会收尾。
      }
    }

    function cleanup() {
      if (closed) return;
      closed = true;
      clearInterval(keepalive);
      if (acceptTimer) clearTimeout(acceptTimer);
      acceptTimer = null;
      signal?.removeEventListener('abort', onAbort);
      try {
        port!.disconnect();
      } catch {
        // already gone
      }
    }

    function fail(error: Error) {
      if (closed) return;
      if (!headReceived) reject(error);
      else stream?.error(error);
      cleanup();
    }

    function onAbort() {
      safePost({ type: 'fetch.abort' });
      fail(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    port.onDisconnect.addListener(() => {
      if (closed) return;
      fail(headReceived
        ? new Error('插件直连在响应途中断开')
        : new ExtensionDirectUnavailableError('disconnected'));
    });

    port.onMessage.addListener((message: ExtensionBridgeMessage) => {
      if (closed || !message || typeof message !== 'object') return;
      switch (message.type) {
        case 'fetch.accepted':
          if (acceptTimer) clearTimeout(acceptTimer);
          acceptTimer = null;
          return;
        case 'fetch.head': {
          if (headReceived) return;
          if (acceptTimer) clearTimeout(acceptTimer);
          acceptTimer = null;
          const status = Number(message.status);
          if (!Number.isInteger(status) || status < 200 || status > 599) {
            fail(new ExtensionDirectUnavailableError('bad_status'));
            return;
          }
          const headers = new Headers({ 'cache-control': 'no-store', 'x-flovart-transport': 'extension' });
          if (Array.isArray(message.headers)) {
            for (const entry of message.headers) {
              if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') headers.set(entry[0], entry[1]);
            }
          }
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              stream = controller;
            },
            cancel() {
              safePost({ type: 'fetch.abort' });
              cleanup();
            },
          });
          headReceived = true;
          const noBody = status === 204 || status === 205 || status === 304;
          resolve(new Response(noBody ? null : body, {
            status,
            statusText: typeof message.statusText === 'string' ? message.statusText : '',
            headers,
          }));
          return;
        }
        case 'fetch.chunk':
          if (!headReceived || typeof message.data !== 'string') return;
          try {
            stream?.enqueue(base64ToBytes(message.data));
          } catch {
            // 消费方已取消流
          }
          return;
        case 'fetch.end':
          if (headReceived) {
            try {
              stream?.close();
            } catch {
              // already closed/cancelled
            }
          }
          cleanup();
          return;
        case 'fetch.error': {
          const code = typeof message.code === 'string' ? message.code : 'extension_error';
          fail(headReceived
            ? new Error('插件直连失败：' + code)
            : new ExtensionDirectUnavailableError(code, String(message.message || '插件直连不可用')));
          return;
        }
        default:
      }
    });

    const entries: Array<[string, string]> = [];
    request.headers.forEach((value, name) => entries.push([name, value]));
    safePost({
      type: 'fetch.start',
      url: request.url,
      method: request.method.toUpperCase(),
      headers: entries,
      ...(request.body && request.body.byteLength ? { bodyBase64: bytesToBase64(new Uint8Array(request.body)) } : {}),
    });
  });
}
