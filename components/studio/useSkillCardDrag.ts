import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

import { dropIndexAt } from './skillOrder';

/**
 * Hub Skill 卡片拖动（指针事件，不用 HTML5 DnD）。参照 Bleep App 卡片（Inspora · Rolando）：
 * 按住拖动 → 卡片浮起、缩到 ~0.9、阴影加深，原位留空；松手后其余卡片 FLIP 滑到新位置。
 * 拖到 Agent 输入框（.agent-composer）上松手 = 「使用」这个 Skill。减少动效时不做缩放 / 滑动动画。
 */

export interface SkillDragState {
  key: string;
  width: number;
  height: number;
  /** 指针移动后的目标下标；null = 不在网格里（松手回原位）。 */
  targetIndex: number | null;
  fromIndex: number;
  /** 指针在输入框上（且不被 Hub 窗口挡住）。 */
  overComposer: boolean;
  /** 输入框的位置：拖动中画投放高亮用；没有输入框时为 null。 */
  composerRect: { left: number; top: number; width: number; height: number } | null;
}

interface Options {
  keys: readonly string[];
  gridRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
  reduceMotion: boolean;
  /** 能否投放到输入框（Composer 注册了 attachSkill，且该卡可用）。 */
  canDropOnComposer: (key: string) => boolean;
  onReorder: (key: string, toIndex: number) => void;
  onDropOnComposer: (key: string) => void;
}

const DRAG_THRESHOLD = 6;
const FLIP_MS = 340;
const FLIP_EASE = 'cubic-bezier(.2, .9, .25, 1)';
const COMPOSER_SELECTOR = '.agent-composer';

function cardElements(grid: HTMLElement | null): HTMLElement[] {
  return grid ? Array.from(grid.querySelectorAll<HTMLElement>(':scope > [data-key]')) : [];
}

function contains(rect: DOMRect | { left: number; top: number; width: number; height: number }, x: number, y: number) {
  return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height;
}

type Box = { left: number; top: number; width: number; height: number };

/** 输入框没被 Hub 窗口挡住的那一块（投放高亮只画这里）；整块被挡住时返回 null。 */
export function uncoveredPart(target: Box, cover: Box | undefined): Box | null {
  let left = target.left;
  let top = target.top;
  let right = target.left + target.width;
  let bottom = target.top + target.height;
  if (cover) {
    const cRight = cover.left + cover.width;
    const cBottom = cover.top + cover.height;
    const overlaps = left < cRight && right > cover.left && top < cBottom && bottom > cover.top;
    if (overlaps) {
      // 选露出最多的一侧裁掉被挡住的部分。
      const options = [
        { side: 'right', size: right - cRight },
        { side: 'left', size: cover.left - left },
        { side: 'bottom', size: bottom - cBottom },
        { side: 'top', size: cover.top - top },
      ].sort((a, b) => b.size - a.size);
      const best = options[0];
      if (best.size <= 24) return null;
      if (best.side === 'right') left = cRight;
      else if (best.side === 'left') right = cover.left;
      else if (best.side === 'bottom') top = cBottom;
      else bottom = cover.top;
    }
  }
  return { left, top, width: right - left, height: bottom - top };
}

function visibleComposer(): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(COMPOSER_SELECTOR));
  return all.find(element => element.getClientRects().length > 0) ?? null;
}

