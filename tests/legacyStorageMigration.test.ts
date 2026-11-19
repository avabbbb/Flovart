// 2026-11-20 Flovart → Iris 更名：旧浏览器数据首次加载复制到新名字，且不删除旧数据。
import { IDBFactory } from 'fake-indexeddb';
import localforage from 'localforage';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LEGACY_MIGRATION_FLAG,
  copyLegacyDatabase,
  irisNameFor,
  migrateLegacyBrowserStorage,
  migrateLegacyWebStorage,
} from '../utils/legacyStorageMigration';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.has(key) ? data.get(key)! : null,
    setItem: (key: string, value: string) => { data.set(key, String(value)); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
  };
}

function put(idb: IDBFactory, name: string, store: string, entries: [IDBValidKey, unknown][]) {
  return new Promise<void>((resolve, reject) => {
    const open = idb.open(name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(store);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(store, 'readwrite');
      for (const [key, value] of entries) tx.objectStore(store).put(value, key);
      tx.oncomplete = () => { open.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

function readAll(idb: IDBFactory, name: string, store: string) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const open = idb.open(name);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(store)) { db.close(); resolve({}); return; }
      const os = db.transaction(store, 'readonly').objectStore(store);
      const keys = os.getAllKeys();
      const values = os.getAll();
      values.onsuccess = () => {
        const out: Record<string, unknown> = {};
        (keys.result as IDBValidKey[]).forEach((key, index) => { out[String(key)] = values.result[index]; });
        db.close();
        resolve(out);
      };
    };
  });
}

function databaseExists(idb: IDBFactory, name: string) {
  return idb.databases().then(list => list.some(item => item.name === name));
}

describe('Flovart → Iris browser storage migration', () => {
  let idb: IDBFactory;
  beforeEach(() => { idb = new IDBFactory(); });

  it('maps names with the same rule as the repository rename', () => {
    expect(irisNameFor('flovart.agent.thinking')).toBe('iris.agent.thinking');
    expect(irisNameFor('flovart:workflow:projects')).toBe('iris:workflow:projects');
    expect(irisNameFor('flovart_agent_tasks_v1')).toBe('iris_agent_tasks_v1');
    expect(irisNameFor('FlovartMediaColdStorage')).toBe('IrisMediaColdStorage');
  });

  it('copies legacy localStorage keys without overwriting or deleting', () => {
    const storage = memoryStorage({
      'flovart:workflow:projects': '{"v":4}',
      'flovart.agent.thinking': 'high',
      'iris.agent.thinking': 'low',
      unrelated: 'x',
    });
    expect(migrateLegacyWebStorage(storage)).toBe(1);
    expect(storage.getItem('iris:workflow:projects')).toBe('{"v":4}');
    expect(storage.getItem('iris.agent.thinking')).toBe('low');
    expect(storage.getItem('flovart:workflow:projects')).toBe('{"v":4}');
    expect(storage.getItem('flovart.agent.thinking')).toBe('high');
  });

  it('copies every object store of a legacy database and keeps the old one', async () => {
    await put(idb, 'flovart', 'agent-memory', [['p1', [{ text: 'remember' }]]]);
    await put(idb, 'flovart_workflow_v2', 'workflow_projects', [['proj', { id: 'proj', nodes: [] }]]);
    expect(await copyLegacyDatabase(idb, 'flovart')).toBe(1);
    expect(await copyLegacyDatabase(idb, 'flovart_workflow_v2')).toBe(1);
    expect(await readAll(idb, 'iris', 'agent-memory')).toEqual({ p1: [{ text: 'remember' }] });
    expect(await readAll(idb, 'iris_workflow_v2', 'workflow_projects')).toEqual({ proj: { id: 'proj', nodes: [] } });
    expect(await readAll(idb, 'flovart', 'agent-memory')).toEqual({ p1: [{ text: 'remember' }] });
  });

  it('does not create empty databases when nothing legacy exists', async () => {
    expect(await copyLegacyDatabase(idb, 'flovart-images')).toBe(0);
    expect(await databaseExists(idb, 'flovart-images')).toBe(false);
    expect(await databaseExists(idb, 'iris-images')).toBe(false);
  });

  it('never overwrites a non-empty store under the new name', async () => {
    await put(idb, 'flovart', 'webdav_config', [['config', { url: 'old' }]]);
    await put(idb, 'iris', 'webdav_config', [['config', { url: 'new' }]]);
    expect(await copyLegacyDatabase(idb, 'flovart')).toBe(0);
    expect(await readAll(idb, 'iris', 'webdav_config')).toEqual({ config: { url: 'new' } });
  });

  it('runs once, then short-circuits on the completion flag', async () => {
    const local = memoryStorage({ 'flovart.tokenUsage.v1': '[1]' });
    await put(idb, 'flovart_usage_v2', 'records', [['r1', { tokens: 3 }]]);
    const first = await migrateLegacyBrowserStorage({ localStorage: local, sessionStorage: memoryStorage(), indexedDB: idb });
    expect(first).toMatchObject({ skipped: false, localStorage: 1, errors: [] });
    expect(first.indexedDb.flovart_usage_v2).toBe(1);
    expect(local.getItem(LEGACY_MIGRATION_FLAG)).toBeTruthy();
    expect(local.getItem('iris.tokenUsage.v1')).toBe('[1]');
    const second = await migrateLegacyBrowserStorage({ localStorage: local, sessionStorage: memoryStorage(), indexedDB: idb });
    expect(second.skipped).toBe(true);
  });

  it('migrated localforage data is readable through localforage under the new name', async () => {
    // localforage 在模块加载时绑定全局 indexedDB（tests/setup.ts 的 fake-indexeddb），这里也用它。
    const legacy = localforage.createInstance({ name: 'flovart', storeName: 'prompt-history' });
    await legacy.setItem('h', ['a cat']);
    await migrateLegacyBrowserStorage({ localStorage: memoryStorage(), sessionStorage: memoryStorage(), indexedDB: globalThis.indexedDB });
    const next = localforage.createInstance({ name: 'iris', storeName: 'prompt-history' });
    expect(await next.getItem('h')).toEqual(['a cat']);
    // 新实例在已迁移库里新增 store 也能正常工作。
    const other = localforage.createInstance({ name: 'iris', storeName: 'brand-new-store' });
    await other.setItem('k', 1);
    expect(await other.getItem('k')).toBe(1);
  });
});
