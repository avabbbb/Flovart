import localforage from 'localforage';

/**
 * Canvas image body store. References stay in project JSON; large data URLs live
 * in a dedicated localforage/IndexedDB store.
 */

const imageStorage = localforage.createInstance({
    name: 'flovart-images',
    storeName: 'images',
});

export const IDB_PREFIX = 'idb:';

export const isIdbRef = (s: string | undefined | null): s is `${typeof IDB_PREFIX}${string}` =>
    typeof s === 'string' && s.startsWith(IDB_PREFIX);

export const isDataUrl = (s: string | undefined | null): s is string =>
    typeof s === 'string' && s.startsWith('data:');

export const toIdbRef = (key: string): string => `${IDB_PREFIX}${key}`;

export const fromIdbRef = (ref: string): string => ref.slice(IDB_PREFIX.length);

export async function putImage(key: string, dataUrl: string): Promise<void> {
    await imageStorage.setItem(key, dataUrl);
}

export async function putImages(entries: { key: string; data: string }[]): Promise<void> {
    await Promise.all(entries.map(({ key, data }) => imageStorage.setItem(key, data)));
}

export async function getImage(key: string): Promise<string | null> {
    return imageStorage.getItem<string>(key);
}

export async function getImages(keys: string[]): Promise<Map<string, string>> {
    const entries = await Promise.all(keys.map(async key => [key, await getImage(key)] as const));
    return new Map(entries.filter((entry): entry is readonly [string, string] => entry[1] !== null));
}

export async function deleteImages(keys: string[]): Promise<void> {
    await Promise.all(keys.map(key => imageStorage.removeItem(key)));
}

export async function getAllKeys(): Promise<string[]> {
    return imageStorage.keys();
}
