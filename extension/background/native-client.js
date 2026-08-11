import { NATIVE_HOST_NAME } from './import-protocol.js';

export class NativeSession {
  constructor(runtime = chrome.runtime) {
    this.runtime = runtime;
    this.pending = new Map();
    this.port = runtime.connectNative(NATIVE_HOST_NAME);
    this.port.onMessage.addListener(message => {
      const entry = this.pending.get(message?.requestId);
      if (!entry) return;
      this.pending.delete(message.requestId);
      clearTimeout(entry.timer);
      entry.resolve(message);
    });
    this.port.onDisconnect.addListener(() => {
      const message = runtime.lastError?.message || 'Flovart Native Host 已断开';
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error(message));
      }
      this.pending.clear();
    });
  }

  request(message, timeoutMs = 10_000) {
    const requestId = message.requestId || crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Flovart Desktop 响应超时'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.port.postMessage({ ...message, requestId });
    });
  }

  disconnect() {
    this.port.disconnect();
  }
}

export function nativeResult(response) {
  if (response?.ok) return response.result;
  const error = new Error(response?.error?.message || 'Flovart Native Host 请求失败');
  error.code = response?.error?.code;
  error.retryable = Boolean(response?.error?.retryable);
  throw error;
}
