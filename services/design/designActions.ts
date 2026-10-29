import { booleanShapes, type DesignBooleanOperation, type DesignShapeInput } from './booleanOps';
import { computeAutoLayout, type AutoLayoutChild } from './autoLayout';
import type { DesignElement, DesignElementKind } from './designTypes';

// 画布动作：把布尔运算与画板自动布局的纯计算接到节点几何上，UI 只负责落盘。

export interface DesignBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignBoxWithId extends DesignBox {
  id: string;
}

// 画板含子元素、文字没有轮廓，均不参与布尔运算。
const BOOLEAN_SOURCE_KINDS: ReadonlySet<DesignElementKind> = new Set<DesignElementKind>(['rect', 'ellipse', 'path']);

export function canCombineShapes(shapes: readonly DesignShapeInput[]): boolean {
  return shapes.length >= 2 && shapes.every(shape => BOOLEAN_SOURCE_KINDS.has(shape.element.kind));
}

// shapes 按图层顺序（底到顶）；结果沿用最底层形状的填充、描边与不透明度。
export function buildBooleanElement(operation: DesignBooleanOperation, shapes: readonly DesignShapeInput[]): { element: DesignElement; box: DesignBox } | null {
  if (!canCombineShapes(shapes)) return null;
  const result = booleanShapes(operation, shapes);
  if (!result) return null;
  const base = shapes[0].element;
  const element: DesignElement = {
    kind: 'path',
    fill: base.fill.type === 'none' ? { type: 'solid', color: '#D9D9D9' } : base.fill,
    ...(base.stroke ? { stroke: base.stroke } : {}),
    ...(base.opacity !== undefined ? { opacity: base.opacity } : {}),
    path: { d: result.d, viewBox: { x: 0, y: 0, width: result.width, height: result.height }, closed: true, fillRule: 'evenodd' },
  };
  return { element, box: { x: result.x, y: result.y, width: result.width, height: result.height } };
}

// 中心点落在画板内的候选视为子元素；按主轴方向排序，作为自动布局的顺序。
export function findFrameChildren(frame: DesignBoxWithId, candidates: readonly DesignBoxWithId[], direction: 'horizontal' | 'vertical'): DesignBoxWithId[] {
  const inside = candidates.filter(item => {
    if (item.id === frame.id) return false;
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    return cx >= frame.x && cx <= frame.x + frame.width && cy >= frame.y && cy <= frame.y + frame.height;
  });
  return inside.sort((a, b) => (direction === 'horizontal' ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x));
}

export interface FrameLayoutUpdate {
  frame: DesignBox;
  children: Record<string, DesignBox>;
}

// 返回画布坐标下的画板与子元素新几何；画板未开启自动布局或没有子元素时返回 null。
export function layoutFrameChildren(frameElement: DesignElement, frameBox: DesignBox, children: readonly AutoLayoutChild[]): FrameLayoutUpdate | null {
  const layout = frameElement.frame?.autoLayout;
  if (!layout || children.length === 0) return null;
  const result = computeAutoLayout(layout, children, { width: frameBox.width, height: frameBox.height });
  const placed: Record<string, DesignBox> = {};
  for (const child of children) {
    const box = result.boxes[child.id];
    if (box) placed[child.id] = { x: frameBox.x + box.x, y: frameBox.y + box.y, width: box.width, height: box.height };
  }
  return { frame: { x: frameBox.x, y: frameBox.y, width: result.width, height: result.height }, children: placed };
}
