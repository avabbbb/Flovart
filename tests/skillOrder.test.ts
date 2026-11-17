import { describe, expect, it } from 'vitest';

import { applySkillOrder, dropIndexAt, keyboardMoveDelta, loadSkillOrder, moveItem, reorderVisible, saveSkillOrder, SKILL_ORDER_KEY } from '../components/studio/skillOrder';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
}

describe('hub skill card order', () => {
  it('moves an item forwards and backwards and clamps out-of-range targets', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 99)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 1, -5)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });

  it('applies a saved order and keeps unknown items after it in their original order', () => {
    const items = [{ key: 'x' }, { key: 'a' }, { key: 'y' }, { key: 'b' }];
    expect(applySkillOrder(items, ['b', 'gone', 'a'], item => item.key).map(item => item.key)).toEqual(['b', 'a', 'x', 'y']);
    expect(applySkillOrder(items, [], item => item.key).map(item => item.key)).toEqual(['x', 'a', 'y', 'b']);
  });

  it('reorders inside a filtered view without moving hidden skills', () => {
    const full = ['a', 'h1', 'b', 'h2', 'c'];
    // 只看得见 a b c：把 c 拖到最前
    expect(reorderVisible(full, ['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'h1', 'a', 'h2', 'b']);
    // 可见顺序与完整顺序不同（例如按名称排序后拖动）：可见格子按新顺序填回
    expect(reorderVisible(['a', 'b', 'c'], ['c', 'b', 'a'], 'a', 0)).toEqual(['a', 'c', 'b']);
    // 新出现的可见 key 补到末尾
    expect(reorderVisible(['a'], ['a', 'n'], 'n', 0)).toEqual(['n', 'a']);
    expect(reorderVisible(['a', 'b'], ['a', 'b'], 'missing', 0)).toEqual(['a', 'b']);
  });

  it('picks the slot nearest to the pointer as the drop index', () => {
    const slots = [0, 1, 2, 3].map(index => ({ left: (index % 2) * 220, top: Math.floor(index / 2) * 260, width: 200, height: 240 }));
    expect(dropIndexAt(slots, { x: 100, y: 120 })).toBe(0);
    expect(dropIndexAt(slots, { x: 330, y: 110 })).toBe(1);
    expect(dropIndexAt(slots, { x: 300, y: 400 })).toBe(3);
    expect(dropIndexAt([], { x: 0, y: 0 })).toBe(-1);
  });

  it('maps Alt + arrow keys to a move and ignores everything else', () => {
    expect(keyboardMoveDelta({ key: 'ArrowLeft', altKey: true })).toBe(-1);
    expect(keyboardMoveDelta({ key: 'ArrowUp', altKey: true })).toBe(-1);
    expect(keyboardMoveDelta({ key: 'ArrowRight', altKey: true })).toBe(1);
    expect(keyboardMoveDelta({ key: 'ArrowDown', altKey: true })).toBe(1);
    expect(keyboardMoveDelta({ key: 'ArrowDown', altKey: false })).toBe(0);
    expect(keyboardMoveDelta({ key: 'ArrowDown', altKey: true, metaKey: true })).toBe(0);
    expect(keyboardMoveDelta({ key: 'Enter', altKey: true })).toBe(0);
  });

  it('persists the order to its own localStorage key and survives bad data', () => {
    const storage = memoryStorage();
    saveSkillOrder(['b', 'a', 'b'], storage);
    expect(storage.data.get(SKILL_ORDER_KEY)).toBe('["b","a"]');
    expect(loadSkillOrder(storage)).toEqual(['b', 'a']);
    expect(loadSkillOrder(memoryStorage({ [SKILL_ORDER_KEY]: '{oops' }))).toEqual([]);
    expect(loadSkillOrder(memoryStorage({ [SKILL_ORDER_KEY]: '[1,"a",""]' }))).toEqual(['a']);
  });
});

describe('composer drop zone', () => {
  it('keeps only the part of the composer that the hub window does not cover', async () => {
    const { uncoveredPart } = await import('../components/studio/useSkillCardDrag');
    const composer = { left: 1085, top: 701, width: 334, height: 151 };
    expect(uncoveredPart(composer, { left: 180, top: 90, width: 1080, height: 720 })).toEqual({ left: 1260, top: 701, width: 159, height: 151 });
    expect(uncoveredPart(composer, undefined)).toEqual(composer);
    expect(uncoveredPart(composer, { left: 0, top: 0, width: 2000, height: 2000 })).toBeNull();
  });
});
