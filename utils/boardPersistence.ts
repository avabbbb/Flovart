import type { Board, ImageElement, VideoElement, CharacterLockProfile } from '../types';
import { createNewBoard } from './canvasHelpers';
import { putImages, getImages, isIdbRef, isDataUrl, toIdbRef, fromIdbRef, deleteImages, getAllKeys } from './imageDB';
import { putVideoBlob, getVideoBlob, isIdbVideoRef, toIdbVideoRef, fromIdbVideoRef, deleteVideoBlobs, getAllVideoKeys } from './mediaDB';

export const BOARDS_STORAGE_KEY = 'boards.v1';
export const ACTIVE_BOARD_STORAGE_KEY = 'boards.activeId.v1';

const STORAGE_QUOTA_ERROR_NAMES = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']);
export const STORAGE_QUOTA_MESSAGE = '本地存储空间不足，无法保存最新画布。请删除部分历史图片或导出后清理项目。';
export const STORAGE_SAVE_FAILED_MESSAGE = '保存画布失败，请刷新后重试。';
export const IMAGE_GENERATION_TIMEOUT_MS = 180_000;
export const VIDEO_GENERATION_TIMEOUT_MS = 660_000;

const isStorageQuotaError = (error: unknown): boolean => {
    if (!(error instanceof DOMException)) return false;
    return STORAGE_QUOTA_ERROR_NAMES.has(error.name) || error.code === 22 || error.code === 1014;
};

export const safeSetItem = (key: string, value: string): boolean => {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (err) {
        console.error(`[Storage] Failed to write "${key}" (${(value.length / 1024).toFixed(0)} KB)`, err);
        return false;
    }
};

export async function persistBoardsToIDB(boards: Board[]): Promise<void> {
    const imageEntries: { key: string; data: string }[] = [];
    const videoPromises: Promise<void>[] = [];
    const usedImageKeys = new Set<string>();
    const usedVideoKeys = new Set<string>();
    const slim = boards.map(b => {
        const persistedElements = b.elements.map(el => {
            if (el.type === 'image') {
                const img = { ...el } as ImageElement;
                if (isDataUrl(img.href)) {
                    const key = `board:${el.id}`;
                    usedImageKeys.add(key);
                    imageEntries.push({ key, data: img.href });
                    img.href = toIdbRef(key);
                } else if (isIdbRef(img.href)) {
                    usedImageKeys.add(fromIdbRef(img.href));
                }
                if (img.mask && isDataUrl(img.mask)) {
                    const key = `board:${el.id}:mask`;
                    usedImageKeys.add(key);
                    imageEntries.push({ key, data: img.mask });
                    img.mask = toIdbRef(key);
                } else if (img.mask && isIdbRef(img.mask)) {
                    usedImageKeys.add(fromIdbRef(img.mask));
                }
                return img;
            }
            if (el.type === 'video' && (el as VideoElement).href.startsWith('blob:')) {
                const vid = { ...el } as VideoElement;
                const key = `board:${el.id}`;
                usedVideoKeys.add(key);
                videoPromises.push(
                    fetch(vid.href)
                        .then(r => r.blob())
                        .then(blob => putVideoBlob(key, blob))
                        .catch(() => { /* best-effort */ })
                );
                vid.href = toIdbVideoRef(key);
                return vid;
            }
            if (el.type === 'video' && isIdbVideoRef((el as VideoElement).href)) {
                usedVideoKeys.add(fromIdbVideoRef((el as VideoElement).href));
            }
            return el;
        });

        return {
            ...b,
            elements: persistedElements,
            history: [persistedElements],
            historyIndex: 0,
        };
    });
    if (imageEntries.length > 0) await putImages(imageEntries);
    await Promise.all(videoPromises);
    const serialized = JSON.stringify(slim);
    try {
        localStorage.setItem(BOARDS_STORAGE_KEY, serialized);
    } catch (err) {
        if (!isStorageQuotaError(err)) throw err;
        localStorage.removeItem(BOARDS_STORAGE_KEY);
        localStorage.setItem(BOARDS_STORAGE_KEY, serialized);
    }

    const [allImageKeys, allVideoKeys] = await Promise.all([getAllKeys(), getAllVideoKeys()]);
    const staleImageKeys = allImageKeys.filter(key => key.startsWith('board:') && !usedImageKeys.has(key));
    const staleVideoKeys = allVideoKeys.filter(key => key.startsWith('board:') && !usedVideoKeys.has(key));
    await Promise.all([
        deleteImages(staleImageKeys),
        deleteVideoBlobs(staleVideoKeys),
    ]);
}

