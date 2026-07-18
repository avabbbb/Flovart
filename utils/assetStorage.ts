/**
 * ============================================
 * 素材存储工具 (Asset Storage) v2 — 文件夹 + 标签双轴
 * ============================================
 *
 * 【模块职责】
 * 负责灵感库数据的本地持久化存储，使用 localforage (IndexedDB) 实现。
 *
 * 【数据结构】
 * AssetLibrary = {
 *   folders: AssetFolder[],  // 扁平文件夹数组，靠 parentId 串成树
 *   items:   AssetItem[],   // 扁平素材列表，每个 item 通过 folderIds 多归属
 * }
 *
 * AssetItem = {
 *   id, name?, folderIds: string[], tags: string[],
 *   dataUrl, mimeType, width, height, createdAt, source?, ...
 * }
 *
 * 【存储键名】
 * localforage 实例 `flovart` / store `asset_library_v2`。
 * 旧版 localStorage key `making.assetLibrary.v1` 在首次加载时一次性迁移到 v2，
 * 迁移完成后删除 v1 key。dataUrl 不再分离到 IndexedDB sentry，整体落入 localforage。
 */

import localforage from 'localforage';
import type { AssetLibrary, AssetItem, AssetFolder } from '../types';

const V1_STORAGE_KEY = 'making.assetLibrary.v1';
const V2_STORE_NAME = 'asset_library_v2';

const assetStore = localforage.createInstance({
  name: 'flovart',
  storeName: V2_STORE_NAME,
});

const EMPTY_LIBRARY: AssetLibrary = { folders: [], items: [] };

/**
 * 模块级缓存：首次 loadAssetLibraryAsync 后缓存，避免工作流每个素材节点
 * 渲染时都重复全量读取 IndexedDB。App.tsx 在加载/增删改素材后会调用
 * setAssetLibraryCache 同步更新缓存；null 表示清空。
 */
let cachedLibrary: AssetLibrary | null = null;

export function setAssetLibraryCache(lib: AssetLibrary | null): void {
  cachedLibrary = lib;
}

export function getAssetLibraryCache(): AssetLibrary | null {
  return cachedLibrary;
}

/**
 * 按 assetId 单条读取素材。命中缓存即同步返回，否则触发一次全量加载并写缓存。
 * 工作流节点 storageKey = `asset-library:<assetId>` 的解析入口。
 */
export async function getAssetById(assetId: string): Promise<AssetItem | undefined> {
  if (!cachedLibrary) cachedLibrary = await loadAssetLibraryAsync();
  return cachedLibrary.items.find(a => a.id === assetId);
}

/** 旧版 character/scene/prop 桶到迁移文件夹的映射 */
const MIGRATE_FOLDER_DEFS: Array<{ legacyKey: 'character' | 'scene' | 'prop'; name: string; tag: string }> = [
  { legacyKey: 'character', name: 'Characters', tag: 'character' },
  { legacyKey: 'scene', name: 'Scenes', tag: 'scene' },
  { legacyKey: 'prop', name: 'Props', tag: 'prop' },
];

interface LegacyAssetItem {
  id: string;
  name?: string;
  category: 'character' | 'scene' | 'prop';
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  createdAt: number;
  source?: AssetItem['source'];
  sourceUrl?: string;
  prompt?: string;
  provider?: string;
  model?: string;
  generationParams?: Record<string, unknown>;
}

interface LegacyAssetLibrary {
  character: LegacyAssetItem[];
  scene: LegacyAssetItem[];
  prop: LegacyAssetItem[];
}

/**
 * 一次性迁移：把 localStorage 中的 v1 三桶结构迁移到 v2 文件夹+标签结构。
 * - 为每个旧 category 创建一个迁移文件夹（Characters / Scenes / Props），id 形如 `migrate-<cat>`。
 * - 每个 legacy item 转为 AssetItem，folderIds=[对应迁移文件夹 id]、tags=[旧 category 名]。
 * - 迁移成功后删除 v1 localStorage key，避免重复迁移。
 * 返回迁移后的 AssetLibrary；若无 v1 数据返回 null。
 */
