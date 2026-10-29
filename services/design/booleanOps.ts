import * as polygonClippingModule from 'polygon-clipping';
import type { MultiPolygon, Pair, Polygon, Ring } from 'polygon-clipping';
import type { DesignElement } from './designTypes';
import { samplePath } from './penPath';
import { fmt } from './svgUtils';

export type DesignBooleanOperation = 'union' | 'intersect' | 'subtract' | 'exclude';

export const DESIGN_BOOLEAN_LABELS: Record<DesignBooleanOperation, string> = {
  union: '合并',
  intersect: '相交',
  subtract: '减去顶层',
  exclude: '排除重叠',
};

type PolygonClippingApi = {
  union: (geom: Polygon | MultiPolygon, ...geoms: Array<Polygon | MultiPolygon>) => MultiPolygon;
  intersection: (geom: Polygon | MultiPolygon, ...geoms: Array<Polygon | MultiPolygon>) => MultiPolygon;
  difference: (geom: Polygon | MultiPolygon, ...geoms: Array<Polygon | MultiPolygon>) => MultiPolygon;
  xor: (geom: Polygon | MultiPolygon, ...geoms: Array<Polygon | MultiPolygon>) => MultiPolygon;
};

// polygon-clipping 的 ESM 构建只有 default 导出，类型声明却只有具名导出；运行时校验两种形态。
function isPolygonClippingApi(value: unknown): value is PolygonClippingApi {
  return !!value && typeof value === 'object'
    && 'union' in value && typeof value.union === 'function'
    && 'intersection' in value && typeof value.intersection === 'function'
    && 'difference' in value && typeof value.difference === 'function'
    && 'xor' in value && typeof value.xor === 'function';
}

function resolvePolygonClipping(ns: unknown): PolygonClippingApi {
  const fallback = ns && typeof ns === 'object' && 'default' in ns ? ns.default : undefined;
  if (isPolygonClippingApi(fallback)) return fallback;
  if (isPolygonClippingApi(ns)) return ns;
  throw new Error('polygon-clipping 导出形态无法识别');
}

const clipping = resolvePolygonClipping(polygonClippingModule);

export interface DesignShapeInput {
  element: DesignElement;
  /** 元素在画布坐标中的位置与尺寸 */
  x: number;
  y: number;
  width: number;
  height: number;
}

const CURVE_SEGMENTS = 24;

function closeRing(points: Array<[number, number]>): Ring {
  const ring: Pair[] = points.map(([px, py]) => [px, py]);
  if (ring.length > 0) {
    const [fx, fy] = ring[0];
    const [lx, ly] = ring[ring.length - 1];
    if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  }
  return ring;
}

function rectRing(x: number, y: number, width: number, height: number, radius: number): Ring {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (r === 0) return closeRing([[x, y], [x + width, y], [x + width, y + height], [x, y + height]]);
  const points: Array<[number, number]> = [];
  const corners: Array<[number, number, number]> = [
    [x + width - r, y + r, -Math.PI / 2],
    [x + width - r, y + height - r, 0],
    [x + r, y + height - r, Math.PI / 2],
    [x + r, y + r, Math.PI],
  ];
  const steps = 6;
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= steps; i += 1) {
      const a = start + (i / steps) * (Math.PI / 2);
      points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return closeRing(points);
}

function ellipseRing(x: number, y: number, width: number, height: number): Ring {
  const points: Array<[number, number]> = [];
  const steps = 64;
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    points.push([x + width / 2 + (width / 2) * Math.cos(a), y + height / 2 + (height / 2) * Math.sin(a)]);
  }
  return closeRing(points);
}

/** 把一个设计元素转成画布坐标下的多边形；不支持的类型（文字、画板外的空路径）返回 null。 */
export function shapeToMultiPolygon(shape: DesignShapeInput): MultiPolygon | null {
  const { element, x, y, width, height } = shape;
  if (width <= 0 || height <= 0) return null;
  if (element.kind === 'rect' || element.kind === 'frame') return [[rectRing(x, y, width, height, element.cornerRadius ?? 0)]];
  if (element.kind === 'ellipse') return [[ellipseRing(x, y, width, height)]];
  if (element.kind === 'path' && element.path) {
    const { viewBox } = element.path;
    if (viewBox.width <= 0 || viewBox.height <= 0) return null;
    const sx = width / viewBox.width;
    const sy = height / viewBox.height;
    const rings = samplePath(element.path.d, CURVE_SEGMENTS)
      .filter(polygon => polygon.points.length >= 3)
      .map(polygon => closeRing(polygon.points.map(([px, py]) => [x + (px - viewBox.x) * sx, y + (py - viewBox.y) * sy])));
    if (rings.length === 0) return null;
    // 多个子路径按 evenodd 语义组合：互相异或，内环即成洞。
    const [first, ...rest] = rings.map(ring => [ring] as Polygon);
    return rest.length ? clipping.xor(first, ...rest) : [first];
  }
  return null;
}

export interface DesignBooleanResult {
  d: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function multiPolygonToPath(geometry: MultiPolygon, originX: number, originY: number): string {
  const parts: string[] = [];
  for (const polygon of geometry) {
    for (const ring of polygon) {
      // polygon-clipping 输出的环首尾重复，Z 已表达闭合
      const points = ring.length > 1 ? ring.slice(0, -1) : ring;
      if (points.length < 3) continue;
      parts.push(`M${points.map(([px, py]) => `${fmt(px - originX)} ${fmt(py - originY)}`).join(' L')} Z`);
    }
  }
  return parts.join(' ');
}

/**
 * 对按图层顺序（底→顶）排列的形状做布尔运算。
 * subtract：最底层减去其余所有；exclude：全部异或。
 * 返回以结果包围盒左上角为原点的 path d，以及包围盒在画布中的位置；结果为空时返回 null。
 */
export function booleanShapes(operation: DesignBooleanOperation, shapes: readonly DesignShapeInput[]): DesignBooleanResult | null {
  const geometries = shapes.map(shapeToMultiPolygon).filter((g): g is MultiPolygon => !!g && g.length > 0);
  if (geometries.length < 2) return null;
  const [first, ...rest] = geometries;
  const result = operation === 'union' ? clipping.union(first, ...rest)
    : operation === 'intersect' ? clipping.intersection(first, ...rest)
      : operation === 'subtract' ? clipping.difference(first, ...rest)
        : clipping.xor(first, ...rest);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const polygon of result) for (const ring of polygon) for (const [px, py] of ring) {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  if (!Number.isFinite(minX) || maxX - minX <= 0 || maxY - minY <= 0) return null;
  return { d: multiPolygonToPath(result, minX, minY), x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
