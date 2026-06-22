import { describe, expect, it } from 'vitest';
import { getCanvasVisibleRegion } from '../utils/canvasViewport';

describe('Canvas visible region', () => {
  it('does not reserve sidebar width when the left drawer is closed', () => {
    const closed = getCanvasVisibleRegion({
      width: 1200,
      height: 700,
      outerGap: 16,
      bottomInset: 88,
      leftPanelOpen: false,
      leftPanelWidth: 280,
    });
    const open = getCanvasVisibleRegion({
      width: 1200,
      height: 700,
      outerGap: 16,
      bottomInset: 88,
      leftPanelOpen: true,
      leftPanelWidth: 280,
    });

    expect(closed.centerX).toBe(600);
    expect(open.centerX).toBe(740);
  });
});