async function migrateV1ToV2(): Promise<AssetLibrary | null> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(V1_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (!raw) return null;

  let legacy: LegacyAssetLibrary;
  try {
    legacy = JSON.parse(raw) as LegacyAssetLibrary;
  } catch {
    // 解析失败，不要删除原数据，让用户手动恢复
    console.warn('[assetStorage] v1 数据解析失败，跳过迁移');
    return null;
  }

  const now = Date.now();
  const folders: AssetFolder[] = MIGRATE_FOLDER_DEFS.map((def) => ({
    id: `migrate-${def.legacyKey}`,
    name: def.name,
    parentId: null,
    createdAt: now,
  }));
  const folderIdByLegacyKey: Record<string, string> = {
    character: 'migrate-character',
    scene: 'migrate-scene',
    prop: 'migrate-prop',
  };

  const items: AssetItem[] = [];
  for (const def of MIGRATE_FOLDER_DEFS) {
    const bucket = legacy[def.legacyKey] || [];
    for (const legacyItem of bucket) {
      items.push({
        id: legacyItem.id,
        name: legacyItem.name,
        folderIds: [folderIdByLegacyKey[def.legacyKey]],
        tags: [def.tag],
        dataUrl: legacyItem.dataUrl,
        mimeType: legacyItem.mimeType,
        width: legacyItem.width,
        height: legacyItem.height,
        createdAt: legacyItem.createdAt,
        source: legacyItem.source,
        sourceUrl: legacyItem.sourceUrl,
        prompt: legacyItem.prompt,
        provider: legacyItem.provider,
        model: legacyItem.model,
        generationParams: legacyItem.generationParams,
      });
    }
  }

  const migrated: AssetLibrary = { folders, items };
  try {
    await assetStore.setItem('library', migrated);
    // 迁移成功后清理 v1 key
    try { localStorage.removeItem(V1_STORAGE_KEY); } catch { /* ignore */ }
  } catch (err) {
    console.error('[assetStorage] v1→v2 迁移写入失败，保留 v1 数据', err);
    return null;
  }
  return migrated;
}

/**
 * 异步加载素材库。首次启动会自动执行 v1→v2 迁移。
 */
export const loadAssetLibraryAsync = async (): Promise<AssetLibrary> => {
  // 先尝试 v1 迁移（若 v1 key 存在）
  const migrated = await migrateV1ToV2();
  if (migrated) return migrated;

  try {
    const stored = (await assetStore.getItem<AssetLibrary>('library')) ?? null;
    if (!stored) return { ...EMPTY_LIBRARY };
    return {
      folders: Array.isArray(stored.folders) ? stored.folders : [],
      items: Array.isArray(stored.items) ? stored.items : [],
    };
  } catch (err) {
    console.error('[assetStorage] 加载素材库失败', err);
    return { ...EMPTY_LIBRARY };
  }
};

/**
 * 异步保存素材库。
 */
export const saveAssetLibraryAsync = async (lib: AssetLibrary): Promise<void> => {
  try {
    await assetStore.setItem('library', lib);
  } catch (err) {
    console.error('[assetStorage] 保存素材库失败', err);
  }
};

/**
 * 添加素材。返回新 AssetLibrary，不修改原对象。
 * 去重：相同 id 或相同 dataUrl 已存在则跳过。
 */
export const addAsset = (lib: AssetLibrary, item: AssetItem): AssetLibrary => {
  if (lib.items.some((existing) => existing.id === item.id || existing.dataUrl === item.dataUrl)) {
    return lib;
  }
  return {
    ...lib,
    items: [item, ...lib.items],
  };
};

/**
 * 按 id 删除素材，返回新 AssetLibrary。
 * 注意：只删除 items 列表中的 item，不修改 folders；folder 上的归属关系自动随之失效。
 */
export const removeAsset = (lib: AssetLibrary, id: string): AssetLibrary => ({
  ...lib,
  items: lib.items.filter((a) => a.id !== id),
});

/**
 * 按 id 重命名素材，返回新 AssetLibrary。
 */
export const renameAsset = (lib: AssetLibrary, id: string, name: string): AssetLibrary => ({
  ...lib,
  items: lib.items.map((a) => (a.id === id ? { ...a, name } : a)),
});

/**
 * 添加文件夹。返回新 AssetLibrary。
 */
export const addFolder = (lib: AssetLibrary, folder: AssetFolder): AssetLibrary => ({
  ...lib,
  folders: [...lib.folders, folder],
});

/**
 * 删除文件夹（递归解除子文件夹和 items 的归属关系，可选递归删除 items）。
 * - 默认（deleteItems=false）：只删除 folder 本身，子文件夹解除 parentId 链、items 解除 folderId 归属。
 * - deleteItems=true：递归删除该 folder 子树下的所有 items（item 若仍有其它 folderIds 则保留，只解归）。
 */
