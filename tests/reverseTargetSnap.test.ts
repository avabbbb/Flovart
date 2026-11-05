import { describe, expect, it } from 'vitest';
import { dialogueRanges, snapWindowsToSentences } from '../services/reverse/target';
import type { ShotWindow } from '../services/reverse/video';
import type { ReverseWord } from '../services/reverse/types';

const words: ReverseWord[] = [
  { index: 0, text: 'Hi', startMs: 0, endMs: 400 },
  { index: 1, text: 'there', surface: 'there.', startMs: 400, endMs: 900 },
  { index: 2, text: 'Buy', startMs: 1000, endMs: 1300 },
  { index: 3, text: 'now', surface: 'now.', startMs: 1300, endMs: 1800 },
];

describe('snapWindowsToSentences', () => {
  it('moves an unanchored boundary to the sentence end so duration follows the line', () => {
    const windows: ShotWindow[] = [
      { shotId: 'shot-1', startMs: 0, endMs: 1200, anchored: false },
      { shotId: 'shot-2', startMs: 1200, endMs: 1800, anchored: false },
    ];
    const ranges = dialogueRanges(words, windows);
    expect(ranges.get('shot-1')).toEqual([0, 1]);
    expect(ranges.get('shot-2')).toEqual([2, 3]);
    const snapped = snapWindowsToSentences(words, windows, ranges);
    expect(snapped.map((w) => [w.startMs, w.endMs])).toEqual([[0, 950], [950, 1800]]);
    expect(windows[0]!.endMs).toBe(1200);
  });

  it('keeps anchored (cue) boundaries untouched', () => {
    const windows: ShotWindow[] = [
      { shotId: 'shot-1', startMs: 0, endMs: 1200, anchored: false },
      { shotId: 'shot-2', startMs: 1200, endMs: 1800, anchored: true },
    ];
    const snapped = snapWindowsToSentences(words, windows, dialogueRanges(words, windows));
    expect(snapped.map((w) => [w.startMs, w.endMs])).toEqual([[0, 1200], [1200, 1800]]);
  });
});
