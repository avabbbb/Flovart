import { fromIdbRef, getImages, isDataUrl, isIdbRef, putImages, toIdbRef } from './imageDB';

type MediaFieldRecord = {
    id: string;
    dataUrl: string;
};

export async function offloadDataUrlRecords<T extends MediaFieldRecord>(
    items: T[],
    keyPrefix: string,
): Promise<T[]> {
    const entries: { key: string; data: string }[] = [];
    const slim = items.map((item) => {
        if (!isDataUrl(item.dataUrl)) return item;
        const key = `${keyPrefix}:${item.id}`;
        entries.push({ key, data: item.dataUrl });
        return { ...item, dataUrl: toIdbRef(key) };
    });

    if (entries.length > 0) {
        await putImages(entries);
    }

    return slim;
}

export async function rehydrateDataUrlRecords<T extends MediaFieldRecord>(items: T[]): Promise<T[]> {
    const refs = items
        .filter((item) => isIdbRef(item.dataUrl))
        .map((item) => fromIdbRef(item.dataUrl));

    if (refs.length === 0) return items;

    const resolved = await getImages(refs);
    return items.map((item) => {
        if (!isIdbRef(item.dataUrl)) return item;
        const hydrated = resolved.get(fromIdbRef(item.dataUrl));
        return hydrated ? { ...item, dataUrl: hydrated } : item;
    });
}