export async function loadBoardsWithIDB(): Promise<Board[]> {
    let boards: Board[];
    try {
        const raw = localStorage.getItem(BOARDS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!Array.isArray(parsed) || parsed.length === 0) {
            return [createNewBoard('Board 1')];
        }
        boards = parsed.filter((board): board is Board =>
            !!board && typeof board.id === 'string' && typeof board.name === 'string' && Array.isArray(board.elements)
        );
        if (boards.length === 0) return [createNewBoard('Board 1')];
    } catch {
        return [createNewBoard('Board 1')];
    }
    const refs: string[] = [];
    const videoRefs: { boardIdx: number; elIdx: number; key: string }[] = [];
    for (let bi = 0; bi < boards.length; bi++) {
        const b = boards[bi];
        for (let ei = 0; ei < b.elements.length; ei++) {
            const el = b.elements[ei];
            if (el.type === 'image') {
                const img = el as ImageElement;
                if (isIdbRef(img.href)) refs.push(fromIdbRef(img.href));
                if (img.mask && isIdbRef(img.mask)) refs.push(fromIdbRef(img.mask));
            }
            if (el.type === 'video' && isIdbVideoRef((el as VideoElement).href)) {
                videoRefs.push({ boardIdx: bi, elIdx: ei, key: fromIdbVideoRef((el as VideoElement).href) });
            }
        }
    }
    const resolved = refs.length > 0 ? await getImages(refs) : new Map<string, string>();
    const videoBlobs = new Map<string, Blob>();
    await Promise.all(videoRefs.map(async ({ key }) => {
        const blob = await getVideoBlob(key);
        if (blob) videoBlobs.set(key, blob);
    }));

    return boards.map(b => ({
        ...b,
        elements: b.elements.map(el => {
            if (el.type === 'image') {
                const img = { ...el } as ImageElement;
                if (isIdbRef(img.href)) {
                    const data = resolved.get(fromIdbRef(img.href));
                    if (data) img.href = data;
                }
                if (img.mask && isIdbRef(img.mask)) {
                    const data = resolved.get(fromIdbRef(img.mask));
                    if (data) img.mask = data;
                }
                return img;
            }
            if (el.type === 'video' && isIdbVideoRef((el as VideoElement).href)) {
                const key = fromIdbVideoRef((el as VideoElement).href);
                const blob = videoBlobs.get(key);
                if (blob) return { ...el, href: URL.createObjectURL(blob) } as VideoElement;
            }
            return el;
        }),
    }));
}

export async function loadCharacterLocksWithIDB(): Promise<CharacterLockProfile[]> {
    try {
        const raw = localStorage.getItem('characterLocks.v1');
        if (!raw) return [];
        const locks: CharacterLockProfile[] = JSON.parse(raw);
        const refs = locks.filter(l => isIdbRef(l.referenceImage)).map(l => fromIdbRef(l.referenceImage));
        if (refs.length === 0) return locks;
        const resolved = await getImages(refs);
        return locks.map(lock => {
            if (isIdbRef(lock.referenceImage)) {
                const data = resolved.get(fromIdbRef(lock.referenceImage));
                if (data) return { ...lock, referenceImage: data };
            }
            return lock;
        });
    } catch {
        return [];
    }
}

export async function persistCharacterLocksToIDB(locks: CharacterLockProfile[]): Promise<void> {
    const entries: { key: string; data: string }[] = [];
    const usedKeys = new Set<string>();
    const slim = locks.map(lock => {
        if (isDataUrl(lock.referenceImage)) {
            const key = `charlock:${lock.id}`;
            usedKeys.add(key);
            entries.push({ key, data: lock.referenceImage });
            return { ...lock, referenceImage: toIdbRef(key) };
        }
        if (isIdbRef(lock.referenceImage)) {
            usedKeys.add(fromIdbRef(lock.referenceImage));
        }
        return lock;
    });
    if (entries.length > 0) await putImages(entries);
    safeSetItem('characterLocks.v1', JSON.stringify(slim));

    const allKeys = await getAllKeys();
    const staleKeys = allKeys.filter(key => key.startsWith('charlock:') && !usedKeys.has(key));
    await deleteImages(staleKeys);
}
