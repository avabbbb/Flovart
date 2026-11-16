import { flushSync } from 'react-dom';

import { SPRING, springEasing } from './motionTokens';
import '../../styles/canvasSwitch.css';

// 切换画布的冲击波揭示：从点击点（或切换器 / 屏幕中心）先闪一下，一圈薄荷色冲击环向外扩散，
// 新画布从同一个圆里整面揭开，然后落定。参照 Inspora「theme for Claude Code」的整面换肤与强调色描边：
// https://www.inspora.design/posts/theme-for-claude-code
//
// - 有 View Transitions：旧画面是快照，新画面（活的）用 clip-path circle 从原点展开；冲击环带独立
//   view-transition-name 叠在最上层，不被圆裁掉；::view-transition 不接指针，动画中仍可操作。
// - 没有 View Transitions：先提交，再对舞台做同样的圆形揭示（落在 app 底色上）。
// - 减弱动效：160ms 交叉淡化，无环无位移。
// - 可打断：新的切换先 skip 上一段过渡、取消动画、移除冲击环；DOM 里永远最多一个环。
// 提交只是调用方传入的 commit（setActiveProject），画布状态 / 视角 / 选区 / 撤销栈都不经过这里。

export interface CanvasSwitchOrigin {
  x: number;
  y: number;
}

export interface CanvasSwitchOptions {
  /** 指针位置；没有时用 anchor 中心，再没有用视口中心。 */
  origin?: CanvasSwitchOrigin | null;
  anchor?: Element | null;
  /** 不传时读 prefers-reduced-motion。 */
  reducedMotion?: boolean;
  /** 无 View Transitions 时做圆形揭示的元素，默认画布舞台。 */
  surface?: HTMLElement | null;
}

export const CANVAS_SWITCH_RING_ATTR = 'data-canvas-switch-ring';
export const CANVAS_SWITCH_REVEAL_MS = 600;
export const CANVAS_SWITCH_RING_MS = 680;
export const CANVAS_SWITCH_FLASH_MS = 280;
export const CANVAS_SWITCH_FADE_MS = 160;
const SWITCHING_CLASS = 'canvas-switching';
const FADING_CLASS = 'canvas-switch-fade';
const DEFAULT_SURFACE_SELECTOR = '.studio-navigation-frame__stage';

interface ViewTransitionLike {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone?: Promise<void>;
  skipTransition: () => void;
}

type StartViewTransition = (callback: () => void) => ViewTransitionLike;

interface ActiveSwitch {
  cancel: () => void;
}

let active: ActiveSwitch | null = null;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 从点击事件取原点：键盘触发的 click 没有坐标（detail === 0），改用触发元素中心。 */
export function canvasSwitchOriginFromEvent(event?: { clientX?: number; clientY?: number; detail?: number; currentTarget?: EventTarget | null } | null): CanvasSwitchOrigin | null {
  if (!event) return null;
  const pointer = typeof event.clientX === 'number' && typeof event.clientY === 'number' && (event.detail ?? 1) > 0
    && !(event.clientX === 0 && event.clientY === 0);
  if (pointer) return { x: event.clientX!, y: event.clientY! };
  const target = event.currentTarget;
  return target instanceof Element ? centerOf(target) : null;
}

