// 本地存储统计：枚举本站点的 IndexedDB 数据库与对象仓库，估算条数与体积，并读取浏览器配额。
// 只读，不打开不存在的库（onupgradeneeded 时中止），不改任何数据。

export interface StoreStat {
  name: string;
  count: number;
  bytes: number;
}

export interface DatabaseStat {
  name: string;
  version: number;
  bytes: number;
  stores: StoreStat[];
  error?: string;
}

export interface StorageReport {
  databases: DatabaseStat[];
  /** 按仓库内容估算的 IndexedDB 总体积 */
  indexedDbBytes: number;
  /** navigator.storage.estimate().usage：站点总占用（含 IndexedDB、Cache 等） */
  usage: number | null;
  /** navigator.storage.estimate().quota：浏览器分配的可用配额 */
  quota: number | null;
  supported: { databases: boolean; estimate: boolean };
  collectedAt: number;
}

export interface StorageStatsEnv {
  indexedDB?: IDBFactory;
  storage?: Pick<StorageManager, 'estimate'>;
}

/** 估算结构化克隆后的体积：字符串按 UTF-16 计，Blob/ArrayBuffer 取真实字节数。 */
export function estimateValueBytes(value: unknown, seen: WeakSet<object> = new WeakSet()): number {
  if (value === null || value === undefined) return 0;
  switch (typeof value) {
    case 'string': return value.length * 2;
    case 'number':
    case 'bigint': return 8;
    case 'boolean': return 4;
    case 'object': break;
    default: return 0;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof Date) return 8;
  const obj = value as object;
  if (seen.has(obj)) return 0;
  seen.add(obj);
  let total = 0;
  if (Array.isArray(value)) {
    for (const item of value) total += estimateValueBytes(item, seen);
    return total;
  }
  if (value instanceof Map) {
    for (const [key, item] of value) total += estimateValueBytes(key, seen) + estimateValueBytes(item, seen);
    return total;
  }
  if (value instanceof Set) {
    for (const item of value) total += estimateValueBytes(item, seen);
    return total;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    total += key.length * 2 + estimateValueBytes(item, seen);
  }
  return total;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return (unit === 0 ? String(Math.round(value)) : value.toFixed(unit >= 3 ? 2 : 1)) + ' ' + units[unit];
}

/** 配额使用率（0-100），缺任一值返回 null。 */
export function usagePercent(usage: number | null, quota: number | null): number | null {
  if (usage === null || quota === null || quota <= 0) return null;
  return Math.min(100, (usage / quota) * 100);
}

function openExisting(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name);
    request.onupgradeneeded = () => {
      // 库不存在：中止升级，避免统计时凭空创建空库。
      request.transaction?.abort();
      reject(new Error('database not found'));
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('open failed'));
    request.onblocked = () => reject(new Error('open blocked'));
  });
}

function measureStore(db: IDBDatabase, storeName: string): Promise<StoreStat> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const cursorRequest = tx.objectStore(storeName).openCursor();
    let count = 0;
    let bytes = 0;
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      count += 1;
      bytes += estimateValueBytes(cursor.key) + estimateValueBytes(cursor.value);
      cursor.continue();
    };
    tx.oncomplete = () => resolve({ name: storeName, count, bytes });
    tx.onerror = () => reject(tx.error || new Error('read failed'));
    tx.onabort = () => reject(tx.error || new Error('read aborted'));
  });
}

async function measureDatabase(factory: IDBFactory, name: string, version: number): Promise<DatabaseStat> {
  let db: IDBDatabase | undefined;
  try {
    db = await openExisting(factory, name);
    const stores: StoreStat[] = [];
    for (const storeName of Array.from(db.objectStoreNames)) {
      try {
        stores.push(await measureStore(db, storeName));
      } catch (error) {
        stores.push({ name: storeName, count: 0, bytes: 0 });
        console.warn('[storageStats] store read failed', name, storeName, error);
      }
    }
    stores.sort((a, b) => b.bytes - a.bytes);
    return { name, version: db.version || version, bytes: stores.reduce((sum, item) => sum + item.bytes, 0), stores };
  } catch (error) {
    return { name, version, bytes: 0, stores: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    db?.close();
  }
}

export async function collectStorageReport(env: StorageStatsEnv = {}): Promise<StorageReport> {
  const factory = env.indexedDB ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined);
  const storage = env.storage ?? (typeof navigator !== 'undefined' ? navigator.storage : undefined);
  const canListDatabases = !!factory && typeof factory.databases === 'function';
  const canEstimate = !!storage && typeof storage.estimate === 'function';

  const databases: DatabaseStat[] = [];
  if (factory && canListDatabases) {
    const infos = await factory.databases();
    for (const info of infos) {
      if (!info.name) continue;
      databases.push(await measureDatabase(factory, info.name, info.version ?? 0));
    }
    databases.sort((a, b) => b.bytes - a.bytes);
  }

  let usage: number | null = null;
  let quota: number | null = null;
  if (canEstimate) {
    try {
      const estimate = await storage!.estimate();
      usage = typeof estimate.usage === 'number' ? estimate.usage : null;
      quota = typeof estimate.quota === 'number' ? estimate.quota : null;
    } catch (error) {
      console.warn('[storageStats] estimate failed', error);
    }
  }

  return {
    databases,
    indexedDbBytes: databases.reduce((sum, item) => sum + item.bytes, 0),
    usage,
    quota,
    supported: { databases: canListDatabases, estimate: canEstimate },
    collectedAt: Date.now(),
  };
}
