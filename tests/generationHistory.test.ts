/**
 * generationHistory 单元测试 — 测试生成历史的增删、去重和截断
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addGenerationHistoryItem } from '../utils/generationHistory';
import type { GenerationHistoryItem } from '../types';

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: vi.fn((key: string) => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
        removeItem: vi.fn((key: string) => { delete store[key]; }),
        clear: vi.fn(() => { store = {}; }),
    };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

const makeItem = (id: string, prompt = 'test'): GenerationHistoryItem => ({
    id,
    dataUrl: `data:image/png;base64,${id}`,
    mimeType: 'image/png',
    width: 100,
    height: 100,
    prompt,
    createdAt: Date.now(),
});

describe('generationHistory', () => {
    beforeEach(() => {
        localStorageMock.clear();
    });

    it('添加新项到列表头部', () => {
        const items: GenerationHistoryItem[] = [];
        const newItem = makeItem('a');
        const result = addGenerationHistoryItem(items, newItem);
        expect(result[0].id).toBe('a');
        expect(result.length).toBe(1);
    });

    it('去重：相同 dataUrl 不会重复', () => {
        const existing = makeItem('a');
        const duplicate = { ...makeItem('b'), dataUrl: existing.dataUrl };
        const result = addGenerationHistoryItem([existing], duplicate);
        expect(result.length).toBe(1);
        expect(result[0].id).toBe('b');
    });

    it('超过 18 条时截断', () => {
        const items = Array.from({ length: 18 }, (_, i) => makeItem(`item-${i}`));
        const newItem = makeItem('new');
        const result = addGenerationHistoryItem(items, newItem);
        expect(result.length).toBe(18);
        expect(result[0].id).toBe('new');
    });

});
