import { describe, expect, it } from 'vitest';
import { createExtensionBridge, parseExtensionIds, type ChromePortLike, type ExtensionBridgeMessage } from '../services/extensionBridge';

const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);

type ExtensionSide = { send(message: ExtensionBridgeMessage): void; close(): void; sent: unknown[] };

// 模拟插件：behavior[id] 收到网页消息时被调用；没有 behavior 的 ID 视为未安装，连接后立即断开。
function fakeRuntime(behavior: Record<string, (message: ExtensionBridgeMessage, extension: ExtensionSide) => void>) {
  const connections: Array<{ id: string; extension: ExtensionSide }> = [];
  return {
    connections,
    connect(id: string): ChromePortLike {
      const messageListeners: Array<(message: ExtensionBridgeMessage) => void> = [];
      const disconnectListeners: Array<() => void> = [];
      const extension: ExtensionSide = {
        sent: [],
        send: message => messageListeners.forEach(listener => listener(message)),
        close: () => disconnectListeners.forEach(listener => listener()),
      };
      connections.push({ id, extension });
      if (!behavior[id]) queueMicrotask(() => extension.close());
      return {
        postMessage(message) {
          extension.sent.push(message);
          queueMicrotask(() => behavior[id]?.(message as ExtensionBridgeMessage, extension));
        },
        disconnect() {},
        onMessage: { addListener: listener => messageListeners.push(listener) },
        onDisconnect: { addListener: listener => disconnectListeners.push(listener) },
      };
    },
  };
}

const hello = (status: string) => ({ type: 'hello.result', status, extensionVersion: '1.4.0', capabilities: status === 'approved' ? ['browser.import.image'] : [] });
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('parseExtensionIds', () => {
  it('keeps only valid unique Chrome extension ids', () => {
    expect(parseExtensionIds(' ' + ID_A + ', not-an-id,' + ID_A + ',' + ID_B)).toEqual([ID_A, ID_B]);
    expect(parseExtensionIds(undefined)).toEqual([]);
  });
});

describe('createExtensionBridge', () => {
  it('reports unconfigured and not-installed without touching the runtime', async () => {
    expect((await createExtensionBridge({ runtime: null, extensionIds: [] }).connect()).status).toBe('unconfigured');
    expect((await createExtensionBridge({ runtime: null, extensionIds: [ID_A] }).connect()).status).toBe('not-installed');
  });

  it('skips an id that is not installed, requests pairing, then follows approval', async () => {
    const runtime = fakeRuntime({
      [ID_B]: (message, extension) => {
        if (message.type === 'hello') extension.send(hello(message.requestPairing ? 'pending' : 'none'));
      },
    });
    const bridge = createExtensionBridge({ runtime, extensionIds: [ID_A, ID_B], helloTimeoutMs: 200 });
    const state = await bridge.connect({ requestPairing: true });
    expect(state).toMatchObject({ status: 'pending', extensionId: ID_B });
    runtime.connections.at(-1)!.extension.send(hello('approved'));
    expect(bridge.getState()).toMatchObject({ status: 'approved', extensionVersion: '1.4.0', capabilities: ['browser.import.image'] });
  });

  it('answers extension requests only after approval', async () => {
    let approved = false;
    const runtime = fakeRuntime({
      [ID_A]: (message, extension) => {
        if (message.type === 'hello') extension.send(hello(approved ? 'approved' : 'none'));
      },
    });
    const bridge = createExtensionBridge({ runtime, extensionIds: [ID_A] });
    bridge.onRequest('ping', () => 'pong');
    await bridge.connect();
    const extension = runtime.connections[0].extension;
    extension.send({ id: 'r1', type: 'ping' });
    await flush();
    expect(extension.sent).toContainEqual({ replyTo: 'r1', ok: false, error: '画布尚未与插件配对' });

    approved = true;
    extension.send(hello('approved'));
    extension.send({ id: 'r2', type: 'ping' });
    await flush();
    expect(extension.sent).toContainEqual({ replyTo: 'r2', ok: true, result: 'pong' });
  });

  it('resolves web requests from replyTo and keeps revoked status after the extension disconnects', async () => {
    const runtime = fakeRuntime({
      [ID_A]: (message, extension) => {
        if (message.type === 'hello') extension.send(hello('approved'));
        if (message.type === 'keys.snapshot') extension.send({ replyTo: message.id, ok: true, result: { stored: 2 } });
      },
    });
    const bridge = createExtensionBridge({ runtime, extensionIds: [ID_A] });
    await bridge.connect();
    await expect(bridge.request('keys.snapshot', { keys: [] })).resolves.toEqual({ stored: 2 });

    const extension = runtime.connections[0].extension;
    extension.send(hello('revoked'));
    extension.close();
    expect(bridge.getState().status).toBe('revoked');
    await expect(bridge.request('keys.snapshot')).rejects.toThrow();
  });
});
