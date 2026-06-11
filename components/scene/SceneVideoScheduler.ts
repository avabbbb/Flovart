export type SceneVideoFrameStrategy = 'video-frame' | 'raf';

export interface SceneVideoLayer {
  batchDraw: () => void;
}

export interface SceneVideoSource {
  id: string;
  visible: boolean;
  playing: boolean;
  inViewport: boolean;
  layer: SceneVideoLayer;
}

export interface SceneVideoSchedulerClock {
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
}

export interface SceneVideoScheduler {
  register: (source: SceneVideoSource) => void;
  unregister: (id: string) => void;
  update: (id: string, patch: Partial<Omit<SceneVideoSource, 'id'>>) => void;
  tick: () => void;
  start: () => void;
  stop: () => void;
  size: () => number;
}

type VideoFrameCapable = {
  requestVideoFrameCallback?: unknown;
};

export function resolveVideoFrameStrategy(video: VideoFrameCapable | null | undefined): SceneVideoFrameStrategy {
  return typeof video?.requestVideoFrameCallback === 'function' ? 'video-frame' : 'raf';
}

const defaultClock = (): SceneVideoSchedulerClock => ({
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
});

export function createSceneVideoScheduler(clock: SceneVideoSchedulerClock = defaultClock()): SceneVideoScheduler {
  const sources = new Map<string, SceneVideoSource>();
  let rafHandle: number | null = null;
  let running = false;

  const drawActiveLayers = () => {
    const layers = new Set<SceneVideoLayer>();

    for (const source of sources.values()) {
      if (source.visible && source.playing && source.inViewport) {
        layers.add(source.layer);
      }
    }

    for (const layer of layers) {
      layer.batchDraw();
    }
  };

  const schedule = () => {
    if (!running || rafHandle !== null) return;
    rafHandle = clock.requestAnimationFrame(() => {
      rafHandle = null;
      drawActiveLayers();
      schedule();
    });
  };

  return {
    register(source) {
      sources.set(source.id, { ...source });
    },
    unregister(id) {
      sources.delete(id);
    },
    update(id, patch) {
      const current = sources.get(id);
      if (!current) return;
      sources.set(id, { ...current, ...patch });
    },
    tick() {
      drawActiveLayers();
    },
    start() {
      running = true;
      schedule();
    },
    stop() {
      running = false;
      if (rafHandle !== null) {
        clock.cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
    },
    size() {
      return sources.size;
    },
  };
}
