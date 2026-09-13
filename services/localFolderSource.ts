import localforage from 'localforage';
import { nanoid } from 'nanoid';

/**
 * 本地文件夹直读素材源。
 *
 * 语义（与 ADR 0071 一致）：引用原文件，不复制字节。目录句柄保存在本机
 * IndexedDB，只缓存缩略图与视频封面，原文件始终从用户授权的目录按需读取。
 *
 * 授权范围由用户在浏览器原生授权框中确认；刷新后浏览器会要求一次用户手势
 * 重新授权，此时 `getLocalFolderPermission` 返回 `prompt`，由入口显式提供
 * “重新连接”动作，不静默降级。
 *
 * 浏览器无法读取任意本地路径。助手给定文件夹路径的场景需要走 CLI/MCP 与本地
 * 服务，属于独立切片，不在这里用猜测路径实现。
 */

export const LOCAL_FOLDER_HREF_PREFIX = 'local-folder:';

const SOURCE_KEY_PREFIX = 'source:';
const HANDLE_KEY_PREFIX = 'handle:';

export type LocalFolderMediaKind = 'image' | 'video' | 'audio';
export type LocalFolderPermission = 'granted' | 'prompt' | 'denied' | 'missing';

export class LocalFolderError extends Error {
  constructor(readonly code: 'UNSUPPORTED' | 'PERMISSION' | 'MISSING' | 'READ_FAILED', message: string) {
    super(message);
    this.name = 'LocalFolderError';
  }
}

export interface LocalFolderSource {
  id: string;
  name: string;
  createdAt: string;
  /**
   * 句柄是否成功落盘。目录句柄只能靠 IndexedDB 的结构化克隆保存；
   * 保存失败时该文件夹仍可在本次会话内使用，但刷新后需要重新选择。
   */
  persisted: boolean;
}

export interface LocalFolderEntry {
  folderId: string;
  relativePath: string;
  name: string;
  kind: LocalFolderMediaKind;
  mimeType: string;
  bytes: number;
  lastModified: number;
}

const sourcesStorage = localforage.createInstance({
  name: 'flovart_local_folder',
  storeName: 'sources',
});

const thumbnailsStorage = localforage.createInstance({
  name: 'flovart_local_folder',
  storeName: 'thumbnails',
});

const EXTENSION_KINDS: Record<string, { kind: LocalFolderMediaKind; mimeType: string }> = {
  png: { kind: 'image', mimeType: 'image/png' },
  jpg: { kind: 'image', mimeType: 'image/jpeg' },
  jpeg: { kind: 'image', mimeType: 'image/jpeg' },
  webp: { kind: 'image', mimeType: 'image/webp' },
  gif: { kind: 'image', mimeType: 'image/gif' },
  avif: { kind: 'image', mimeType: 'image/avif' },
  bmp: { kind: 'image', mimeType: 'image/bmp' },
  svg: { kind: 'image', mimeType: 'image/svg+xml' },
  mp4: { kind: 'video', mimeType: 'video/mp4' },
  m4v: { kind: 'video', mimeType: 'video/x-m4v' },
  mov: { kind: 'video', mimeType: 'video/quicktime' },
  webm: { kind: 'video', mimeType: 'video/webm' },
  ogv: { kind: 'video', mimeType: 'video/ogg' },
  mp3: { kind: 'audio', mimeType: 'audio/mpeg' },
  wav: { kind: 'audio', mimeType: 'audio/wav' },
  m4a: { kind: 'audio', mimeType: 'audio/mp4' },
  aac: { kind: 'audio', mimeType: 'audio/aac' },
  flac: { kind: 'audio', mimeType: 'audio/flac' },
  ogg: { kind: 'audio', mimeType: 'audio/ogg' },
  opus: { kind: 'audio', mimeType: 'audio/opus' },
};

/** 扫描边界：只列媒体文件，限制深度与数量，避免一次扫描产出几百个节点级条目。 */
export const LOCAL_FOLDER_SCAN_LIMITS = { maxDepth: 3, maxEntries: 600 } as const;

