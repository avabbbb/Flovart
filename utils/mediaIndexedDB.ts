import localforage from 'localforage';

const coldMediaStorage = localforage.createInstance({
    name: 'FlovartMediaColdStorage',
    storeName: 'media_blobs',
});

export const initMediaDB = async (): Promise<typeof coldMediaStorage> => {
    await coldMediaStorage.ready();
    return coldMediaStorage;
};

export const writeColdMedia = async (elementId: string, blobData: string): Promise<void> => {
    await coldMediaStorage.setItem(elementId, blobData);
};

export const readColdMedia = async (elementId: string): Promise<string | null> => {
    try {
        return await coldMediaStorage.getItem<string>(elementId);
    } catch {
        return null;
    }
};

export const eraseColdMedia = async (elementId: string): Promise<void> => {
    try {
        await coldMediaStorage.removeItem(elementId);
    } catch {
        // Cold media cleanup is best effort.
    }
};
