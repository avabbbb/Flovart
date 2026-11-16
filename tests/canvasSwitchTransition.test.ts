import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CANVAS_SWITCH_RING_ATTR,
  cancelCanvasSwitch,
  canvasSwitchOriginFromEvent,
  isCanvasSwitchRunning,
  revealRadius,
  runCanvasSwitch,
} from '../components/studio/canvasSwitchTransition';

interface FakeAnimation {
  keyframes: unknown;
  options: KeyframeAnimationOptions & { pseudoElement?: string };
  finished: Promise<void>;
  resolve: () => void;
  cancel: ReturnType<typeof vi.fn>;
  finish: ReturnType<typeof vi.fn>;
}

let animations: FakeAnimation[] = [];
const originalAnimate = (Element.prototype as { animate?: unknown }).animate;

function installAnimate() {
  (Element.prototype as unknown as { animate: unknown }).animate = function animate(keyframes: unknown, options: KeyframeAnimationOptions) {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const finished = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    const animation: FakeAnimation = {
      keyframes,
      options,
      finished,
      resolve,
      cancel: vi.fn(() => reject(new DOMException('cancelled', 'AbortError'))),
      finish: vi.fn(() => resolve()),
    };
    animations.push(animation);
    return animation;
  };
}

const rings = () => document.querySelectorAll(`[${CANVAS_SWITCH_RING_ATTR}]`).length;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const finishAll = async () => { animations.forEach(animation => animation.resolve()); await flush(); await flush(); };

describe('canvas switch transition', () => {
  let stage: HTMLElement;

  beforeEach(() => {
    animations = [];
    installAnimate();
    stage = document.createElement('section');
    stage.className = 'studio-navigation-frame__stage';
    document.body.appendChild(stage);
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });

  afterEach(() => {
    cancelCanvasSwitch();
    stage.remove();
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    (Element.prototype as unknown as { animate: unknown }).animate = originalAnimate;
  });

  it('fallback: commits once, shows one ring + circular reveal on the stage, and leaves nothing behind', async () => {
    const commit = vi.fn();
    const done = runCanvasSwitch(commit, { origin: { x: 100, y: 120 }, reducedMotion: false });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rings()).toBe(1);
    expect(isCanvasSwitchRunning()).toBe(true);
    const reveal = animations.find(animation => JSON.stringify(animation.keyframes).includes('clipPath'));
    expect(JSON.stringify(reveal?.keyframes)).toContain('circle(0px at 100px 120px)');
    expect(reveal?.options.duration).toBeGreaterThanOrEqual(450);
    expect(reveal?.options.duration).toBeLessThanOrEqual(700);
    await finishAll();
    await done;
    expect(rings()).toBe(0);
    expect(isCanvasSwitchRunning()).toBe(false);
    expect(document.documentElement.classList.contains('canvas-switching')).toBe(false);
  });

  it('reduced motion: quick cross-fade only, no ring', async () => {
    const commit = vi.fn();
    const done = runCanvasSwitch(commit, { reducedMotion: true });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rings()).toBe(0);
    expect(animations).toHaveLength(1);
    expect(animations[0].options.duration).toBeLessThanOrEqual(200);
    expect(JSON.stringify(animations[0].keyframes)).not.toContain('clipPath');
    await finishAll();
    await done;
    expect(isCanvasSwitchRunning()).toBe(false);
  });

  it('reads prefers-reduced-motion when not told explicitly', () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal('matchMedia', matchMedia);
    window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
    runCanvasSwitch(vi.fn());
    expect(rings()).toBe(0);
    vi.unstubAllGlobals();
  });

  it('rapid switching interrupts the previous run: commits stay in order, never more than one ring, no artifacts', async () => {
    const order: string[] = [];
    const first = runCanvasSwitch(() => order.push('a'), { origin: { x: 10, y: 10 }, reducedMotion: false });
    const firstAnimations = [...animations];
    const second = runCanvasSwitch(() => order.push('b'), { origin: { x: 20, y: 20 }, reducedMotion: false });
    expect(rings()).toBe(1);
    firstAnimations.forEach(animation => expect(animation.cancel).toHaveBeenCalled());
    const third = runCanvasSwitch(() => order.push('c'), { origin: { x: 30, y: 30 }, reducedMotion: false });
    expect(rings()).toBe(1);
    expect(order).toEqual(['a', 'b', 'c']);
    await finishAll();
    await Promise.all([first, second, third]);
    expect(rings()).toBe(0);
    expect(isCanvasSwitchRunning()).toBe(false);
  });

  it('View Transitions path: reveals ::view-transition-new(root) through a circle, ring sits on its own layer, cleans up', async () => {
    let finishTransition!: () => void;
    const skip = vi.fn();
    const startViewTransition = vi.fn((callback: () => void) => {
      callback();
      const finished = new Promise<void>(resolve => { finishTransition = resolve; });
      return { ready: Promise.resolve(), finished, updateCallbackDone: Promise.resolve(), skipTransition: skip };
    });
    (document as unknown as { startViewTransition: unknown }).startViewTransition = startViewTransition;
    const commit = vi.fn();
    const done = runCanvasSwitch(commit, { origin: { x: 600, y: 400 }, reducedMotion: false });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains('canvas-switching')).toBe(true);
    await flush();
    const reveal = animations.find(animation => animation.options.pseudoElement === '::view-transition-new(root)');
    expect(reveal).toBeTruthy();
    expect(JSON.stringify(reveal!.keyframes)).toContain(`circle(${revealRadius({ x: 600, y: 400 }, { width: 1200, height: 800 })}px at 600px 400px)`);
    const ring = document.querySelector<HTMLElement>(`[${CANVAS_SWITCH_RING_ATTR}]`);
    expect(ring?.style.getPropertyValue('view-transition-name')).toBe('canvas-switch-ring');
    finishTransition();
    await finishAll();
    await done;
    expect(rings()).toBe(0);
    expect(document.documentElement.classList.contains('canvas-switching')).toBe(false);
  });

  it('View Transitions path: a second switch skips the running transition', async () => {
    const skips: Array<ReturnType<typeof vi.fn>> = [];
    (document as unknown as { startViewTransition: unknown }).startViewTransition = vi.fn((callback: () => void) => {
      callback();
      const skip = vi.fn();
      skips.push(skip);
      return { ready: Promise.resolve(), finished: Promise.resolve(), skipTransition: skip };
    });
    runCanvasSwitch(vi.fn(), { reducedMotion: false });
    runCanvasSwitch(vi.fn(), { reducedMotion: false });
    expect(skips[0]).toHaveBeenCalledTimes(1);
    expect(rings()).toBe(1);
  });

  it('origin: pointer clicks use the pointer, keyboard clicks use the trigger centre', () => {
    expect(canvasSwitchOriginFromEvent({ clientX: 40, clientY: 50, detail: 1 })).toEqual({ x: 40, y: 50 });
    const button = document.createElement('button');
    button.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 30, right: 110, bottom: 50, x: 10, y: 20, toJSON: () => ({}) });
    expect(canvasSwitchOriginFromEvent({ clientX: 0, clientY: 0, detail: 0, currentTarget: button })).toEqual({ x: 60, y: 35 });
    expect(canvasSwitchOriginFromEvent(null)).toBeNull();
  });

  it('defaults to the viewport centre without a pointer or anchor', async () => {
    runCanvasSwitch(vi.fn(), { reducedMotion: false });
    const reveal = animations.find(animation => JSON.stringify(animation.keyframes).includes('clipPath'));
    expect(JSON.stringify(reveal?.keyframes)).toContain('at 600px 400px');
  });
});