function centerOf(element: Element): CanvasSwitchOrigin | null {
  const rect = element.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function viewport() {
  return {
    width: window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.innerHeight || document.documentElement.clientHeight || 0,
  };
}

function resolveOrigin(options: CanvasSwitchOptions): CanvasSwitchOrigin {
  if (options.origin) return options.origin;
  const anchored = options.anchor ? centerOf(options.anchor) : null;
  if (anchored) return anchored;
  const { width, height } = viewport();
  return { x: width / 2, y: height / 2 };
}

/** 能盖住整个视口的半径：原点到最远角的距离。 */
export function revealRadius(origin: CanvasSwitchOrigin, size = viewport()): number {
  const dx = Math.max(origin.x, size.width - origin.x);
  const dy = Math.max(origin.y, size.height - origin.y);
  return Math.ceil(Math.hypot(dx, dy)) + 2;
}

function startViewTransitionOf(): StartViewTransition | null {
  const doc = document as Document & { startViewTransition?: StartViewTransition };
  return typeof doc.startViewTransition === 'function' ? doc.startViewTransition.bind(doc) : null;
}

function canAnimate(element: Element): boolean {
  return typeof (element as HTMLElement).animate === 'function';
}

function removeRings() {
  document.querySelectorAll(`[${CANVAS_SWITCH_RING_ATTR}]`).forEach(node => node.remove());
}

function createRing(origin: CanvasSwitchOrigin, radius: number, named: boolean) {
  const layer = document.createElement('div');
  layer.className = 'canvas-switch-ring';
  layer.setAttribute(CANVAS_SWITCH_RING_ATTR, '');
  layer.setAttribute('aria-hidden', 'true');
  if (named) layer.style.setProperty('view-transition-name', 'canvas-switch-ring');
  const wave = document.createElement('div');
  wave.className = 'canvas-switch-ring__wave';
  wave.style.left = `${origin.x}px`;
  wave.style.top = `${origin.y}px`;
  const flash = document.createElement('div');
  flash.className = 'canvas-switch-ring__flash';
  flash.style.left = `${origin.x}px`;
  flash.style.top = `${origin.y}px`;
  layer.append(wave, flash);
  const diameter = radius * 2;
  return {
    layer,
    play(): Animation[] {
      if (!canAnimate(wave)) return [];
      const expressive = springEasing('expressive');
      return [
        wave.animate([
          { width: '0px', height: '0px', opacity: 1 },
          { opacity: 1, offset: 0.55 },
          { width: `${diameter}px`, height: `${diameter}px`, opacity: 0 },
        ], { duration: CANVAS_SWITCH_RING_MS, easing: expressive, fill: 'forwards' }),
        flash.animate([
          { transform: 'translate(-50%, -50%) scale(0.35)', opacity: 0.95 },
          { transform: 'translate(-50%, -50%) scale(1.6)', opacity: 0 },
        ], { duration: CANVAS_SWITCH_FLASH_MS, easing: springEasing('smooth'), fill: 'forwards' }),
      ];
    },
  };
}

function settle(animations: Animation[], fallbackMs: number): Promise<void> {
  if (!animations.length) return new Promise(resolve => window.setTimeout(resolve, fallbackMs));
  return Promise.all(animations.map(animation => animation.finished.catch(() => undefined))).then(() => undefined);
}

/** 当前是否有切换动画在跑（测试与调试用）。 */
export function isCanvasSwitchRunning(): boolean {
  return active !== null;
}

/** 立即结束正在跑的切换（落到最终状态并清理）。 */
export function cancelCanvasSwitch(): void {
  active?.cancel();
  active = null;
  removeRings();
  document.documentElement.classList.remove(SWITCHING_CLASS, FADING_CLASS);
}

/**
 * 带冲击波揭示地切换画布。commit 一定会被同步或在过渡回调里调用恰好一次；
 * 返回的 Promise 在动画落定（或被下一次切换打断）后 resolve。
 */
export function runCanvasSwitch(commit: () => void, options: CanvasSwitchOptions = {}): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') { commit(); return Promise.resolve(); }
  cancelCanvasSwitch();
  if (document.visibilityState === 'hidden') { commit(); return Promise.resolve(); }

  const root = document.documentElement;
  const reduced = options.reducedMotion ?? prefersReducedMotion();
  const startViewTransition = startViewTransitionOf();
  const token: ActiveSwitch = { cancel: () => undefined };
  active = token;
  const finish = () => {
    if (active === token) {
      active = null;
      root.classList.remove(SWITCHING_CLASS, FADING_CLASS);
    }
  };

  if (reduced) {
    if (startViewTransition) {
      root.classList.add(FADING_CLASS);
      const transition = startViewTransition(() => { flushSync(commit); });
      token.cancel = () => transition.skipTransition();
      return transition.finished.catch(() => undefined).finally(finish);
    }
    commit();
    const surface = options.surface ?? document.querySelector<HTMLElement>(DEFAULT_SURFACE_SELECTOR);
    const fade = surface && canAnimate(surface)
      ? surface.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: CANVAS_SWITCH_FADE_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' })
      : null;
    token.cancel = () => fade?.finish();
    return settle(fade ? [fade] : [], 0).finally(finish);
  }

  const origin = resolveOrigin(options);
  const radius = revealRadius(origin);
  const clipFrom = `circle(0px at ${origin.x}px ${origin.y}px)`;
  const clipTo = `circle(${radius}px at ${origin.x}px ${origin.y}px)`;
  const ring = createRing(origin, radius, Boolean(startViewTransition));
  const running: Animation[] = [];
  const dropRing = () => { ring.layer.remove(); };

  if (startViewTransition) {
    root.classList.add(SWITCHING_CLASS);
    const transition = startViewTransition(() => {
      flushSync(commit);
      document.body.appendChild(ring.layer);
    });
    token.cancel = () => {
      transition.skipTransition();
      running.forEach(animation => animation.cancel());
      dropRing();
    };
    const revealed = transition.ready.then(() => {
      if (active !== token) return;
      running.push(root.animate(
        { clipPath: [clipFrom, clipTo] },
        { duration: CANVAS_SWITCH_REVEAL_MS, easing: springEasing('expressive'), pseudoElement: '::view-transition-new(root)' } as KeyframeAnimationOptions,
      ));
      running.push(...ring.play());
      return settle(running, CANVAS_SWITCH_RING_MS);
    }).catch(() => undefined);
    return Promise.all([revealed, transition.finished.catch(() => undefined)])
      .then(() => undefined)
      .finally(() => {
        if (active === token) dropRing();
        finish();
      });
  }

  commit();
  const surface = options.surface ?? document.querySelector<HTMLElement>(DEFAULT_SURFACE_SELECTOR);
  document.body.appendChild(ring.layer);
  if (surface && canAnimate(surface)) {
    running.push(surface.animate(
      { clipPath: [clipFrom, clipTo] },
      { duration: CANVAS_SWITCH_REVEAL_MS, easing: springEasing('expressive') },
    ));
  }
  running.push(...ring.play());
  token.cancel = () => {
    running.forEach(animation => animation.cancel());
    dropRing();
  };
  return settle(running, CANVAS_SWITCH_RING_MS).finally(() => {
    if (active === token) dropRing();
    finish();
  });
}
