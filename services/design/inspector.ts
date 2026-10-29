import { DESIGN_FRAME_PRESETS, type DesignAutoLayout, type DesignElement, type DesignFill, type DesignTextRun } from './designTypes';

export type DesignFillKind = DesignFill['type'];

export const DESIGN_FILL_KINDS: readonly DesignFillKind[] = ['none', 'solid', 'linear', 'radial'];

/** 把 UI 控件回传的值收窄到允许的字面量集合，非法值回退。 */
export function pickOption<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find(item => item === value) ?? fallback;
}

const FALLBACK_COLOR = '#5B8DEF';

/** 取填充的代表色：纯色取自身，渐变取首个色标。 */
export function fillPrimaryColor(fill: DesignFill): string {
  if (fill.type === 'solid') return fill.color;
  if (fill.type === 'linear' || fill.type === 'radial') return fill.stops[0]?.color ?? FALLBACK_COLOR;
  return FALLBACK_COLOR;
}

/** 切换填充类型时尽量保留颜色：纯色 ↔ 渐变互转沿用首尾色。 */
export function convertFill(fill: DesignFill, kind: DesignFillKind): DesignFill {
  if (fill.type === kind) return fill;
  const start = fillPrimaryColor(fill);
  const end = fill.type === 'linear' || fill.type === 'radial' ? fill.stops[fill.stops.length - 1]?.color ?? '#FFFFFF' : '#FFFFFF';
  const stops = [{ offset: 0, color: start }, { offset: 1, color: end }];
  switch (kind) {
    case 'none': return { type: 'none' };
    case 'solid': return { type: 'solid', color: start };
    case 'linear': return { type: 'linear', angle: fill.type === 'linear' ? fill.angle : 90, stops };
    case 'radial': return { type: 'radial', stops };
  }
}

/** 修改渐变首/尾色标颜色；非渐变原样返回。 */
export function setGradientStopColor(fill: DesignFill, which: 'start' | 'end', color: string): DesignFill {
  if (fill.type !== 'linear' && fill.type !== 'radial') return fill;
  if (fill.stops.length === 0) return { ...fill, stops: [{ offset: 0, color }, { offset: 1, color }] };
  const index = which === 'start' ? 0 : fill.stops.length - 1;
  return { ...fill, stops: fill.stops.map((stop, i) => i === index ? { ...stop, color } : stop) };
}

/** 富文本的纯文本视图。 */
export function runsToPlainText(runs: readonly DesignTextRun[]): string {
  return runs.map(run => run.text).join('');
}

/** 用纯文本替换内容：保留首个片段的样式覆盖，整段文字合为一个片段。 */
export function plainTextToRuns(runs: readonly DesignTextRun[], text: string): DesignTextRun[] {
  const first = runs[0];
  return [first ? { ...first, text } : { text }];
}

export const DEFAULT_AUTO_LAYOUT: DesignAutoLayout = {
  direction: 'vertical',
  gap: 16,
  padding: { top: 24, right: 24, bottom: 24, left: 24 },
  align: 'start',
  justify: 'start',
  sizing: 'fixed',
};

/** 切换画板预设：返回新元素与节点尺寸。未知预设返回 null。 */
export function applyFramePreset(design: DesignElement, presetId: string): { design: DesignElement; width: number; height: number } | null {
  const preset = DESIGN_FRAME_PRESETS.find(item => item.id === presetId);
  if (!preset || !design.frame) return null;
  return { design: { ...design, frame: { ...design.frame, preset: preset.id } }, width: preset.width, height: preset.height };
}
