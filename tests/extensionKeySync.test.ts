// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createExtensionKeySync,
  diffExtensionKeys,
  toExtensionKeyEntry,
  type KeySyncBridge,
} from '../services/extensionKeySync';

function fakeBridge(initial: string) {
  let status = initial;
  let listener: ((state: { status: string }) => void) | undefined;
  const calls: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const failures: Error[] = [];
  const bridge: KeySyncBridge = {
    getState: () => ({ status }),
    subscribe(next) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    async request(type, payload) {
      calls.push({ type, payload });
      const failure = failures.shift();
      if (failure) throw failure;
      return {};
    },
  };
  return {
    bridge,
    calls,
    setStatus(next: string) {
      status = next;
      listener?.({ status });
    },
    failNext(error: Error) {
      failures.push(error);
    },
  };
}

const k1 = { id: 'k1', provider: 'openai', key: 'a' };
const k2 = { id: 'k2', provider: 'google', key: 'b', defaultModel: 'm' };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('extension key sync', () => {
  it('sends a snapshot first, then only deltas', async () => {
    const fake = fakeBridge('approved');
    const sync = createExtensionKeySync(fake.bridge);
    await sync.update([k1]);
    await sync.update([k1, k2]);
    await sync.update([k2]);
    await sync.update([k2]);
    expect(fake.calls).toEqual([
      { type: 'keys.snapshot', payload: { revision: 1, keys: [k1] } },
      { type: 'keys.delta', payload: { baseRevision: 1, revision: 2, upsert: [k2], remove: [] } },
      { type: 'keys.delta', payload: { baseRevision: 2, revision: 3, upsert: [], remove: ['k1'] } },
    ]);
  });

  it('waits for approval before sending anything', async () => {
    const fake = fakeBridge('pending');
    const sync = createExtensionKeySync(fake.bridge);
    await sync.update([k1]);
    expect(fake.calls).toEqual([]);
    fake.setStatus('approved');
    await tick();
    expect(fake.calls.map(call => call.type)).toEqual(['keys.snapshot']);
  });

  it('falls back to a snapshot when the extension reports a revision mismatch', async () => {
    const fake = fakeBridge('approved');
    const sync = createExtensionKeySync(fake.bridge);
    await sync.update([k1]);
    fake.failNext(new Error('keys.revision-mismatch'));
    await sync.update([k1, k2]);
    expect(fake.calls.map(call => call.type)).toEqual(['keys.snapshot', 'keys.delta', 'keys.snapshot']);
    expect(fake.calls[2].payload).toEqual({ revision: 2, keys: [k1, k2] });
  });

  it('resends a full snapshot after reconnecting', async () => {
    const fake = fakeBridge('approved');
    const sync = createExtensionKeySync(fake.bridge);
    await sync.update([k1]);
    fake.setStatus('disconnected');
    fake.setStatus('approved');
    await tick();
    expect(fake.calls.map(call => call.type)).toEqual(['keys.snapshot', 'keys.snapshot']);
  });

  it('stops syncing after dispose', async () => {
    const fake = fakeBridge('approved');
    const sync = createExtensionKeySync(fake.bridge);
    sync.dispose();
    await sync.update([k1]);
    expect(fake.calls).toEqual([]);
  });

  it('keeps only fields the extension uses and diffs by id', () => {
    expect(toExtensionKeyEntry({ ...k2, baseUrl: '', capabilities: [] })).toEqual(k2);
    expect(diffExtensionKeys([k1, k2], [{ ...k1, key: 'changed' }])).toEqual({
      upsert: [{ ...k1, key: 'changed' }],
      remove: ['k2'],
    });
  });
});