export function useSkillCardDrag({ keys, gridRef, scrollRef, reduceMotion, canDropOnComposer, onReorder, onDropOnComposer }: Options) {
  const [drag, setDrag] = useState<SkillDragState | null>(null);
  const ghostEl = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  // 浮层第一次挂上时就放到指针下，避免在左上角闪一帧。
  const ghostRef = useCallback((element: HTMLDivElement | null) => {
    ghostEl.current = element;
    const pointer = pointerRef.current;
    if (element && pointer) element.style.transform = `translate3d(${pointer.x - pointer.offsetX}px, ${pointer.y - pointer.offsetY}px, 0)`;
  }, []);
  const dragRef = useRef<SkillDragState | null>(null);
  const flipRef = useRef<Map<string, { rect: DOMRect; scale?: number }> | null>(null); // scale 有值 = 这张是手里的浮层，按宽度比缩放
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const optionsRef = useRef({ canDropOnComposer, onReorder, onDropOnComposer, reduceMotion });
  optionsRef.current = { canDropOnComposer, onReorder, onDropOnComposer, reduceMotion };
  const cleanupRef = useRef<(() => void) | null>(null);

  const update = (next: SkillDragState | null) => { dragRef.current = next; setDrag(next); };

  /** 记录当前每张卡的位置，下一次提交后从这里滑到新位置。 */
  const captureFlip = useCallback((override?: { key: string; rect: DOMRect; scale?: number }) => {
    if (optionsRef.current.reduceMotion) { flipRef.current = null; return; }
    const map = new Map<string, { rect: DOMRect; scale?: number }>();
    for (const element of cardElements(gridRef.current)) map.set(element.dataset.key || '', { rect: element.getBoundingClientRect() });
    if (override) map.set(override.key, { rect: override.rect, scale: override.scale });
    flipRef.current = map;
  }, [gridRef]);

  // 每次提交后检查是否有待播放的 FLIP。
  useLayoutEffect(() => {
    const first = flipRef.current;
    if (!first) return;
    flipRef.current = null;
    for (const element of cardElements(gridRef.current)) {
      const key = element.dataset.key || '';
      const from = first.get(key);
      if (!from) continue;
      const last = element.getBoundingClientRect();
      if (!last.width || !last.height) continue;
      // 从「上一帧的视觉位置」（拖动中的卡是缩小后的浮层）滑到新格子：以中心对齐，宽度比就是缩放。
      const scale = from.scale !== undefined ? from.rect.width / last.width : 1;
      const dx = from.rect.left + from.rect.width / 2 - (last.left + last.width / 2);
      const dy = from.rect.top + from.rect.height / 2 - (last.top + last.height / 2);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(scale - 1) < 0.01) continue;
      element.style.transition = 'none';
      element.style.transformOrigin = 'center';
      element.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      if (from.scale !== undefined) element.style.zIndex = '3';
      void element.offsetWidth;
      element.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE}`;
      element.style.transform = '';
      const done = () => { element.style.transition = ''; element.style.zIndex = ''; element.style.transformOrigin = ''; element.removeEventListener('transitionend', done); };
      element.addEventListener('transitionend', done);
      window.setTimeout(done, FLIP_MS + 80);
    }
  });

  useEffect(() => () => cleanupRef.current?.(), []);

  const placeGhost = (x: number, y: number, offsetX: number, offsetY: number) => {
    pointerRef.current = { x, y, offsetX, offsetY };
    const ghost = ghostEl.current;
    if (ghost) ghost.style.transform = `translate3d(${x - offsetX}px, ${y - offsetY}px, 0)`;
  };

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, key: string) => {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    const target = event.target as Element;
    if (target.closest('[data-no-drag], input, textarea, [role="menu"]')) return;
    const card = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    let offsetX = 0;
    let offsetY = 0;
    let started = false;

    const move = (moveEvent: PointerEvent) => {
      const { clientX: x, clientY: y } = moveEvent;
      if (!started) {
        if (Math.hypot(x - startX, y - startY) < DRAG_THRESHOLD) return;
        started = true;
        const rect = card.getBoundingClientRect();
        offsetX = startX - rect.left;
        offsetY = startY - rect.top;
        const fromIndex = keysRef.current.indexOf(key);
        const composer = optionsRef.current.canDropOnComposer(key) ? visibleComposer() : null;
        const hubBox = (card.closest('.studio-hub') as HTMLElement | null)?.getBoundingClientRect();
        const composerRect = composer ? uncoveredPart(composer.getBoundingClientRect(), hubBox) : null;
        update({ key, width: rect.width, height: rect.height, targetIndex: fromIndex, fromIndex, overComposer: false, composerRect });
        document.documentElement.classList.add('is-skill-dragging');
      }
      moveEvent.preventDefault();
      placeGhost(x, y, offsetX, offsetY);
      const current = dragRef.current;
      if (!current) return;
      // 输入框：指针在它上面，且这里没被 Hub 窗口挡住（窗口外的部分才看得见）。
      const composer = current.composerRect ? visibleComposer() : null;
      const overComposer = Boolean(composer && current.composerRect && contains(current.composerRect, x, y));
      composer?.classList.toggle('is-skill-drop-target', overComposer);
      let targetIndex: number | null = null;
      const scroller = scrollRef.current;
      const scrollRect = scroller?.getBoundingClientRect();
      if (!overComposer && scrollRect && contains(scrollRect, x, y)) {
        const slots = cardElements(gridRef.current).map(element => element.getBoundingClientRect());
        targetIndex = dropIndexAt(slots, { x, y });
        // 靠近上下边缘时自动滚动。
        if (y < scrollRect.top + 36) scroller!.scrollTop -= 10;
        else if (y > scrollRect.bottom - 36) scroller!.scrollTop += 10;
      }
      if (targetIndex !== current.targetIndex || overComposer !== current.overComposer) update({ ...current, targetIndex, overComposer });
    };

    const finish = (commit: boolean) => {
      cleanupRef.current?.();
      if (!started) return;
      const current = dragRef.current;
      document.documentElement.classList.remove('is-skill-dragging');
      visibleComposer()?.classList.remove('is-skill-drop-target');
      // 拖过之后紧跟的 click 不算「打开详情」。
      const swallow = (clickEvent: MouseEvent) => { clickEvent.stopPropagation(); clickEvent.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (!current) { update(null); return; }
      const ghost = ghostEl.current;
      pointerRef.current = null;
      const ghostRect = ghost?.firstElementChild?.getBoundingClientRect();
      if (commit && current.overComposer) {
        const composerRect = visibleComposer()?.getBoundingClientRect();
        if (ghost && composerRect && !optionsRef.current.reduceMotion) {
          ghost.style.transition = `transform 220ms ${FLIP_EASE}, opacity 220ms ease`;
          ghost.style.transform = `translate3d(${composerRect.left + composerRect.width / 2 - current.width / 2}px, ${composerRect.top + composerRect.height / 2 - current.height / 2}px, 0) scale(.35)`;
          ghost.style.opacity = '0';
          window.setTimeout(() => update(null), 220);
        } else {
          update(null);
        }
        optionsRef.current.onDropOnComposer(current.key);
        return;
      }
      if (commit && current.targetIndex !== null && current.targetIndex !== current.fromIndex && current.targetIndex >= 0) {
        captureFlip(ghostRect ? { key: current.key, rect: ghostRect, scale: 1 } : undefined);
        update(null);
        optionsRef.current.onReorder(current.key, current.targetIndex);
        return;
      }
      // 没换位置：从手里滑回原位。
      captureFlip(ghostRect ? { key: current.key, rect: ghostRect, scale: 1 } : undefined);
      update(null);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key_ = (keyEvent: KeyboardEvent) => { if (keyEvent.key === 'Escape' && started) { keyEvent.preventDefault(); keyEvent.stopPropagation(); finish(false); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key_, { capture: true });
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key_, { capture: true });
      cleanupRef.current = null;
    };
  }, [captureFlip, gridRef, scrollRef]);

  return { drag, ghostRef, onPointerDown, captureFlip };
}
