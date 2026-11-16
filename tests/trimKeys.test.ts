import { describe, expect, it } from 'vitest';
import { createTrimState, formatTrimTime, setTrimRange, trimKeyReducer, trimPlaybackGuard } from '../components/workflow/trimKeys';

const at = (playheadSec: number) => ({ ...createTrimState(10), playheadSec });

describe('trimKeyReducer', () => {
  it('sets in/out points at the playhead with I/O (case-insensitive) and keeps a minimum length', () => {
    let state = trimKeyReducer(at(2), { key: 'i' }).state;
    expect(state).toMatchObject({ inSec: 2, outSec: 10 });
    state = trimKeyReducer({ ...state, playheadSec: 6.5 }, { key: 'O' }).state;
    expect(state).toMatchObject({ inSec: 2, outSec: 6.5 });
    expect(trimKeyReducer({ ...state, playheadSec: 9 }, { key: 'i' }).state.inSec).toBe(6.4);
    expect(trimKeyReducer({ ...state, playheadSec: 1 }, { key: 'o' }).state.outSec).toBe(2.1);
  });

  it('moves the whole selection with ←/→ (0.1s, Shift 0.01s) inside the clip', () => {
    const base = { ...createTrimState(10), inSec: 2, outSec: 4 };
    expect(trimKeyReducer(base, { key: 'ArrowRight' }).state).toMatchObject({ inSec: 2.1, outSec: 4.1 });
    expect(trimKeyReducer(base, { key: 'ArrowLeft', shiftKey: true }).state).toMatchObject({ inSec: 1.99, outSec: 3.99 });
    expect(trimKeyReducer({ ...base, inSec: 0.05, outSec: 2.05 }, { key: 'ArrowLeft' }).state).toMatchObject({ inSec: 0, outSec: 2 });
    expect(trimKeyReducer({ ...base, inSec: 7.95, outSec: 9.95 }, { key: 'ArrowRight' }).state).toMatchObject({ inSec: 8, outSec: 10 });
  });

  it('nudges the playhead with ↑/↓ and asks the UI to seek', () => {
    expect(trimKeyReducer(at(5), { key: 'ArrowUp' })).toMatchObject({ state: { playheadSec: 5.1 }, effect: 'seek' });
    expect(trimKeyReducer(at(5), { key: 'ArrowDown', shiftKey: true })).toMatchObject({ state: { playheadSec: 4.99 }, effect: 'seek' });
    expect(trimKeyReducer(at(0), { key: 'ArrowDown' }).state.playheadSec).toBe(0);
  });

  it('toggles play with space, confirms with Enter, cancels with Escape, ignores other keys', () => {
    expect(trimKeyReducer(at(0), { key: ' ' })).toMatchObject({ state: { playing: true }, effect: 'toggle-play' });
    expect(trimKeyReducer(at(0), { key: 'Enter' }).effect).toBe('confirm');
    expect(trimKeyReducer(at(0), { key: 'Escape' }).effect).toBe('cancel');
    expect(trimKeyReducer(at(0), { key: 'x' }).handled).toBe(false);
  });
});

describe('trim helpers', () => {
  it('clamps slider ranges', () => {
    expect(setTrimRange(createTrimState(10), 5, 5)).toMatchObject({ inSec: 5, outSec: 5.1 });
    expect(setTrimRange(createTrimState(10), -1, 20)).toMatchObject({ inSec: 0, outSec: 10 });
    expect(setTrimRange(createTrimState(10), 9.99, 10)).toMatchObject({ inSec: 9.9, outSec: 10 });
  });
  it('stops preview playback at the out point', () => {
    const state = { ...createTrimState(10), inSec: 1, outSec: 3, playing: true };
    expect(trimPlaybackGuard(state, 3.2)).toEqual({ playheadSec: 3, stop: true });
    expect(trimPlaybackGuard(state, 2)).toEqual({ playheadSec: 2, stop: false });
  });
  it('formats mm:ss.cc', () => {
    expect(formatTrimTime(65.5)).toBe('01:05.50');
  });
});
