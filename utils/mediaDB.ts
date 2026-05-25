/**
 * IndexedDB Blob store for video media.
 * Mirrors the pattern in imageDB.ts but stores Blobs (not strings).
 * Key convention: `board:${elementId}` — same dynamic key pattern as images.
 */

const DB_NAME = 'flovart-media';
const STORE_NAME = 'videos';
const DB_VERSION = 1;

export const IDB_VIDEO_PREFIX = 'idb-video:';

export const isIdbVideoRef = (s: string | undefined | null): s is string =>
  typeof s === 'string' && s.startsWith(IDB_VIDEO_PREFIX);

export const toIdbVideoRef = (key: string): string => `${IDB_VIDEO_PREFIX}${key}`;

export const fromIdbVideoRef = (ref: string): string => ref.slice(IDB_VIDEO_PREFIX.length);

// ── singleton connection ──

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

// ── public API ──

/** Store a video blob. */
export async function putVideoBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Retrieve a video blob. Returns null if not found. */
export async function getVideoBlob(key: string): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve((req.result as Blob) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteVideoBlobs(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const key of keys) store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllVideoKeys(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
}
