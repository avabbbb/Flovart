// 所有「列表浮层」（模型 / Provider / 画布切换 / Skill / 历史 / 素材 / 节点类型 / 设置下拉……）共用的键盘规则。
// 行为见 docs/design/01-interaction.md 与 DESIGN.md「列表浮层键盘」：
//   1. 打开即可输入：搜索框自动聚焦；焦点在浮层内别处时，可打印字符转给搜索框。
//   2. ↑/↓ 移动可见高亮（默认回绕），跳过分组标题 / 禁用项，滚到可见；每次筛选后高亮第一项。
//   3. Enter 选中高亮项；Esc 先清空搜索，再关闭；悬停同步高亮。
//   4. listbox / option + aria-activedescendant，焦点始终留在输入框；输入法组字（isComposing）期间不处理任何键。
import type React from 'react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

type Navigable<T> = (item: T, index: number) => boolean;

/**
 * 下一个高亮下标。-1 表示「没有高亮 / 还在输入框」。
 * - wrap：首尾回绕；否则夹住在两端。
 * - exitAbove：第一项再按 ↑ 回到 -1（composer 里回到正文）；优先于夹住，不与 wrap 同用。
 * - isNavigable：返回 false 的下标（分组标题、禁用项）被跳过。
 */
export function moveListboxIndex(
  index: number,
  count: number,
  delta: 1 | -1,
  options: { wrap?: boolean; exitAbove?: boolean; isNavigable?: (index: number) => boolean } = {},
): number {
  const ok = options.isNavigable ?? (() => true);
  if (count <= 0) return -1;
  const first = firstNavigableIndex(count, ok);
  if (first < 0) return -1;
  if (index < 0 || index >= count) {
    if (delta > 0) return first;
    return options.wrap ? lastNavigableIndex(count, ok) : -1;
  }
  for (let next = index + delta; next >= 0 && next < count; next += delta) {
    if (ok(next)) return next;
  }
  // 越过边界
  if (options.wrap) return delta > 0 ? first : lastNavigableIndex(count, ok);
  if (delta < 0 && options.exitAbove) return -1;
  return index;
}

export function firstNavigableIndex(count: number, isNavigable: (index: number) => boolean = () => true): number {
  for (let index = 0; index < count; index += 1) if (isNavigable(index)) return index;
  return -1;
}

export function lastNavigableIndex(count: number, isNavigable: (index: number) => boolean = () => true): number {
  for (let index = count - 1; index >= 0; index -= 1) if (isNavigable(index)) return index;
  return -1;
}

/** 单个可打印字符（不含 Ctrl / ⌘ / Alt 组合键）。 */
export function isPrintableKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

/** 输入法组字中：Enter / 方向键属于输入法，不能被列表吃掉。 */
export function isComposingEvent(event: { nativeEvent?: unknown; isComposing?: boolean; keyCode?: number }): boolean {
  const native = (event.nativeEvent ?? event) as { isComposing?: boolean; keyCode?: number };
  return Boolean(native.isComposing || event.isComposing || native.keyCode === 229);
}

export function isEditableElement(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = ((element as HTMLInputElement).type || 'text').toLowerCase();
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
}

export interface ListboxKeyboardOptions<T> {
  /** 已筛选、按显示顺序排列的条目；可包含分组标题，用 isNavigable 排除。 */
  items: readonly T[];
  onSelect: (item: T, index: number) => void;
  /** 浮层是否打开；关闭时不聚焦、不处理键。默认 true。 */
  open?: boolean;
  /** 受控搜索词。提供 onQueryChange 时，焦点在浮层别处的输入会转给搜索框，Esc 会先清空它。 */
  query?: string;
  onQueryChange?: (query: string) => void;
  onClose?: () => void;
  isNavigable?: Navigable<T>;
  /** 没有搜索框时的「按首字母跳转」用；有搜索框时不需要。 */
  getLabel?: (item: T) => string;
  /** 打开（且无搜索词）时先高亮哪一项，例如当前已选中的模型；默认第一项。 */
  initialIndex?: number;
  /** 默认 true。 */
  wrap?: boolean;
  /** 打开时聚焦搜索框（没有搜索框就聚焦列表）。默认 true。 */
  autoFocus?: boolean;
  /** 其他会让列表内容整体换掉的状态（如切换 tab），变化时高亮回到第一项。 */
  resetKey?: unknown;
  /** option id 前缀；默认 useId()。 */
  id?: string;
}

