import localforage from 'localforage';

const storage = localforage.createInstance({
  name: 'flovart',
  storeName: 'workflow_projects',
});

const mediaStorage = localforage.createInstance({
  name: 'flovart',
  storeName: 'workflow_media',
});

export const workflowStorage = {
  async get<T>(key: string): Promise<T | null> {
    const value = await storage.getItem<string>(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  },
  async set<T>(key: string, value: T): Promise<void> {
    await storage.setItem(key, JSON.stringify(value));
  },
  async remove(key: string): Promise<void> {
    await storage.removeItem(key);
  },
  async clear(): Promise<void> {
    await storage.clear();
  },
};

export const workflowMediaStorage = {
  async get(key: string): Promise<Blob | null> {
    return mediaStorage.getItem<Blob>(key);
  },
  async set(key: string, value: Blob): Promise<void> {
    await mediaStorage.setItem(key, value);
  },
  async remove(key: string): Promise<void> {
    await mediaStorage.removeItem(key);
  },
  async keys(): Promise<string[]> {
    return mediaStorage.keys();
  },
  async clear(): Promise<void> {
    await mediaStorage.clear();
  },
};
