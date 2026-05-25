const DB_NAME = 'FlovartMediaColdStorage';
const STORE_NAME = 'media_blobs';
const DB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;

export const initMediaDB = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    if (dbInstance) {
        resolve(dbInstance);
        return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
        }
    };

    request.onsuccess = () => {
        dbInstance = request.result;
        dbInstance.onclose = () => { dbInstance = null; };
        dbInstance.onversionchange = () => {
            dbInstance?.close();
            dbInstance = null;
        };
        resolve(dbInstance);
    };

    request.onerror = () => {
        dbInstance = null;
        reject(new Error(`IndexedDB init failed: ${request.error?.message || 'unknown error'}`));
    };
});

export const writeColdMedia = async (elementId: string, blobData: string): Promise<void> => {
    const db = await initMediaDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(blobData, elementId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB write failed'));
    });
};

export const readColdMedia = async (elementId: string): Promise<string | null> => {
    const db = await initMediaDB();
    return new Promise((resolve) => {
        const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(elementId);
        request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
        request.onerror = () => resolve(null);
    });
};

export const eraseColdMedia = async (elementId: string): Promise<void> => {
    const db = await initMediaDB();
    return new Promise((resolve) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).delete(elementId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
    });
};
