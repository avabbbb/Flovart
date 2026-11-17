// 节点工具条避让悬浮面板：左侧图层 / 资产栏和右侧 Agent 面板悬浮在画布上方（不占画布宽度），
// 工具条按节点居中时会被它们盖住，删除等按钮点不到。这里算出工具条那一行里没被面板挡住的横向区间，
// 再把工具条整体挪进去（不改层级，不去盖面板里的内容）。

export interface BandRect { left: number; right: number; top: number; bottom: number }

export const TOOLBAR_OBSTACLE_SELECTOR = [
  '.workflow-sidebar:not([data-docked])',
  ".compact-right-panel[data-open='true']",
].join(', ');

const EDGE = 8;

/** 工具条所在行（rowTop..rowBottom，相对视口）里，root 内没被障碍挡住的区间（相对视口）。 */
export function visibleBand(root: BandRect, obstacles: BandRect[], rowTop: number, rowBottom: number): { left: number; right: number } {
  let left = root.left;
  let right = root.right;
  const mid = (root.left + root.right) / 2;
  for (const rect of obstacles) {
    if (rect.right <= rect.left || rect.bottom <= rowTop || rect.top >= rowBottom) continue;
    if (rect.right <= root.left || rect.left >= root.right) continue;
    if ((rect.left + rect.right) / 2 < mid) left = Math.max(left, rect.right);
    else right = Math.min(right, rect.left);
  }
  return { left, right };
}

/** 工具条以 center 居中（translateX(-50%)），宽 width；返回挪进 band 后的中心。band 放不下时贴左边。 */
export function clampCenterIntoBand(center: number, width: number, band: { left: number; right: number }): number {
  const min = band.left + EDGE + width / 2;
  const max = band.right - EDGE - width / 2;
  if (max < min) return min;
  return Math.max(min, Math.min(center, max));
}