type DirectoryHandleLike = {
  kind: 'directory';
  name: string;
  entries?: () => AsyncIterableIterator<[string, DirectoryHandleLike | FileHandleLike]>;
  values?: () => AsyncIterableIterator<DirectoryHandleLike | FileHandleLike>;
  getDirectoryHandle: (name: string) => Promise<DirectoryHandleLike>;
  getFileHandle: (name: string) => Promise<FileHandleLike>;
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
};
type FileHandleLike = { kind: 'file'; name: string; getFile: () => Promise<File> };

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<DirectoryHandleLike>;
};

function picker(): PickerWindow['showDirectoryPicker'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as PickerWindow).showDirectoryPicker;
}

/** 目录直读依赖 File System Access API；跨域 iframe 宿主中可能被浏览器禁用。 */
export function isLocalFolderSupported(): boolean {
  return typeof picker() === 'function';
}

export function localFolderMediaKind(name: string): { kind: LocalFolderMediaKind; mimeType: string } | null {
  const extension = name.split('.').pop()?.toLowerCase() || '';
  return EXTENSION_KINDS[extension] || null;
}

export function localFolderHref(folderId: string, relativePath: string): string {
  return `${LOCAL_FOLDER_HREF_PREFIX}${folderId}/${relativePath.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`;
}

export function isLocalFolderHref(href: string | undefined | null): boolean {
  return typeof href === 'string' && href.startsWith(LOCAL_FOLDER_HREF_PREFIX);
}

