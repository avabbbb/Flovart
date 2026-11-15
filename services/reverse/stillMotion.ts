// 静止画运镜：把一张静态图在镜头时长内推、拉、摇、移、震，画面边缘永不露底。
// 纯函数，Remotion 合成与测试共用；静止系 MAD Skill 用它把卡点镜头动起来。

export const STILL_MOTION_TYPES = ['none', 'push', 'pull', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'shake', 'impact'] as const;
export type StillMotionType = typeof STILL_MOTION_TYPES[number];
export type StillMotionEase = 'linear' | 'out' | 'in-out';

export interface StillMotion {
  type: StillMotionType;
  /** 运动幅度，按画幅比例：0.12 = 放大 12% 或移动 12% 余量。默认随类型而定，限 0–0.5。 */
  amount?: number;
  ease?: StillMotionEase;
  /** 镜头开头闪白（卡点重拍）。impact 自带。 */
  flash?: boolean;
}

export interface StillMotionFrame {
  scale: number;
  /** 平移，按画面宽 / 高的百分比。 */
  x: number;
  y: number;
  rotate: number;
  /** 白色闪光层不透明度 0–1。 */
  flash: number;
}

const DEFAULT_AMOUNT: Record<StillMotionType, number> = {
  none: 0, push: 0.12, pull: 0.12, 'pan-left': 0.16, 'pan-right': 0.16, 'tilt-up': 0.16, 'tilt-down': 0.16, shake: 0.06, impact: 0.12,
};
const FLASH_FRAMES = 4;

export function isStillMotionType(value: unknown): value is StillMotionType {
  return typeof value === 'string' && (STILL_MOTION_TYPES as readonly string[]).includes(value);
}

function eased(progress: number, ease: StillMotionEase = 'linear') {
  const p = Math.min(1, Math.max(0, progress));
  if (ease === 'out') return 1 - (1 - p) ** 3;
  if (ease === 'in-out') return p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
  return p;
}

/** 确定性抖动：同一帧永远同一偏移，渲染可复现。 */
function jitter(frame: number, seed: number) {
  return Math.sin(frame * 12.9898 + seed * 78.233) * 0.5 + Math.sin(frame * 4.1 + seed) * 0.5;
}

/** 平移余量受放大量约束：放大 s 时单侧最多移动 (s-1)/2，保证不露边。 */
function maxShift(scale: number) {
  return ((scale - 1) / 2) * 100;
}

export function stillMotionFrame(motion: StillMotion | undefined, frame: number, durationFrames: number): StillMotionFrame {
  const rest: StillMotionFrame = { scale: 1, x: 0, y: 0, rotate: 0, flash: 0 };
  if (!motion || !isStillMotionType(motion.type) || motion.type === 'none') {
    return motion?.flash ? { ...rest, flash: flashAt(frame) } : rest;
  }
  const amount = Math.min(0.5, Math.max(0, Number.isFinite(motion.amount) ? Number(motion.amount) : DEFAULT_AMOUNT[motion.type]));
  const total = Math.max(1, durationFrames - 1);
  const p = eased(frame / total, motion.ease);
  const flash = motion.flash || motion.type === 'impact' ? flashAt(frame) : 0;
  switch (motion.type) {
    case 'push':
      return { ...rest, scale: 1 + amount * p, flash };
    case 'pull':
      return { ...rest, scale: 1 + amount * (1 - p), flash };
    case 'pan-left':
    case 'pan-right': {
      const scale = 1 + amount;
      const span = maxShift(scale);
      const x = motion.type === 'pan-left' ? span - 2 * span * p : -span + 2 * span * p;
      return { ...rest, scale, x, flash };
    }
    case 'tilt-up':
    case 'tilt-down': {
      const scale = 1 + amount;
      const span = maxShift(scale);
      const y = motion.type === 'tilt-up' ? span - 2 * span * p : -span + 2 * span * p;
      return { ...rest, scale, y, flash };
    }
    case 'shake': {
      const scale = 1 + amount;
      const decay = (1 - frame / total) ** 2;
      const span = maxShift(scale) * decay;
      return { ...rest, scale, x: span * jitter(frame, 1), y: span * jitter(frame, 2), rotate: amount * 10 * decay * jitter(frame, 3), flash };
    }
    case 'impact': {
      // 重拍：开头猛地放大再回弹，随后缓推；前几帧伴随衰减抖动。
      const hit = Math.min(1, frame / Math.max(1, Math.round(total * 0.18)));
      const settle = 1 + amount * 1.6 - amount * 1.2 * eased(hit, 'out');
      const scale = settle + amount * 0.25 * eased(frame / total);
      const decay = Math.max(0, 1 - frame / Math.max(1, total * 0.3));
      const span = maxShift(scale) * 0.5 * decay;
      return { ...rest, scale, x: span * jitter(frame, 4), y: span * jitter(frame, 5), flash };
    }
    default:
      return rest;
  }
}

function flashAt(frame: number) {
  return frame >= FLASH_FRAMES ? 0 : 1 - frame / FLASH_FRAMES;
}

/** 卡点切点：按 BPM、首拍偏移和每镜拍数排出镜头起止（毫秒），最后一镜收在总时长。 */
export function beatGridCuts({ bpm, offsetMs = 0, durationMs, beatsPerShot }: {
  bpm: number;
  offsetMs?: number;
  durationMs: number;
  beatsPerShot: number | readonly number[];
}): Array<{ startMs: number; durationMs: number }> {
  if (!(bpm > 0) || !(durationMs > 0)) throw new Error('beatGridCuts 需要正的 bpm 与 durationMs');
  const beatMs = 60000 / bpm;
  const pattern = Array.isArray(beatsPerShot) ? beatsPerShot : [beatsPerShot as number];
  if (!pattern.length || pattern.some(beats => !(beats > 0))) throw new Error('beatsPerShot 必须为正');
  const cuts: Array<{ startMs: number; durationMs: number }> = [];
  let start = Math.max(0, offsetMs);
  if (start > 0) cuts.push({ startMs: 0, durationMs: Math.round(start) });
  for (let index = 0; start < durationMs - 1; index += 1) {
    const length = pattern[index % pattern.length] * beatMs;
    const end = Math.min(durationMs, start + length);
    cuts.push({ startMs: Math.round(start), durationMs: Math.round(end) - Math.round(start) });
    start = end;
  }
  return cuts.filter(cut => cut.durationMs > 0);
}