export interface ListboxKeyboard {
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  listId: string;
  optionId: (index: number) => string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  listRef: React.RefObject<HTMLDivElement | null>;
  /** 处理一个键；返回 true 表示已消费（已 preventDefault）。可被外部输入框（如 composer）直接调用。 */
  onKeyDown: (event: React.KeyboardEvent) => boolean;
  /** 搜索框的 role / aria 与键盘；自身 onKeyDown 会先跑。 */
  getInputProps: (props?: React.InputHTMLAttributes<HTMLInputElement>) => React.InputHTMLAttributes<HTMLInputElement> & { ref: React.RefObject<HTMLInputElement | null> };
  /** 列表容器：role=listbox + id。 */
  getListboxProps: (props?: React.HTMLAttributes<HTMLDivElement>) => React.HTMLAttributes<HTMLDivElement> & { ref: React.RefObject<HTMLDivElement | null>; id: string; role: 'listbox' };
  /** 每个条目：role=option、id、高亮标记、悬停同步。 */
  getOptionProps: (index: number, props?: React.HTMLAttributes<HTMLElement>) => React.HTMLAttributes<HTMLElement> & { id: string; role: 'option'; 'data-listbox-active'?: 'true' };
  /** 浮层根节点：接住焦点不在搜索框时的键（可打印字符转给搜索框、方向键、Esc）。 */
  getContainerProps: (props?: React.HTMLAttributes<HTMLElement>) => React.HTMLAttributes<HTMLElement>;
}

const AUTO = -2; // 「跟随第一项 / initialIndex」

