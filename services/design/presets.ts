import { DEFAULT_TEXT_STYLE, DESIGN_FRAME_PRESETS, type DesignElement, type DesignElementKind } from './designTypes';

/** 从创建菜单新建设计节点时使用的模板：标题、初始尺寸与元素数据。 */
export interface DesignNodeTemplate {
  kind: DesignElementKind;
  title: string;
  width: number;
  height: number;
  design: DesignElement;
}

export const DESIGN_CREATE_KINDS: readonly DesignElementKind[] = ['frame', 'rect', 'ellipse', 'text', 'path'];

export function isDesignElementKind(value: unknown): value is DesignElementKind {
  return typeof value === 'string' && DESIGN_CREATE_KINDS.some(kind => kind === value);
}

const ACCENT = '#5B8DEF';

export function createDesignTemplate(kind: DesignElementKind, presetId = 'phone'): DesignNodeTemplate {
  switch (kind) {
    case 'frame': {
      const preset = DESIGN_FRAME_PRESETS.find(item => item.id === presetId) ?? DESIGN_FRAME_PRESETS[0];
      return {
        kind,
        title: '画板 · ' + preset.label,
        width: preset.width,
        height: preset.height,
        design: {
          kind,
          fill: { type: 'solid', color: '#FFFFFF' },
          stroke: { color: '#D0D5DD', width: 1 },
          frame: { preset: preset.id, clip: true, childIds: [] },
        },
      };
    }
    case 'rect':
      return { kind, title: '矩形', width: 240, height: 160, design: { kind, fill: { type: 'solid', color: ACCENT }, cornerRadius: 12 } };
    case 'ellipse':
      return { kind, title: '椭圆', width: 200, height: 200, design: { kind, fill: { type: 'solid', color: ACCENT } } };
    case 'text':
      return {
        kind,
        title: '文字',
        width: 320,
        height: 80,
        design: {
          kind,
          fill: { type: 'none' },
          text: { runs: [{ text: '双击编辑文字' }], style: { ...DEFAULT_TEXT_STYLE } },
        },
      };
    case 'path':
      return {
        kind,
        title: '钢笔路径',
        width: 240,
        height: 160,
        design: {
          kind,
          fill: { type: 'none' },
          stroke: { color: '#111111', width: 3, lineCap: 'round', lineJoin: 'round' },
          path: { d: 'M0 50 C25 0 75 100 100 50', viewBox: { x: 0, y: 0, width: 100, height: 100 }, closed: false },
        },
      };
  }
}
