import type { GenerationHistoryItem } from '../types';
import { offloadDataUrlRecords, rehydrateDataUrlRecords } from './mediaIndexedDBSentry';

const STORAGE_KEY = 'making.generationHistory.v1';
const MAX_HISTORY_ITEMS = 18;
/** 历史记录存储的缩略图最大尺寸 — 避免 localStorage 爆炸 */
const THUMBNAIL_MAX_DIM = 256;

export const loadGenerationHistory = (): GenerationHistoryItem[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const saveGenerationHistory = (items: GenerationHistoryItem[]) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (err) {
        console.error('[Storage] Failed to save generation history', err);
        // 降级: 只保留最近 6 条再试一次
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 6)));
        } catch {
            // 彻底放弃持久化, 不阻断业务
        }
    }
};

export const loadGenerationHistoryAsync = async (): Promise<GenerationHistoryItem[]> => {
    const items = loadGenerationHistory();
    return await rehydrateDataUrlRecords(items);
};

export const saveGenerationHistoryAsync = async (items: GenerationHistoryItem[]) => {
    try {
        const slim = await offloadDataUrlRecords(items, 'history');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch (err) {
        console.error('[Storage] Failed to save generation history', err);
        try {
            const slim = await offloadDataUrlRecords(items.slice(0, 6), 'history');
            localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
        } catch {
            // Give up quietly. History is optional persistence.
        }
    }
};

/**
 * 将 base64 dataUrl 压缩为缩略图, 减少 localStorage 占用
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