export function useListboxKeyboard<T>(options: ListboxKeyboardOptions<T>): ListboxKeyboard {
  const { items, onSelect, open = true, query, onQueryChange, onClose, isNavigable, getLabel, initialIndex, wrap = true, autoFocus = true, resetKey } = options;
  const generatedId = useId();
  const baseId = (options.id ?? `lbx${generatedId}`).replace(/[^a-zA-Z0-9_-]/g, '');
  const listId = `${baseId}-list`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const typeahead = useRef({ text: '', at: 0 });

  const count = items.length;
  const navigable = useCallback((index: number) => index >= 0 && index < items.length && (isNavigable ? isNavigable(items[index], index) : true), [items, isNavigable]);

  // 搜索词 / resetKey / 打开 变化时回到第一项（render 期间同步重置，避免闪一帧旧高亮）。
  const [raw, setRaw] = useState(AUTO);
  const [seen, setSeen] = useState({ query, resetKey, open });
  if (seen.query !== query || seen.resetKey !== resetKey || seen.open !== open) {
    setSeen({ query, resetKey, open });
    setRaw(AUTO);
  }
  const fallback = !query && initialIndex !== undefined && navigable(initialIndex) ? initialIndex : firstNavigableIndex(count, navigable);
  const activeIndex = raw !== AUTO && navigable(raw) ? raw : (raw === -1 ? -1 : fallback);
  const optionId = useCallback((index: number) => `${baseId}-opt-${index}`, [baseId]);

  // 打开即聚焦搜索框；没有搜索框则聚焦列表，键盘立刻可用。
  useLayoutEffect(() => {
    if (!open || !autoFocus) return;
    const target = inputRef.current ?? listRef.current;
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [open, autoFocus]);

  // 高亮项滚进可见区域。
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const element = document.getElementById(optionId(activeIndex));
    if (element && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, optionId]);

  const latest = useRef({ activeIndex, items, onSelect, query, onQueryChange, onClose, getLabel, navigable, count });
  latest.current = { activeIndex, items, onSelect, query, onQueryChange, onClose, getLabel, navigable, count };

  const onKeyDown = useCallback((event: React.KeyboardEvent): boolean => {
    if (!open || event.defaultPrevented || isComposingEvent(event)) return false;
    const state = latest.current;
    const target = event.target as HTMLElement | null;
    const fromSearch = Boolean(inputRef.current && target === inputRef.current);
    const fromOtherField = !fromSearch && isEditableElement(target);
    // 浮层里别的输入框（如「添加 Key」表单）照常打字，不被列表抢键。
    if (fromOtherField) return false;
    const consume = () => { event.preventDefault(); event.stopPropagation(); return true; };
    const key = event.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (event.altKey || event.metaKey || event.ctrlKey) return false;
      setRaw(moveListboxIndex(state.activeIndex, state.count, key === 'ArrowDown' ? 1 : -1, { wrap, isNavigable: state.navigable }));
      return consume();
    }
    if ((key === 'Home' || key === 'End') && !fromSearch) {
      setRaw(key === 'Home' ? firstNavigableIndex(state.count, state.navigable) : lastNavigableIndex(state.count, state.navigable));
      return consume();
    }
    if (key === 'Enter') {
      // 焦点在按钮上时让按钮自己响应。
      // 焦点在普通按钮上时让按钮自己响应；select-only combobox 的触发按钮（role=combobox）由列表处理。
      if (!fromSearch && target && target !== listRef.current && (target.tagName === 'BUTTON' || target.tagName === 'A') && target.getAttribute('role') !== 'combobox') return false;
      const item = state.activeIndex >= 0 ? state.items[state.activeIndex] : undefined;
      if (item === undefined) return false;
      state.onSelect(item, state.activeIndex);
      return consume();
    }
    if (key === 'Escape') {
      if (state.query && state.onQueryChange) { state.onQueryChange(''); return consume(); }
      if (state.onClose) { state.onClose(); return consume(); }
      return false;
    }
    if (fromSearch) return false;
    // 焦点不在搜索框：可打印字符与退格转给搜索框。
    if (state.onQueryChange && inputRef.current) {
      if (isPrintableKey(event)) {
        state.onQueryChange(`${state.query ?? ''}${key}`);
        inputRef.current.focus({ preventScroll: true });
        return consume();
      }
      if (key === 'Backspace') {
        state.onQueryChange((state.query ?? '').slice(0, -1));
        inputRef.current.focus({ preventScroll: true });
        return consume();
      }
      return false;
    }
    // 没有搜索框：按首字母跳转。
    if (state.getLabel && isPrintableKey(event) && key !== ' ') {
      const now = Date.now();
      const buffer = now - typeahead.current.at < 700 ? typeahead.current.text + key.toLowerCase() : key.toLowerCase();
      typeahead.current = { text: buffer, at: now };
      for (let offset = 0; offset < state.count; offset += 1) {
        const index = (Math.max(state.activeIndex, 0) + (buffer.length > 1 ? 0 : 1) + offset) % state.count;
        if (state.navigable(index) && state.getLabel(state.items[index]).toLowerCase().startsWith(buffer)) { setRaw(index); return consume(); }
      }
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, wrap]);

  const activeId = activeIndex >= 0 ? optionId(activeIndex) : undefined;

  return {
    activeIndex,
    setActiveIndex: setRaw,
    listId,
    optionId,
    inputRef,
    listRef,
    onKeyDown,
    getInputProps: (props = {}) => ({
      ...props,
      ref: inputRef,
      role: 'combobox',
      'aria-expanded': open,
      'aria-controls': listId,
      'aria-autocomplete': 'list',
      'aria-activedescendant': activeId,
      autoComplete: 'off',
      spellCheck: false,
      onKeyDown: event => {
        props.onKeyDown?.(event);
        if (!event.defaultPrevented) onKeyDown(event);
      },
    }),
    getListboxProps: (props = {}) => ({
      tabIndex: -1,
      ...props,
      ref: listRef,
      id: listId,
      role: 'listbox',
      'aria-activedescendant': inputRef.current ? undefined : activeId,
    }),
    getOptionProps: (index, props = {}) => ({
      ...props,
      id: optionId(index),
      role: 'option',
      ...(index === activeIndex ? { 'data-listbox-active': 'true' as const } : {}),
      onMouseMove: event => {
        props.onMouseMove?.(event);
        if (index !== latest.current.activeIndex && latest.current.navigable(index)) setRaw(index);
      },
    }),
    getContainerProps: (props = {}) => ({
      ...props,
      onKeyDown: event => {
        props.onKeyDown?.(event);
        // 搜索框自己的 onKeyDown 已处理过的键会带 defaultPrevented，冒泡到这里直接跳过。
        if (!event.defaultPrevented && event.target !== inputRef.current) onKeyDown(event);
      },
    }),
  };
}

