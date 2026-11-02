import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReceiptStore } from '../agent/receipts.js';

const dirs: string[] = [];
const makeStore = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flovart-receipts-'));
  dirs.push(root);
  return new ReceiptStore({ dirFor: (projectId: string) => {
    const dir = path.join(root, projectId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } });
};

afterEach(() => {
  dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
});

describe('ReceiptStore', () => {
  it('appends and lists receipts per project, newest last', async () => {
    const store = makeStore();
    await store.appendMany([{ projectId: 'p1', kind: 'decision', title: '用 yayi 替换角色' }], { agentIdentity: 'codex' });
    await store.appendMany([{ projectId: 'p2', kind: 'note', title: 'other project' }]);
    const list = await store.list('p1');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ projectId: 'p1', kind: 'decision', agentIdentity: 'codex' });
  });

  it('is idempotent on agent + externalRef so history import can be re-run', async () => {
    const store = makeStore();
    const batch = [{ projectId: 'p1', kind: 'task', title: '拆镜头', externalRef: 'codex:turn-1' }];
    expect((await store.appendMany(batch, { agentIdentity: 'codex' })).added).toHaveLength(1);
    const again = await store.appendMany(batch, { agentIdentity: 'codex' });
    expect(again.added).toHaveLength(0);
    expect(again.skipped).toEqual(['codex:turn-1']);
    expect(await store.list('p1')).toHaveLength(1);
  });

  it('rejects bad input and redacts key-like text', async () => {
    const store = makeStore();
    await expect(store.appendMany([{ projectId: 'p1', kind: 'memory', title: 'x' }])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(store.appendMany([{ kind: 'note', title: 'x' }])).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const { added } = await store.appendMany([{ projectId: 'p1', kind: 'note', title: 't', summary: 'key sk-abcdefghijklmnopqrstuv end' }]);
    expect(added[0].summary).toBe('key [redacted] end');
  });
});
