// 代理文件存储：优先 OPFS（navigator.storage.getDirectory，按需读、磁盘支持的 File），
// 不支持 OPFS 时退回 IndexedDB（localforage）。键 = 素材 id + 代理高度。
const DIR = 'iris-cut-proxies';

function fileName(sourceId: string, height: number) {
  return `${sourceId.replace(/[^a-zA-Z0-9_-]+/g, '_')}-${height}p.mp4`;
}

async function opfsDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage?.getDirectory?.();
    return root ? await root.getDirectoryHandle(DIR, { create: true }) : null;
  } catch {
    return null;
  }
}

async function forage() {
  const { default: localforage } = await import('localforage');
  return localforage.createInstance({ name: 'iris-cut', storeName: 'proxies' });
}

export async function writeProxyFile(sourceId: string, height: number, blob: Blob): Promise<Blob> {
  const dir = await opfsDir();
  const name = fileName(sourceId, height);
  if (dir) {
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return handle.getFile();
  }
  const store = await forage();
  await store.setItem(name, blob);
  return blob;
}

export async function readProxyFile(sourceId: string, height: number): Promise<Blob | null> {
  const name = fileName(sourceId, height);
  const dir = await opfsDir();
  if (dir) {
    try { return await (await dir.getFileHandle(name)).getFile(); } catch { /* fall through */ }
  }
  try { return (await (await forage()).getItem<Blob>(name)) ?? null; } catch { return null; }
}

export async function deleteProxyFile(sourceId: string, height?: number) {
  const heights = height ? [height] : [360, 540, 720];
  const dir = await opfsDir();
  for (const h of heights) {
    const name = fileName(sourceId, h);
    if (dir) await dir.removeEntry(name).catch(() => undefined);
    await (await forage()).removeItem(name).catch(() => undefined);
  }
}