export function parseLocalFolderHref(href: string): { folderId: string; relativePath: string } | null {
  if (!isLocalFolderHref(href)) return null;
  const rest = href.slice(LOCAL_FOLDER_HREF_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const folderId = rest.slice(0, slash);
  const relativePath = rest.slice(slash + 1).split('/').map(segment => decodeURIComponent(segment)).filter(Boolean).join('/');
  return relativePath ? { folderId, relativePath } : null;
}

/** 句柄落盘失败时的会话内兜底；刷新后由用户重新选择，不静默降级成复制副本。 */
const sessionHandles = new Map<string, DirectoryHandleLike>();

function isDirectoryHandle(candidate: unknown): candidate is DirectoryHandleLike {
  const handle = candidate as DirectoryHandleLike | null;
  return Boolean(handle && handle.kind === 'directory' && typeof handle.getDirectoryHandle === 'function');
}

async function saveHandle(folderId: string, handle: DirectoryHandleLike): Promise<boolean> {
  sessionHandles.set(folderId, handle);
  try {
    await sourcesStorage.setItem(`${HANDLE_KEY_PREFIX}${folderId}`, handle);
    return true;
  } catch {
    return false;
  }
}

async function loadHandle(folderId: string): Promise<DirectoryHandleLike | null> {
  const session = sessionHandles.get(folderId);
  if (session) return session;
  try {
    const stored = await sourcesStorage.getItem<DirectoryHandleLike>(`${HANDLE_KEY_PREFIX}${folderId}`);
    if (isDirectoryHandle(stored)) return stored;
  } catch {
    // 读不到句柄等同于需要用户重新授权。
  }
  return null;
}

async function saveSource(handle: DirectoryHandleLike, id = nanoid()): Promise<LocalFolderSource> {
  const persisted = await saveHandle(id, handle);
  const source: LocalFolderSource = {
    id,
    name: handle.name,
    createdAt: new Date().toISOString(),
    persisted,
  };
  await sourcesStorage.setItem(`${SOURCE_KEY_PREFIX}${source.id}`, source);
  return source;
}

export async function listLocalFolderSources(): Promise<LocalFolderSource[]> {
  const keys = await sourcesStorage.keys();
  const sources: LocalFolderSource[] = [];
  for (const key of keys) {
    if (!key.startsWith(SOURCE_KEY_PREFIX)) continue;
    const source = await sourcesStorage.getItem<LocalFolderSource>(key);
    if (!source?.id || !source.name) continue;
    sources.push({
      ...source,
      persisted: source.persisted !== false && (sessionHandles.has(source.id) || await readPersistedHandle(source.id)),
    });
  }
  return sources.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

async function readPersistedHandle(folderId: string): Promise<boolean> {
  try {
    return isDirectoryHandle(await sourcesStorage.getItem<DirectoryHandleLike>(`${HANDLE_KEY_PREFIX}${folderId}`));
  } catch {
    return false;
  }
}

export async function loadLocalFolderHandle(folderId: string): Promise<DirectoryHandleLike | null> {
  return loadHandle(folderId);
}

export async function forgetLocalFolderSource(folderId: string): Promise<void> {
  sessionHandles.delete(folderId);
  await Promise.all([
    sourcesStorage.removeItem(`${SOURCE_KEY_PREFIX}${folderId}`).catch(() => undefined),
    sourcesStorage.removeItem(`${HANDLE_KEY_PREFIX}${folderId}`).catch(() => undefined),
    clearLocalFolderThumbnails(folderId),
  ]);
}

async function requireHandle(folderId: string): Promise<DirectoryHandleLike> {
  const handle = await loadLocalFolderHandle(folderId);
  if (!handle) throw new LocalFolderError('MISSING', '本地文件夹授权已失效，请重新选择该文件夹。');
  return handle;
}

/** 让用户选择并授权一个文件夹，首次授权即确定读取范围。 */
export async function pickLocalFolder(): Promise<LocalFolderSource> {
  const showDirectoryPicker = picker();
  if (!showDirectoryPicker) {
    throw new LocalFolderError('UNSUPPORTED', '当前环境不支持直接读取本地文件夹，请改用素材导入或桌面端入口。');
  }
  const handle = await showDirectoryPicker({ mode: 'read', id: 'flovart-local-folder' });
  const existing = await listLocalFolderSources();
  const match = existing.find(source => source.name === handle.name);
  return saveSource(handle, match?.id);
}

/** 拖入的目录句柄同样可以成为素材源；没有句柄时不做“复制一份”的静默降级。 */
export async function adoptLocalFolderHandle(handle: unknown): Promise<LocalFolderSource> {
  const candidate = handle as DirectoryHandleLike | null;
  if (!candidate || candidate.kind !== 'directory' || typeof candidate.getDirectoryHandle !== 'function') {
    throw new LocalFolderError('UNSUPPORTED', '只能拖入文件夹本身，单个文件请继续走素材导入。');
  }
  const existing = await listLocalFolderSources();
  const match = existing.find(source => source.name === candidate.name);
  return saveSource(candidate, match?.id);
}

export async function getLocalFolderPermission(folderId: string): Promise<LocalFolderPermission> {
  const handle = await loadLocalFolderHandle(folderId);
  if (!handle) return 'missing';
  if (typeof handle.queryPermission !== 'function') return 'granted';
  try {
    const state = await handle.queryPermission({ mode: 'read' });
    if (state === 'granted') return 'granted';
    return state === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'prompt';
  }
}

/** 必须在用户手势中调用；刷新后重新获得同一目录的读取权限。 */
export async function requestLocalFolderPermission(folderId: string): Promise<boolean> {
  const handle = await loadLocalFolderHandle(folderId);
  if (!handle) return false;
  if (typeof handle.requestPermission !== 'function') return true;
  try {
    return await handle.requestPermission({ mode: 'read' }) === 'granted';
  } catch {
    return false;
  }
}

export async function scanLocalFolder(
  folderId: string,
  limits: { maxDepth?: number; maxEntries?: number } = {},
): Promise<LocalFolderEntry[]> {
  const maxDepth = limits.maxDepth ?? LOCAL_FOLDER_SCAN_LIMITS.maxDepth;
  const maxEntries = limits.maxEntries ?? LOCAL_FOLDER_SCAN_LIMITS.maxEntries;
  const root = await requireHandle(folderId);

  if (await getLocalFolderPermission(folderId) !== 'granted') {
    throw new LocalFolderError('PERMISSION', '需要重新确认该文件夹的读取权限后才能浏览。');
  }

  const entries: LocalFolderEntry[] = [];
  const walk = async (directory: DirectoryHandleLike, prefix: string, depth: number): Promise<void> => {
    if (entries.length >= maxEntries) return;
    const iterator = typeof directory.entries === 'function'
      ? directory.entries()
      : typeof directory.values === 'function'
        ? directory.values()
        : null;
    if (!iterator) return;
    for await (const item of iterator) {
      if (entries.length >= maxEntries) return;
      const [name, handle] = Array.isArray(item)
        ? item
        : [(item as DirectoryHandleLike | FileHandleLike).name, item as DirectoryHandleLike | FileHandleLike];
      if (!name || name.startsWith('.')) continue;
      const relativePath = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'file') {
        const media = localFolderMediaKind(name);
        if (!media) continue;
        try {
          const file = await handle.getFile();
          entries.push({
            folderId,
            relativePath,
            name,
            kind: media.kind,
            mimeType: file.type || media.mimeType,
            bytes: file.size,
            lastModified: file.lastModified,
          });
        } catch {
          // 单个文件读不到不影响整个目录的浏览结果。
        }
      } else if (depth < maxDepth) {
        await walk(handle as DirectoryHandleLike, relativePath, depth + 1);
      }
    }
  };

  await walk(root, '', 1);
  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

/** 按需读取原文件；原文件被移动、重命名或授权失效时给出可执行的错误。 */
export async function readLocalFolderFile(folderId: string, relativePath: string): Promise<File> {
  const root = await requireHandle(folderId);
  const segments = relativePath.split('/').filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) throw new LocalFolderError('MISSING', '素材引用无效，请重新选择文件。');
  try {
    let directory = root;
    for (const segment of segments) directory = await directory.getDirectoryHandle(segment);
    const fileHandle = await directory.getFileHandle(fileName);
    return await fileHandle.getFile();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new LocalFolderError('PERMISSION', '该文件夹的读取权限已失效，请重新连接本地文件夹。');
    }
    throw new LocalFolderError('MISSING', '原文件已被移动或重命名，请重新定位本地文件夹。');
  }
}