export const removeFolder = (lib: AssetLibrary, folderId: string, deleteItems: boolean): AssetLibrary => {
  // 收集要删除的 folder 子树
  const toRemove = new Set<string>();
  const queue: string[] = [folderId];
  while (queue.length) {
    const cur = queue.shift()!;
    if (toRemove.has(cur)) continue;
    toRemove.add(cur);
    for (const f of lib.folders) {
      if (f.parentId === cur) queue.push(f.id);
    }
  }

  const folders = lib.folders.filter((f) => !toRemove.has(f.id));

  let items: AssetItem[];
  if (deleteItems) {
    // items 的 folderIds 全部落在子树内的，删除整个 item；否则仅解归
    items = lib.items
      .map((item) => {
        const remainingFolderIds = item.folderIds.filter((fid) => !toRemove.has(fid));
        if (remainingFolderIds.length === item.folderIds.length) return item; // 不受影响
        if (remainingFolderIds.length === 0) return null; // 全部属于被删子树
        return { ...item, folderIds: remainingFolderIds };
      })
      .filter((x): x is AssetItem => x !== null);
  } else {
    // 仅解归：从 items 的 folderIds 中移除被删子树 id
    items = lib.items.map((item) => {
      const remainingFolderIds = item.folderIds.filter((fid) => !toRemove.has(fid));
      if (remainingFolderIds.length === item.folderIds.length) return item;
      return { ...item, folderIds: remainingFolderIds };
    });
  }

  return { folders, items };
};

/**
 * 重命名文件夹。
 */
export const renameFolder = (lib: AssetLibrary, folderId: string, name: string): AssetLibrary => ({
  ...lib,
  folders: lib.folders.map((f) => (f.id === folderId ? { ...f, name } : f)),
});

/**
 * 把 item 加入到指定文件夹（多归属：folderIds 去重追加）。
 */
export const addAssetToFolder = (lib: AssetLibrary, itemId: string, folderId: string): AssetLibrary => ({
  ...lib,
  items: lib.items.map((a) =>
    a.id === itemId && !a.folderIds.includes(folderId)
      ? { ...a, folderIds: [...a.folderIds, folderId] }
      : a,
  ),
});

/**
 * 把 item 从指定文件夹中移除（仅解除归属，不删除 item）。
 */
export const removeAssetFromFolder = (lib: AssetLibrary, itemId: string, folderId: string): AssetLibrary => ({
  ...lib,
  items: lib.items.map((a) =>
    a.id === itemId && a.folderIds.includes(folderId)
      ? { ...a, folderIds: a.folderIds.filter((fid) => fid !== folderId) }
      : a,
  ),
});

/**
 * 更新 item 的标签数组（覆盖式）。传入新 tags 列表。
 */
export const updateAssetTags = (lib: AssetLibrary, itemId: string, tags: string[]): AssetLibrary => ({
  ...lib,
  items: lib.items.map((a) => (a.id === itemId ? { ...a, tags } : a)),
});

/**
 * 批量修改多个 item 的归属：把每个 item 的 folderIds 全部移除（变为"全部素材"下未归类）。
 */
export const detachAssetsFromAllFolders = (lib: AssetLibrary, itemIds: string[]): AssetLibrary => ({
  ...lib,
  items: lib.items.map((a) => (itemIds.includes(a.id) ? { ...a, folderIds: [] } : a)),
});

/**
 * 批量为多个 item 追加同一个文件夹归属（去重）。
 */
export const batchAddAssetsToFolder = (lib: AssetLibrary, itemIds: string[], folderId: string): AssetLibrary => ({
  ...lib,
  items: lib.items.map((a) =>
    itemIds.includes(a.id) && !a.folderIds.includes(folderId)
      ? { ...a, folderIds: [...a.folderIds, folderId] }
      : a,
  ),
});

/**
 * 批量为多个 item 追加同一个标签（去重）。
 */
export const batchAddAssetTags = (lib: AssetLibrary, itemIds: string[], tags: string[]): AssetLibrary => ({
  ...lib,
  items: lib.items.map((a) =>
    itemIds.includes(a.id)
      ? { ...a, tags: Array.from(new Set([...a.tags, ...tags])) }
      : a,
  ),
});

/**
 * 批量删除多个 item。
 */
export const batchRemoveAssets = (lib: AssetLibrary, itemIds: string[]): AssetLibrary => ({
  ...lib,
  items: lib.items.filter((a) => !itemIds.includes(a.id)),
});
