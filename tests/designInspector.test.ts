import { describe, expect, it } from 'vitest';
import { applyFramePreset, convertFill, pickOption, plainTextToRuns, runsToPlainText, setGradientStopColor } from '../services/design/inspector';

describe('design inspector helpers', () => {
  it('keeps colors when converting fills', () => {
    const linear = convertFill({ type: 'solid', color: '#ff0000' }, 'linear');
    expect(linear).toEqual({ type: 'linear', angle: 90, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#FFFFFF' }] });
    expect(convertFill(linear, 'solid')).toEqual({ type: 'solid', color: '#ff0000' });
    expect(convertFill(linear, 'none')).toEqual({ type: 'none' });
  });

  it('edits gradient end stops only', () => {
    const fill = setGradientStopColor({ type: 'radial', stops: [{ offset: 0, color: '#000' }, { offset: 0.5, color: '#111' }, { offset: 1, color: '#222' }] }, 'end', '#abc');
    expect(fill.type === 'radial' && fill.stops.map(stop => stop.color)).toEqual(['#000', '#111', '#abc']);
    expect(setGradientStopColor({ type: 'solid', color: '#000' }, 'start', '#fff')).toEqual({ type: 'solid', color: '#000' });
  });

  it('round-trips plain text and keeps first run style', () => {
    const runs = [{ text: 'Hello ', fontWeight: 700 }, { text: 'World' }];
    expect(runsToPlainText(runs)).toBe('Hello World');
    expect(plainTextToRuns(runs, 'Hi')).toEqual([{ text: 'Hi', fontWeight: 700 }]);
    expect(plainTextToRuns([], 'Hi')).toEqual([{ text: 'Hi' }]);
  });

  it('narrows option values', () => {
    expect(pickOption('b', ['a', 'b'] as const, 'a')).toBe('b');
    expect(pickOption(3, ['a', 'b'] as const, 'a')).toBe('a');
  });

  it('applies frame presets with node size', () => {
    const design = { kind: 'frame' as const, fill: { type: 'none' as const }, frame: { clip: true, childIds: [] } };
    expect(applyFramePreset(design, 'square')).toMatchObject({ width: 1080, height: 1080, design: { frame: { preset: 'square' } } });
    expect(applyFramePreset(design, 'nope')).toBeNull();
    expect(applyFramePreset({ kind: 'rect', fill: { type: 'none' } }, 'square')).toBeNull();
  });
});
