import { edgesPipeline, type EdgesOptions } from './edges';

export interface LineartOptions extends EdgesOptions {}

/**
 * Line-art extraction. Current implementation routes to the Canny/edges pipeline
 * with a finer-edged preset (lower thresholds, lighter blur), producing a
 * clean line-art approximation. A dedicated anime line-art model
 * (e.g. informative-drawings) can replace this router later without touching
 * the worker boundary.
 */
export function lineartFromImage(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  opts: LineartOptions = {},
): Uint8ClampedArray {
  const preset: EdgesOptions = {
    thresholdLow: opts.thresholdLow ?? 0.12,
    thresholdHigh: opts.thresholdHigh ?? 0.32,
    blur: opts.blur ?? 0.8,
    invert: opts.invert ?? true,
  };
  return edgesPipeline(src, width, height, preset);
}