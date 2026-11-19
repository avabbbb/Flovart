// 2026-11-20 产品由 Flovart 更名为 Iris：浏览器里所有 key / 数据库名从 flovart* 改成 iris*。
// 首次加载时把旧数据复制到新名字（localStorage、sessionStorage、IndexedDB / localforage），
// 必须在任何 store 打开数据库之前运行（index.tsx 先 await 本函数再动态 import 应用）。
// 规则：
// - 只复制、不删除旧数据（本版本保留，回滚到 flovart-final 仍可读）；
// - 新名字下已有值（或新库的同名 object store 非空）就不覆盖；
// - 全部成功后写入完成标记，之后启动只读一次 localStorage 就返回；
// - 任何一步失败只记日志、不阻塞应用启动（下次启动会重试未完成的部分）。

export const LEGACY_MIGRATION_FLAG = 'iris.migration.fromFlovart.v1';

/** 旧数据库名（含 localforage 实例名）。indexedDB.databases() 不可用时用这份清单兜底。 */
export const LEGACY_DATABASE_NAMES = [
  'flovart',
  'flovart_workflow_v2',
  'flovart_local_folder',
  'flovart-images',
  'flovart-media',
  'FlovartMediaColdStorage',
  'flovart_agent_tasks_v1',
  'flovart-eval-v1',
  'flovart-latency-v1',
  'flovart_usage_v2',
] as const;

/** 与仓库内更名规则一致：FLOVART→IRIS、Flovart→Iris、flovart→iris。 */
export function irisNameFor(legacyName: string): string {
  return legacyName.replace(/FLOVART/g, 'IRIS').replace(/Flovart/g, 'Iris').replace(/flovart/g, 'iris');
}

const isLegacyName = (name: string) => /flovart/i.test(name);

export function migrateLegacyWebStorage(storage: Storage | undefined | null): number {
  if (!storage) return 0;
  let copied = 0;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isLegacyName(key)) keys.push(key);
  }
  for (const key of keys) {
    const target = irisNameFor(key);
    if (target === key || storage.getItem(target) !== null) continue;
    const value = storage.getItem(key);
    if (value === null) continue;
    storage.setItem(target, value);
    copied += 1;
  }
  return copied;
}

type Idb = IDBFactory;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 打开已存在的库；库不存在时返回 null 且不创建空库。 */
function openExisting(idb: Idb, name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let created = false;
    const open = idb.open(name);
    open.onupgradeneeded = () => {
      created = true;
      open.transaction?.abort();
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => {
      if (created) resolve(null);
      else reject(open.error);
    };
    open.onblocked = () => reject(new Error('blocked: ' + name));
  });
}

function openWithStores(idb: Idb, name: string, stores: { name: string; keyPath: string | string[] | null; autoIncrement: boolean }[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const probe = idb.open(name);
    probe.onerror = () => reject(probe.error);
    probe.onblocked = () => reject(new Error('blocked: ' + name));
    probe.onsuccess = () => {
      const db = probe.result;
      const missing = stores.filter(store => !db.objectStoreNames.contains(store.name));
      if (!missing.length) {
        resolve(db);
        return;
      }
      const version = db.version + 1;
      db.close();
      const upgrade = idb.open(name, version);
      upgrade.onupgradeneeded = () => {
        for (const store of missing) {
          upgrade.result.createObjectStore(store.name, { keyPath: store.keyPath ?? undefined, autoIncrement: store.autoIncrement });
        }
      };
      upgrade.onsuccess = () => resolve(upgrade.result);
      upgrade.onerror = () => reject(upgrade.error);
      upgrade.onblocked = () => reject(new Error('blocked: ' + name));
    };
  });
}

/** 把一个旧库的全部 object store 复制到新库（新库同名 store 为空时才写入）。返回复制的记录数。 */
export async function copyLegacyDatabase(idb: Idb, legacyName: string, targetName = irisNameFor(legacyName)): Promise<number> {
  const source = await openExisting(idb, legacyName);
  if (!source) return 0;
  try {
    const storeNames = Array.from(source.objectStoreNames);
    if (!storeNames.length) return 0;
    const shapes = storeNames.map(name => {
      const store = source.transaction(name, 'readonly').objectStore(name);
      return { name, keyPath: store.keyPath as string | string[] | null, autoIncrement: store.autoIncrement };
    });
    const target = await openWithStores(idb, targetName, shapes);
    let copied = 0;
    try {
      for (const shape of shapes) {
        const existing = await request(target.transaction(shape.name, 'readonly').objectStore(shape.name).count());
        if (existing > 0) continue;
        const readStore = source.transaction(shape.name, 'readonly').objectStore(shape.name);
        const [keys, values] = await Promise.all([request(readStore.getAllKeys()), request(readStore.getAll())]);
        if (!keys.length) continue;
        await new Promise<void>((resolve, reject) => {
          const tx = target.transaction(shape.name, 'readwrite');
          const store = tx.objectStore(shape.name);
          keys.forEach((key, index) => {
            if (shape.keyPath === null) store.put(values[index], key);
            else store.put(values[index]);
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('aborted'));
        });
        copied += keys.length;
      }
    } finally {
      target.close();
    }
    return copied;
  } finally {
    source.close();
  }
}

async function legacyDatabaseNames(idb: Idb): Promise<string[]> {
  const names = new Set<string>(LEGACY_DATABASE_NAMES);
  try {
    const listed = typeof idb.databases === 'function' ? await idb.databases() : [];
    for (const info of listed) if (info.name && isLegacyName(info.name)) names.add(info.name);
  } catch {
    // Some browsers do not implement databases(); the static list covers our own databases.
  }
  return [...names];
}

export interface LegacyMigrationResult {
  skipped: boolean;
  localStorage: number;
  sessionStorage: number;
  indexedDb: Record<string, number>;
  errors: string[];
}

export async function migrateLegacyBrowserStorage(env: { localStorage?: Storage | null; sessionStorage?: Storage | null; indexedDB?: IDBFactory | null } = {
  localStorage: typeof localStorage === 'undefined' ? null : localStorage,
  sessionStorage: typeof sessionStorage === 'undefined' ? null : sessionStorage,
  indexedDB: typeof indexedDB === 'undefined' ? null : indexedDB,
}): Promise<LegacyMigrationResult> {
  const result: LegacyMigrationResult = { skipped: false, localStorage: 0, sessionStorage: 0, indexedDb: {}, errors: [] };
  // sessionStorage 每个标签页独立，不受完成标记约束。
  try { result.sessionStorage = migrateLegacyWebStorage(env.sessionStorage); } catch (error) { result.errors.push('sessionStorage: ' + String(error)); }
  try {
    if (env.localStorage?.getItem(LEGACY_MIGRATION_FLAG)) {
      result.skipped = true;
      return result;
    }
  } catch {
    // localStorage unavailable (privacy mode); continue best-effort.
  }
  try { result.localStorage = migrateLegacyWebStorage(env.localStorage); } catch (error) { result.errors.push('localStorage: ' + String(error)); }
  if (env.indexedDB) {
    for (const name of await legacyDatabaseNames(env.indexedDB)) {
      try {
        result.indexedDb[name] = await copyLegacyDatabase(env.indexedDB, name);
      } catch (error) {
        result.errors.push(name + ': ' + String(error));
      }
    }
  }
  if (!result.errors.length) {
    try { env.localStorage?.setItem(LEGACY_MIGRATION_FLAG, new Date().toISOString()); } catch { /* ignore */ }
  } else {
    console.warn('[Iris] 旧 Flovart 数据迁移未全部完成，下次启动重试', result.errors);
  }
  return result;
}
