import localforage from 'localforage';
import type { GenerationHistoryItem } from '../types';
import { offloadDataUrlRecords, rehydrateDataUrlRecords } from './mediaIndexedDBSentry';

const STORAGE_KEY = 'items';
const MAX_HISTORY_ITEMS = 18;
/** 历史元数据存 localforage，媒体正文由 mediaIndexedDBSentry 转为 Blob 引用。 */
export const generationHistoryStorage = localforage.createInstance({
    name: 'flovart',
    storeName: 'generation_history_v2',
});
const THUMBNAIL_MAX_DIM = 256;

export const loadGenerationHistoryAsync = async (): Promise<GenerationHistoryItem[]> => {
    try {
        const items = await generationHistoryStorage.getItem<GenerationHistoryItem[]>(STORAGE_KEY);
        return await rehydrateDataUrlRecords(Array.isArray(items) ? items : []);
    } catch (error) {
        console.error('[Storage] Failed to load generation history', error);
        return [];
    }
};

export const saveGenerationHistoryAsync = async (items: GenerationHistoryItem[]) => {
    try {
        const slim = await offloadDataUrlRecords(items, 'history');
        await generationHistoryStorage.setItem(STORAGE_KEY, slim);
    } catch (err) {
        console.error('[Storage] Failed to save generation history', err);
        try {
            const slim = await offloadDataUrlRecords(items.slice(0, 6), 'history');
            await generationHistoryStorage.setItem(STORAGE_KEY, slim);
        } catch {
            // Give up quietly. History is optional persistence.
        }
    }
};

/**
 * 将 base64 dataUrl 压缩为缩略图，降低浏览器本地存储与渲染成本。
 * 在浏览器主线程上同步返回 Promise
 */
export const createThumbnailDataUrl = (
    dataUrl: string,
    maxDim: number = THUMBNAIL_MAX_DIM,
): Promise<string> => {
    return new Promise((resolve) => {
        // 如果已经很小, 直接返回 (SVG / 非常短的 base64)
        if (dataUrl.length < 8000) { resolve(dataUrl); return; }
        const img = new Image();
        img.onload = () => {
            const { width: ow, height: oh } = img;
            if (ow <= maxDim && oh <= maxDim) { resolve(dataUrl); return; }
            const scale = Math.min(maxDim / ow, maxDim / oh);
            const nw = Math.round(ow * scale);
            const nh = Math.round(oh * scale);
            const canvas = document.createElement('canvas');
            canvas.width = nw;
            canvas.height = nh;
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve(dataUrl); return; }
            ctx.drawImage(img, 0, 0, nw, nh);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
};

export const addGenerationHistoryItem = (
    items: GenerationHistoryItem[],
    item: GenerationHistoryItem
): GenerationHistoryItem[] => {
    return [item, ...items.filter(existing => existing.dataUrl !== item.dataUrl)].slice(0, MAX_HISTORY_ITEMS);
};
