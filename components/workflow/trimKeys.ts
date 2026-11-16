// 节点内剪辑（P1-5）的键盘逻辑：纯函数，UI 只负责把按键喂进来、把 seek/播放效果落到 <video>。
// 快捷键：I / O 把入点 / 出点设到播放头；← / → 整体平移选区；↑ / ↓ 播放头前进 / 后退；
// 步长 0.1s，按住 Shift 时 0.01s；空格播放 / 暂停；Enter 确认；Esc 取消。

export interface TrimState {
  durationSec: number;
  inSec: number;
  outSec: number;
  playheadSec: number;
  playing: boolean;
}

export interface TrimKeyInput { key: string; shiftKey?: boolean }

export type TrimEffect = 'seek' | 'toggle-play' | 'confirm' | 'cancel';
export interface TrimKeyResult { state: TrimState; handled: boolean; effect?: TrimEffect }

/** 最短选区（秒）：避免入出点重合导致 video.trim@1 产出空片段。 */
export const MIN_TRIM_SEC = 0.1;
const round = (value: number) => Math.round(value * 1000) / 1000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function createTrimState(durationSec: number, playheadSec = 0): TrimState {
  const duration = Math.max(0, Number(durationSec) || 0);
  return { durationSec: duration, inSec: 0, outSec: round(duration), playheadSec: round(clamp(playheadSec, 0, duration)), playing: false };
}

/** 外部（拖动滑块）改入出点时的统一校正：保持 0 ≤ in < out ≤ duration 且间隔 ≥ MIN_TRIM_SEC。 */
export function setTrimRange(state: TrimState, inSec: number, outSec: number): TrimState {
  const duration = state.durationSec;
  const min = Math.min(MIN_TRIM_SEC, duration);
  const nextIn = clamp(inSec, 0, Math.max(0, duration - min));
  const nextOut = clamp(outSec, nextIn + min, duration);
  return { ...state, inSec: round(nextIn), outSec: round(nextOut) };
}

export function trimKeyReducer(state: TrimState, input: TrimKeyInput): TrimKeyResult {
  const step = input.shiftKey ? 0.01 : 0.1;
  const duration = state.durationSec;
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
  switch (key) {
    case 'i': {
      const inSec = Math.min(state.playheadSec, state.outSec - Math.min(MIN_TRIM_SEC, duration));
      return { state: { ...state, inSec: round(Math.max(0, inSec)) }, handled: true };
    }
    case 'o': {
      const outSec = Math.max(state.playheadSec, state.inSec + Math.min(MIN_TRIM_SEC, duration));
      return { state: { ...state, outSec: round(Math.min(duration, outSec)) }, handled: true };
    }
    case 'ArrowLeft':
    case 'ArrowRight': {
      const length = state.outSec - state.inSec;
      const delta = key === 'ArrowLeft' ? -step : step;
      const inSec = clamp(state.inSec + delta, 0, Math.max(0, duration - length));
      return { state: { ...state, inSec: round(inSec), outSec: round(inSec + length) }, handled: true };
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      const playheadSec = clamp(state.playheadSec + (key === 'ArrowUp' ? step : -step), 0, duration);
      return { state: { ...state, playheadSec: round(playheadSec), playing: false }, handled: true, effect: 'seek' };
    }
    case ' ':
    case 'Spacebar':
      return { state: { ...state, playing: !state.playing }, handled: true, effect: 'toggle-play' };
    case 'Enter':
      return { state, handled: true, effect: 'confirm' };
    case 'Escape':
      return { state, handled: true, effect: 'cancel' };
    default:
      return { state, handled: false };
  }
}

/** 播放时到达出点就停在出点（预览只播选区）。返回是否需要暂停。 */
export function trimPlaybackGuard(state: TrimState, currentSec: number): { playheadSec: number; stop: boolean } {
  if (state.playing && currentSec >= state.outSec) return { playheadSec: state.outSec, stop: true };
  return { playheadSec: round(clamp(currentSec, 0, state.durationSec)), stop: false };
}

export function formatTrimTime(sec: number): string {
  const safe = Math.max(0, sec);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
}