const MENU_ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"]';

function menuItems(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR))
    .filter(item => !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true' && item.closest('[role="menu"],[role="listbox"]') === container);
}

/**
 * 没有搜索框的小动作菜单（创建▾、排序、更多…）：打开即聚焦第一项（或当前选中项），
 * ↑/↓ / Home / End 在 menuitem 之间移动焦点（回绕、跳过禁用项），首字母跳转，Esc 关闭，Enter / 空格交给按钮本身。
 * 用法：<div role="menu" {...useMenuKeyboard({ open, onClose })}>
 */
/**
 * 菜单容器的键盘处理（role=menu / listbox 下的 menuitem*、option 按钮，焦点在条目上）。
 * 处理了返回 true（已 preventDefault + stopPropagation）。ResponsivePopover(role=menu) 与 useMenuKeyboard 共用。
 */
export function handleMenuKeyDown(container: HTMLElement, event: React.KeyboardEvent<HTMLElement>, options: { onClose?: () => void; typeahead?: { text: string; at: number } } = {}): boolean {
  if (event.defaultPrevented || isComposingEvent(event) || isEditableElement(event.target)) return false;
  const items = menuItems(container);
  const current = items.indexOf(document.activeElement as HTMLElement);
  const focusAt = (index: number) => {
    items[index]?.focus({ preventScroll: true });
    items[index]?.scrollIntoView?.({ block: 'nearest' });
    event.preventDefault();
    event.stopPropagation();
    return true;
  };
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!items.length) return false;
    return focusAt(moveListboxIndex(current, items.length, event.key === 'ArrowDown' ? 1 : -1, { wrap: true }));
  }
  if (event.key === 'Home' || event.key === 'End') return items.length ? focusAt(event.key === 'Home' ? 0 : items.length - 1) : false;
  if (event.key === 'Escape' && options.onClose) { event.preventDefault(); event.stopPropagation(); options.onClose(); return true; }
  if (options.typeahead && isPrintableKey(event) && event.key !== ' ') {
    const now = Date.now();
    const state = options.typeahead;
    const buffer = now - state.at < 700 ? state.text + event.key.toLowerCase() : event.key.toLowerCase();
    state.text = buffer;
    state.at = now;
    for (let offset = 0; offset < items.length; offset += 1) {
      const index = (Math.max(current, 0) + (buffer.length > 1 ? 0 : 1) + offset) % items.length;
      if ((items[index].textContent || '').trim().toLowerCase().startsWith(buffer)) return focusAt(index);
    }
  }
  return false;
}

/** 把焦点放到菜单里当前选中的条目（没有就第一项）。 */
export function focusInitialMenuItem(container: HTMLElement): boolean {
  const items = menuItems(container);
  const checked = items.find(item => item.getAttribute('aria-checked') === 'true' || item.getAttribute('aria-selected') === 'true');
  const target = checked ?? items[0];
  target?.focus({ preventScroll: true });
  return Boolean(target);
}

