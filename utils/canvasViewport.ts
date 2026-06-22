export interface CanvasVisibleRegionInput {
  width: number;
  height: number;
  outerGap: number;
  bottomInset: number;
  leftPanelOpen: boolean;
  leftPanelWidth: number;
}

export function getCanvasVisibleRegion({ width, height, outerGap, bottomInset, leftPanelOpen, leftPanelWidth }: CanvasVisibleRegionInput) {
  const left = outerGap + (leftPanelOpen ? leftPanelWidth : 0);
  const top = outerGap;
  const right = width - outerGap;
  const bottom = height - bottomInset;
  const visibleWidth = Math.max(120, right - left);
  const visibleHeight = Math.max(120, bottom - top);
  return {
    left,
    top,
    right,
    bottom,
    width: visibleWidth,
    height: visibleHeight,
    centerX: left + visibleWidth / 2,
    centerY: top + visibleHeight / 2,
  };
}
