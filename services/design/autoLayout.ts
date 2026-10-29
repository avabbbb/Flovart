import type { DesignAutoLayout } from './designTypes';

export interface AutoLayoutChild {
  id: string;
  width: number;
  height: number;
}

export interface AutoLayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AutoLayoutResult {
  width: number;
  height: number;
  /** 相对画板左上角的位置 */
  boxes: Record<string, AutoLayoutBox>;
}

/**
 * 计算画板自动布局。children 按顺序排列；frameSize 仅在 sizing='fixed' 时作为画板尺寸。
 * hug 模式下 justify 无剩余空间，等同 start。
 */
export function computeAutoLayout(layout: DesignAutoLayout, children: readonly AutoLayoutChild[], frameSize: { width: number; height: number }): AutoLayoutResult {
  const horizontal = layout.direction === 'horizontal';
  const { padding } = layout;
  const gap = Math.max(0, layout.gap);
  const mainOf = (c: { width: number; height: number }) => (horizontal ? c.width : c.height);
  const crossOf = (c: { width: number; height: number }) => (horizontal ? c.height : c.width);
  const mainPadStart = horizontal ? padding.left : padding.top;
  const mainPadEnd = horizontal ? padding.right : padding.bottom;
  const crossPadStart = horizontal ? padding.top : padding.left;
  const crossPadEnd = horizontal ? padding.bottom : padding.right;

  const count = children.length;
  const contentMain = children.reduce((sum, c) => sum + Math.max(0, mainOf(c)), 0) + gap * Math.max(0, count - 1);
  const contentCross = children.reduce((max, c) => Math.max(max, crossOf(c)), 0);

  const hug = layout.sizing === 'hug';
  const frameMain = hug ? contentMain + mainPadStart + mainPadEnd : mainOf(frameSize);
  const frameCross = hug ? contentCross + crossPadStart + crossPadEnd : crossOf(frameSize);
  const availMain = Math.max(0, frameMain - mainPadStart - mainPadEnd);
  const availCross = Math.max(0, frameCross - crossPadStart - crossPadEnd);

  let cursor = mainPadStart;
  let step = gap;
  const free = availMain - contentMain;
  if (!hug) {
    if (layout.justify === 'center') cursor += free / 2;
    else if (layout.justify === 'end') cursor += free;
    else if (layout.justify === 'space-between' && count > 1) {
      const sizes = contentMain - gap * (count - 1);
      step = Math.max(0, (availMain - sizes) / (count - 1));
    }
  }

  const boxes: Record<string, AutoLayoutBox> = {};
  for (const child of children) {
    const main = Math.max(0, mainOf(child));
    let cross = Math.max(0, crossOf(child));
    let crossPos = crossPadStart;
    if (layout.align === 'stretch') cross = availCross;
    else if (layout.align === 'center') crossPos += (availCross - cross) / 2;
    else if (layout.align === 'end') crossPos += availCross - cross;
    boxes[child.id] = horizontal
      ? { x: cursor, y: crossPos, width: main, height: cross }
      : { x: crossPos, y: cursor, width: cross, height: main };
    cursor += main + step;
  }

  return horizontal
    ? { width: frameMain, height: frameCross, boxes }
    : { width: frameCross, height: frameMain, boxes };
}

export const DEFAULT_AUTO_LAYOUT: DesignAutoLayout = {
  direction: 'vertical',
  gap: 16,
  padding: { top: 24, right: 24, bottom: 24, left: 24 },
  align: 'start',
  justify: 'start',
  sizing: 'hug',
};
