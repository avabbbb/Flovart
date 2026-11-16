/**
 * 斜叠卡片展开 / 收起的几何与弹簧（DESIGN.md §9.5、01 §13.3）。
 * 分镜 / 批量命令的 auto 分组（InfiniteWorkflow 的 WorkflowBatchCell）与首图节点上的少量备选
 * （WorkflowAlternatesStack）共用这一套：展开时每格从叠放位置弹到 2 列网格位，收起时反向飞回。
 */

/** 网格格子之间的间距（世界坐标）。 */
export const BATCH_GRID_GAP = 12;

/** 叠放外壳悬停时的轻微放大（旧 WorkflowBatchStack 根元素）。 */
export const BATCH_STACK_SPRING = { type: 'spring', stiffness: 380, damping: 26, mass: 0.8 } as const;

/** 第 index 格（0 = 首图所在格）在网格里的左上角，单位与节点宽高相同。 */
export function batchCellOffset(index: number, columns: number, cellWidth: number, cellHeight: number) {
  return {
    left: (index % columns) * (cellWidth + BATCH_GRID_GAP),
    top: Math.floor(index / columns) * (cellHeight + BATCH_GRID_GAP),
  };
}

/** 叠放姿态：相对网格位回到首图所在格，稍微错开一点，非首格透明。 */
export function batchCellStackedPose(index: number, left: number, top: number) {
  return { x: -left + Math.min(index, 2) * 5, y: -top + Math.min(index, 2) * 3, scale: 0.96, opacity: index === 0 ? 1 : 0 };
}

/** 展开：逐格错开 40ms 弹出。 */
export function batchCellOpenTransition(index: number) {
  return { type: 'spring', stiffness: 420, damping: 32, mass: 0.7, delay: index * 0.04 } as const;
}

/** 收起：从最后一格开始，逐格错开 25ms 飞回。 */
export function batchCellCloseTransition(index: number, count: number) {
  return { type: 'spring', stiffness: 520, damping: 40, delay: (count - 1 - index) * 0.025 } as const;
}
