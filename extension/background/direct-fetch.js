// 网页画布经插件直连模型上游（不走 Cloudflare Worker /api/llm-proxy，省 Workers 配额）。
// 每个请求一个长连接 Port（名称 iris-fetch）：
//   网页 → 插件  { type: 'fetch.start', url, method, headers: [[k, v]], bodyBase64? }
//                { type: 'fetch.abort' } / { type: 'fetch.ping' }（保活）；网页断开 Port 也视为取消
//   插件 → 网页  { type: 'fetch.accepted' } → { type: 'fetch.head', status, statusText, headers }
//                → { type: 'fetch.chunk', data(base64) }* → { type: 'fetch.end' }
//                或 { type: 'fetch.error', code, message, beforeHead }
// 安全：只接受白名单 origin 且已在 popup 批准配对的网页；上游 host/path 与 Worker 代理同一份白名单；
// 只转发固定请求头，不带 cookie，不跟随重定向；不记录 Key、请求体或响应体。
import {
  DIRECT_FORWARDED_REQUEST_HEADERS,
  DIRECT_FORWARDED_RESPONSE_HEADERS,
  DIRECT_MAX_BODY_BYTES,
  checkDirectUpstream,
} from './upstream-allowlist.js';

export const DIRECT_FETCH_PORT_NAME = 'iris-fetch';
export const DIRECT_FETCH_CAPABILITY = 'llm.fetch';
const START_TIMEOUT_MS = 10_000;

export function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function pickHeaders(entries, allowed) {
  const out = new Headers();
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') continue;
    const name = entry[0].toLowerCase();
    if (allowed.includes(name)) out.set(name, entry[1]);
  }
  return out;
}

/**
 * 处理一个 iris-fetch Port。依赖注入便于测试：
 * - fetchImpl：上游 fetch
 * - isApprovedOrigin(origin) → Promise<boolean>：origin 在白名单内且配对已批准
 */
export function createDirectFetchHandler({ fetchImpl = (...args) => fetch(...args), isApprovedOrigin }) {
  return function handleDirectFetchPort(port) {
    const origin = port.sender?.origin;
    const controller = new AbortController();
    let started = false;
    let headSent = false;
    let finished = false;

    const send = message => {
      if (finished) return;
      try {
        port.postMessage(message);
      } catch {
        controller.abort();
      }
    };
    const fail = (code, message) => {
      send({ type: 'fetch.error', code, message, beforeHead: !headSent });
      finished = true;
      // 让网页先收到错误再由它断开；网页没反应时兜底关闭 Port。
      setTimeout(() => {
        try { port.disconnect(); } catch { /* already gone */ }
      }, 1000);
    };

    const startTimer = setTimeout(() => {
      if (!started) fail('start_timeout', '未收到请求');
    }, START_TIMEOUT_MS);

    port.onDisconnect.addListener(() => {
      clearTimeout(startTimer);
      finished = true;
      controller.abort();
    });

    port.onMessage.addListener(message => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'fetch.abort') {
        controller.abort();
        finished = true;
        try { port.disconnect(); } catch { /* already gone */ }
        return;
      }
      if (message.type !== 'fetch.start' || started) return;
      started = true;
      clearTimeout(startTimer);
      void run(message).catch(() => fail('internal_error', '插件直连失败'));
    });

    async function run(message) {
      if (!(await isApprovedOrigin(origin))) {
        fail('forbidden_origin', '插件尚未批准此画布连接');
        return;
      }
      const checked = checkDirectUpstream(message.url, message.method);
      if (checked.error) {
        fail(checked.error, '上游不在 Iris 直连白名单内');
        return;
      }
      const { url, publicDoc, method } = checked;
      const headers = publicDoc
        ? new Headers({ accept: 'text/markdown, text/plain, */*' })
        : pickHeaders(message.headers, DIRECT_FORWARDED_REQUEST_HEADERS);
      if (!publicDoc && !headers.has('authorization') && !headers.has('x-api-key') && !headers.has('x-goog-api-key')) {
        fail('missing_api_key', 'Missing API key');
        return;
      }
      let body;
      if (method === 'POST' && typeof message.bodyBase64 === 'string' && message.bodyBase64) {
        if (message.bodyBase64.length > Math.ceil(DIRECT_MAX_BODY_BYTES / 3) * 4) {
          fail('body_too_large', 'Request body too large');
          return;
        }
        try {
          body = base64ToBytes(message.bodyBase64);
        } catch {
          fail('bad_body', '请求体编码无效');
          return;
        }
      }
      if (url.hostname === 'opencode.ai' && !headers.has('x-opencode-session')) {
        headers.set('x-opencode-session', 'ses_iris_' + crypto.randomUUID().replace(/-/g, ''));
      }
      send({ type: 'fetch.accepted' });

      let response;
      try {
        response = await fetchImpl(url.toString(), {
          method,
          headers,
          body,
          signal: controller.signal,
          redirect: 'manual',
          credentials: 'omit',
          cache: 'no-store',
        });
      } catch {
        if (controller.signal.aborted) return;
        fail('upstream_unreachable', 'Upstream request failed');
        return;
      }
      if (finished) return;
      // 不跟随重定向（与 Worker 一致）；opaqueredirect 交给网页回退到代理。
      if (response.type === 'opaqueredirect' || response.status < 200 || response.status > 599) {
        fail('upstream_redirect', 'Upstream redirected');
        return;
      }
      const responseHeaders = [];
      for (const name of DIRECT_FORWARDED_RESPONSE_HEADERS) {
        const value = response.headers.get(name);
        if (value) responseHeaders.push([name, value]);
      }
      send({ type: 'fetch.head', status: response.status, statusText: response.statusText || '', headers: responseHeaders });
      headSent = true;
      if (!response.body) {
        send({ type: 'fetch.end' });
        finished = true;
        return;
      }
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (finished) {
            void reader.cancel().catch(() => {});
            return;
          }
          if (value?.length) send({ type: 'fetch.chunk', data: bytesToBase64(value) });
        }
      } catch {
        if (controller.signal.aborted) return;
        fail('upstream_stream_error', 'Upstream stream failed');
        return;
      }
      send({ type: 'fetch.end' });
      finished = true;
    }
  };
}
