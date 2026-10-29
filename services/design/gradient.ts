import type { DesignFill, DesignGradientStop } from './designTypes';
import { clamp01, escapeXml, fmt } from './svgUtils';

export interface SvgPaint {
  /** 需要放进 <defs> 的渐变定义；纯色或无填充时为空串。 */
  defs: string;
  /** 用于 fill / stroke 属性的值：颜色、url(#id) 或 none。 */
  paint: string;
  /** 纯色填充的 fill-opacity；为 1 时省略。 */
  opacity?: number;
}

function normalizeStops(stops: DesignGradientStop[]): DesignGradientStop[] {
  return stops
    .filter(stop => typeof stop.color === 'string' && stop.color.trim() !== '')
    .map(stop => ({ ...stop, offset: clamp01(stop.offset, 0), opacity: clamp01(stop.opacity) }))
    .sort((a, b) => a.offset - b.offset);
}

/** 少于 2 个色标的渐变退化为纯色（1 个）或无填充（0 个）。 */
export function normalizeFill(fill: DesignFill | undefined): DesignFill {
  if (!fill) return { type: 'none' };
  if (fill.type !== 'linear' && fill.type !== 'radial') return fill;
  const stops = normalizeStops(fill.stops);
  if (stops.length === 0) return { type: 'none' };
  if (stops.length === 1) return { type: 'solid', color: stops[0].color, opacity: stops[0].opacity };
  return { ...fill, stops };
}

/** CSS 角度 → objectBoundingBox 下的渐变端点。 */
export function linearGradientVector(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad) / 2;
  const dy = -Math.cos(rad) / 2;
  return { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy };
}

function stopsToSvg(stops: DesignGradientStop[]): string {
  return stops.map(stop => {
    const opacity = clamp01(stop.opacity);
    return `<stop offset="${fmt(stop.offset)}" stop-color="${escapeXml(stop.color)}"${opacity < 1 ? ` stop-opacity="${fmt(opacity)}"` : ''}/>`;
  }).join('');
}

export function fillToSvg(input: DesignFill | undefined, id: string): SvgPaint {
  const fill = normalizeFill(input);
  const safeId = escapeXml(id);
  switch (fill.type) {
    case 'none':
      return { defs: '', paint: 'none' };
    case 'solid': {
      const opacity = clamp01(fill.opacity);
      return { defs: '', paint: escapeXml(fill.color), ...(opacity < 1 ? { opacity } : {}) };
    }
    case 'linear': {
      const v = linearGradientVector(fill.angle);
      return {
        defs: `<linearGradient id="${safeId}" x1="${fmt(v.x1)}" y1="${fmt(v.y1)}" x2="${fmt(v.x2)}" y2="${fmt(v.y2)}">${stopsToSvg(fill.stops)}</linearGradient>`,
        paint: `url(#${safeId})`,
      };
    }
    case 'radial':
      return {
        defs: `<radialGradient id="${safeId}" cx="${fmt(clamp01(fill.cx, 0.5))}" cy="${fmt(clamp01(fill.cy, 0.5))}" r="${fmt(clamp01(fill.r, 0.5))}">${stopsToSvg(fill.stops)}</radialGradient>`,
        paint: `url(#${safeId})`,
      };
  }
}

function cssColor(color: string, opacity: number): string {
  if (opacity >= 1) return color;
  return `color-mix(in srgb, ${color} ${fmt(opacity * 100)}%, transparent)`;
}

/** 用于属性面板色块、预览等 DOM 场景。 */
export function fillToCss(input: DesignFill | undefined): string {
  const fill = normalizeFill(input);
  switch (fill.type) {
    case 'none':
      return 'transparent';
    case 'solid':
      return cssColor(fill.color, clamp01(fill.opacity));
    case 'linear':
      return `linear-gradient(${fmt(fill.angle)}deg, ${fill.stops.map(stop => `${cssColor(stop.color, clamp01(stop.opacity))} ${fmt(stop.offset * 100)}%`).join(', ')})`;
    case 'radial':
      return `radial-gradient(circle at ${fmt(clamp01(fill.cx, 0.5) * 100)}% ${fmt(clamp01(fill.cy, 0.5) * 100)}%, ${fill.stops.map(stop => `${cssColor(stop.color, clamp01(stop.opacity))} ${fmt(stop.offset * 100)}%`).join(', ')})`;
  }
}
