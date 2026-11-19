// 时间线吸附。改编自 OpenCut classic apps/web/src/timeline/snapping/{types,resolve}.ts（MIT，见 third_party/opencut/LICENSE）：
// 同样的"候选吸附点 + 阈值内取最近"模型，只是时间单位从 wasm ticks 换成秒。
export type SnapPointType = 'element-start' | 'element-end' | 'playhead' | 'keyframe';

export interface SnapPoint { time: number; type: SnapPointType; elementId?: string }
export interface SnapResult { time: number; point: SnapPoint | null; distance: number }

export function resolveSnap(target: number, points: readonly SnapPoint[], maxDistance: number): SnapResult {
  let closest: SnapPoint | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = Math.abs(target - point.time);
    if (distance <= maxDistance && distance < best) { best = distance; closest = point; }
  }
  return { time: closest ? closest.time : target, point: closest, distance: best };
}
