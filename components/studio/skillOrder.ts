/**
 * Hub 里 Skill 卡片的自定义顺序：纯函数 + localStorage 持久化。
 * 只存 key 列表（`mine:<id>` / `bundled:<id>` …），不碰主 store（持久化 version 4 不动）。
 */

export const SKILL_ORDER_KEY = 'flovart.studioHub.skillOrder.v1';

export function loadSkillOrder(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): string[] {
  try {
    const raw = storage?.getItem(SKILL_ORDER_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? [...new Set(parsed.filter((key): key is string => typeof key === 'string' && key.length > 0))] : [];
  } catch {
    return [];
  }
}

export function saveSkillOrder(order: readonly string[], storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try { storage?.setItem(SKILL_ORDER_KEY, JSON.stringify([...new Set(order)])); } catch { /* 隐私模式 / 配额满：顺序只在本次会话有效 */ }
}

/** 按保存的顺序排：保存过的在前（按保存顺序），新出现的保持原相对顺序排在后面。 */
export function applySkillOrder<T>(items: readonly T[], order: readonly string[], keyOf: (item: T) => string): T[] {
  const rank = new Map(order.map((key, index) => [key, index]));
  return items
    .map((item, index) => ({ item, index, rank: rank.get(keyOf(item)) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
      if (a.rank !== undefined) return -1;
      if (b.rank !== undefined) return 1;
      return a.index - b.index;
    })
    .map(entry => entry.item);
}

/** 把 list 中 from 位置的元素移到 to 位置（to 是移动后的下标）。越界时夹到两端；不改原数组。 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  if (target === from) return next;
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/**
 * 在当前可见（已筛选）的顺序里把 key 挪到 toIndex，再写回完整顺序：
 * 不可见的 key 留在原位，可见的 key 依次填回它们原来占的位置。
 * fullOrder 里没有的可见 key 会补到末尾。
 */
export function reorderVisible(fullOrder: readonly string[], visible: readonly string[], key: string, toIndex: number): string[] {
  const from = visible.indexOf(key);
  if (from < 0) return [...fullOrder];
  const moved = moveItem(visible, from, toIndex);
  const visibleSet = new Set(visible);
  const base = [...new Set(fullOrder)];
  for (const item of visible) if (!base.includes(item)) base.push(item);
  let cursor = 0;
  return base.map(item => (visibleSet.has(item) ? moved[cursor++] : item));
}

export interface SlotRect { left: number; top: number; width: number; height: number }

/**
 * 拖动时的落点：离指针最近的格子（按中心点距离），即被拖卡片移动后的下标（与 moveItem 的 to 一致）。
 * 原位格子也参与比较（它在拖动时保持为空位）；没有格子时返回 -1。
 */
export function dropIndexAt(slots: readonly SlotRect[], point: { x: number; y: number }): number {
  if (!slots.length) return -1;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  slots.forEach((slot, index) => {
    const cx = slot.left + slot.width / 2;
    const cy = slot.top + slot.height / 2;
    const distance = (cx - point.x) ** 2 + (cy - point.y) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = index; }
  });
  return best;
}

/** 键盘调整：Alt + ←/↑ 往前，Alt + →/↓ 往后；其余按键返回 0。 */
export function keyboardMoveDelta(event: { key: string; altKey: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): -1 | 0 | 1 {
  if (!event.altKey || event.ctrlKey || event.metaKey) return 0;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') return -1;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') return 1;
  return 0;
}
