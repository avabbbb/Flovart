import { describe, expect, it } from 'vitest';
import { clampCenterIntoBand, visibleBand } from '../components/workflow/toolbarVisibleBand';

const root = { left: 0, right: 1400, top: 0, bottom: 900 };

describe('toolbarVisibleBand', () => {
  it('左侧图层栏和右侧 Agent 面板都挡在工具条这一行时，区间缩到两者之间', () => {
    const band = visibleBand(root, [
      { left: 8, right: 288, top: 60, bottom: 880 },
      { left: 980, right: 1392, top: 8, bottom: 892 },
    ], 100, 144);
    expect(band).toEqual({ left: 288, right: 980 });
  });
  it('不在这一行的面板不算', () => {
    expect(visibleBand(root, [{ left: 8, right: 288, top: 400, bottom: 880 }], 100, 144)).toEqual({ left: 0, right: 1400 });
  });
  it('节点在右侧面板下面时，工具条整体挪回可见区', () => {
    expect(clampCenterIntoBand(1100, 300, { left: 288, right: 980 })).toBe(980 - 8 - 150);
    expect(clampCenterIntoBand(100, 300, { left: 288, right: 980 })).toBe(288 + 8 + 150);
    expect(clampCenterIntoBand(600, 300, { left: 288, right: 980 })).toBe(600);
  });
  it('可见区放不下时贴左边，保证左端按钮可点', () => {
    expect(clampCenterIntoBand(600, 800, { left: 288, right: 980 })).toBe(288 + 8 + 400);
  });
});
