import { describe, expect, it } from 'vitest';
import { traceImageDataToSvg } from '../services/vectorizeImage';

function twoTone(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const left = x < width / 2;
    data[i] = left ? 255 : 0; data[i + 1] = 0; data[i + 2] = left ? 0 : 255; data[i + 3] = 255;
  }
  return { width, height, data };
}

describe('traceImageDataToSvg', () => {
  it.each(['detailed', 'poster', 'line'] as const)('%s 预设输出带 viewBox 的 SVG 路径', preset => {
    const svg = traceImageDataToSvg(twoTone(16, 16), preset);
    expect(svg).toMatch(/^<svg width="16" height="16" /);
    expect(svg).toContain('viewBox="0 0 16 16"');
    expect(svg).toContain('<path');
  });
});
