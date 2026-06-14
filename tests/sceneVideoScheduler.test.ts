import { describe, expect, it, vi } from 'vitest';
import {
  createSceneVideoScheduler,
  resolveVideoFrameStrategy,
  type SceneVideoLayer,
  type SceneVideoSource,
} from '../components/scene/SceneVideoScheduler';

const layer = (): SceneVideoLayer => ({
  batchDraw: vi.fn(),
});

const source = (overrides: Partial<SceneVideoSource> = {}): SceneVideoSource => ({
  id: 'video-1',
  visible: true,
  playing: true,
  inViewport: true,
  layer: layer(),
  ...overrides,
});

describe('SceneVideoScheduler', () => {
  it('uses requestVideoFrameCallback when the browser exposes it', () => {
    expect(resolveVideoFrameStrategy({ requestVideoFrameCallback: vi.fn() })).toBe('video-frame');
  });

  it('falls back to raf when requestVideoFrameCallback is unavailable', () => {
    expect(resolveVideoFrameStrategy({})).toBe('raf');
  });

  it('draws only visible, playing videos inside the viewport', () => {
    const activeLayer = layer();
    const hiddenLayer = layer();
    const scheduler = createSceneVideoScheduler({
      requestAnimationFrame: (callback) => {
        callback(16);
        return 1;
      },
      cancelAnimationFrame: vi.fn(),
    });

    scheduler.register(source({ id: 'active', layer: activeLayer }));
    scheduler.register(source({ id: 'hidden', visible: false, layer: hiddenLayer }));
    scheduler.tick();

    expect(activeLayer.batchDraw).toHaveBeenCalledTimes(1);
    expect(hiddenLayer.batchDraw).not.toHaveBeenCalled();
  });

  it('coalesces duplicate layer draws into a single batchDraw per frame', () => {
    const sharedLayer = layer();
    const scheduler = createSceneVideoScheduler({
      requestAnimationFrame: (callback) => {
        callback(16);
        return 1;
      },
      cancelAnimationFrame: vi.fn(),
    });

    scheduler.register(source({ id: 'a', layer: sharedLayer }));
    scheduler.register(source({ id: 'b', layer: sharedLayer }));
    scheduler.tick();

    expect(sharedLayer.batchDraw).toHaveBeenCalledTimes(1);
  });

  it('updates registered video state without recreating the scheduler', () => {
    const videoLayer = layer();
    const scheduler = createSceneVideoScheduler({
      requestAnimationFrame: (callback) => {
        callback(16);
        return 1;
      },
      cancelAnimationFrame: vi.fn(),
    });

    scheduler.register(source({ layer: videoLayer, playing: false }));
    scheduler.tick();
    scheduler.update('video-1', { playing: true });
    scheduler.tick();

    expect(videoLayer.batchDraw).toHaveBeenCalledTimes(1);
  });
});
