// Bench-only: in-memory stand-in for localforage so the browser kernel runs under Node.
function createStore() {
  const store = new Map<string, unknown>();
  return {
    async getItem<T>(key: string): Promise<T | null> { return (store.has(key) ? structuredClone(store.get(key)) : null) as T | null; },
    async setItem<T>(key: string, value: T): Promise<T> { store.set(key, structuredClone(value)); return value; },
    async removeItem(key: string): Promise<void> { store.delete(key); },
    async keys(): Promise<string[]> { return [...store.keys()]; },
    async clear(): Promise<void> { store.clear(); },
    async iterate<T>(fn: (value: T, key: string) => unknown): Promise<void> { for (const [k, v] of store) fn(v as T, k); },
    config() { return true; },
    ready: async () => undefined,
    createInstance: () => createStore(),
  };
}
export default createStore();
