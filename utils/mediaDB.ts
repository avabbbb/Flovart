import localforage from 'localforage';

/** Video Blob bodies live separately from project JSON in localforage/IndexedDB. */
const videoStorage = localforage.createInstance({
  name: 'flovart-media',
  storeName: 'videos',
});

export const IDB_VIDEO_PREFIX = 'idb-video:';

export const isIdbVideoRef = (s: string | undefined | null): s is `${typeof IDB_VIDEO_PREFIX}${string}` =>
  typeof s === 'string' && s.startsWith(IDB_VIDEO_PREFIX);

export const toIdbVideoRef = (key: string): string => `${IDB_VIDEO_PREFIX}${key}`;

export const fromIdbVideoRef = (ref: string): string => ref.slice(IDB_VIDEO_PREFIX.length);

export async function putVideoBlob(key: string, blob: Blob): Promise<void> {
  await videoStorage.setItem(key, blob);
}

export async function getVideoBlob(key: string): Promise<Blob | null> {
  return videoStorage.getItem<Blob>(key);
}

export async function deleteVideoBlobs(keys: string[]): Promise<void> {
  await Promise.all(keys.map(key => videoStorage.removeItem(key)));
}

export async function getAllVideoKeys(): Promise<string[]> {
  return videoStorage.keys();
}