/**
 * 没有搜索框的小动作菜单（创建▾、排序、更多…）：打开即聚焦当前选中项或第一项，
 * ↑/↓ / Home / End 在条目之间移动焦点（回绕、跳过禁用项），首字母跳转，Esc 关闭，Enter / 空格交给按钮本身。
 * 用法：<div role="menu" {...useMenuKeyboard({ open, onClose })}>
 */
export function useMenuKeyboard({ open = true, onClose, autoFocus = true }: { open?: boolean; onClose?: () => void; autoFocus?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const typeahead = useRef({ text: '', at: 0 });
  useLayoutEffect(() => {
    if (open && autoFocus && ref.current) focusInitialMenuItem(ref.current);
  }, [open, autoFocus]);
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (ref.current) handleMenuKeyDown(ref.current, event, { onClose, typeahead: typeahead.current });
  };
  return { ref, onKeyDown };
}

/**
 * 卡片网格 + 搜索框（StudioHub 的 Skills / 历史、素材浏览、批量管理、本地文件夹）：
 * 条目本身是可聚焦按钮，所以用「移动焦点」而不是 aria-activedescendant。
 * - 搜索框：Esc 先清空（非空时），↓ 进入第一张卡片；输入法组字期间不处理。
 * - 网格：←/→ 前后一张，↑/↓ 上下一行（按实际列数），第一行再按 ↑ 回到搜索框；Enter / 空格由按钮自己响应。
 * - 焦点在网格内其他非输入元素上时，可打印字符与退格转给搜索框。
 */
export function useSearchGridKeyboard({ query, onQueryChange, itemSelector, autoFocus = false }: {
  query: string;
  onQueryChange: (query: string) => void;
  /** 网格里每张卡片的主按钮选择器，例如 `.studio-hub__media-thumb`。 */
  itemSelector: string;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const paneElement = useRef<HTMLElement | null>(null);
  // 回调 ref：div / section / ul 都能挂。
  const paneRef = useCallback((element: HTMLElement | null) => { paneElement.current = element; }, []);
  useLayoutEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  const items = () => Array.from(paneElement.current?.querySelectorAll<HTMLElement>(itemSelector) || []).filter(item => !item.hasAttribute('disabled'));
  const focusItem = (item: HTMLElement | undefined) => {
    if (!item) return false;
    item.focus({ preventScroll: true });
    item.scrollIntoView?.({ block: 'nearest' });
    return true;
  };
  const columns = (list: HTMLElement[]) => {
    if (list.length < 2) return 1;
    const top = list[0].getBoundingClientRect().top;
    const count = list.findIndex(item => Math.abs(item.getBoundingClientRect().top - top) > 2);
    return count <= 0 ? list.length : count;
  };
  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.defaultPrevented || isComposingEvent(event)) return;
    if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); onQueryChange(''); return; }
    if (event.key === 'ArrowDown' && focusItem(items()[0])) { event.preventDefault(); event.stopPropagation(); }
  };
  const onPaneKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || isComposingEvent(event) || event.target === inputRef.current || isEditableElement(event.target)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const list = items();
    const index = list.indexOf(target);
    const consume = () => { event.preventDefault(); event.stopPropagation(); };
    if (index >= 0 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      const cols = columns(list);
      if (event.key === 'ArrowUp' && index < cols) { inputRef.current?.focus({ preventScroll: true }); consume(); return; }
      const next = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowUp' ? index - cols : event.key === 'ArrowDown' ? index + cols : event.key === 'Home' ? 0 : list.length - 1;
      focusItem(list[Math.max(0, Math.min(list.length - 1, next))]);
      consume();
      return;
    }
    if (!inputRef.current) return;
    if (isPrintableKey(event) && event.key !== ' ') { onQueryChange(`${query}${event.key}`); inputRef.current.focus({ preventScroll: true }); consume(); return; }
    if (event.key === 'Backspace' && query) { onQueryChange(query.slice(0, -1)); inputRef.current.focus({ preventScroll: true }); consume(); }
  };
  return { inputRef, paneRef, onInputKeyDown, onPaneKeyDown };
}