function thumbnailKey(entry: Pick<LocalFolderEntry, 'folderId' | 'relativePath' | 'lastModified'>): string {
  return `${entry.folderId}:${entry.relativePath}:${entry.lastModified}`;
}

/** 缩略图是派生缓存：文件改动后按 lastModified 自动失效，不写进项目 JSON。 */
export async function readLocalFolderThumbnail(entry: Pick<LocalFolderEntry, 'folderId' | 'relativePath' | 'lastModified'>): Promise<Blob | null> {
  return thumbnailsStorage.getItem<Blob>(thumbnailKey(entry));
}

export async function writeLocalFolderThumbnail(
  entry: Pick<LocalFolderEntry, 'folderId' | 'relativePath' | 'lastModified'>,
  blob: Blob,
): Promise<void> {
  await thumbnailsStorage.setItem(thumbnailKey(entry), blob);
}

async function clearLocalFolderThumbnails(folderId: string): Promise<void> {
  const keys = await thumbnailsStorage.keys();
  await Promise.all(
    keys.filter(key => key.startsWith(`${folderId}:`)).map(key => thumbnailsStorage.removeItem(key).catch(() => undefined)),
  );
}

/** 限制缩略图生成的并发，避免一次展开几十个大文件。 */
export function createThumbnailLimiter(concurrency = 3) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active -= 1;
    queue.shift()?.();
  };
  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active += 1;
        task().then(resolve, reject).finally(next);
      };
      if (active < concurrency) start();
      else queue.push(start);
    });
  };
}
