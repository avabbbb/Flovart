// 设计元素（P3）的数据模型：画板、矩形、椭圆、文字、钢笔路径。
// 节点宽高即元素尺寸；path 通过 viewBox 缩放到节点尺寸。

export type DesignElementKind = 'frame' | 'rect' | 'ellipse' | 'text' | 'path';

export interface DesignGradientStop {
  /** 0..1 */
  offset: number;
  color: string;
  /** 0..1，缺省 1 */
  opacity?: number;
}

export type DesignFill =
  | { type: 'none' }
  | { type: 'solid'; color: string; opacity?: number }
  /** angle 按 CSS 约定：0deg 指向上方，90deg 指向右方。 */
  | { type: 'linear'; angle: number; stops: DesignGradientStop[] }
  /** cx/cy/r 为相对元素包围盒的比例，缺省 0.5/0.5/0.5。 */
  | { type: 'radial'; cx?: number; cy?: number; r?: number; stops: DesignGradientStop[] };

export interface DesignStroke {
  color: string;
  width: number;
  opacity?: number;
  dash?: number[];
  lineJoin?: 'miter' | 'round' | 'bevel';
  lineCap?: 'butt' | 'round' | 'square';
}

export type DesignTextAlign = 'left' | 'center' | 'right';

export interface DesignTextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** 行高倍数 */
  lineHeight: number;
  letterSpacing: number;
  align: DesignTextAlign;
  color: string;
  italic?: boolean;
}

/** 富文本片段；未指定的字段继承 DesignTextStyle。文本中的 \n 为显式换行。 */
export interface DesignTextRun {
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  letterSpacing?: number;
}

export interface DesignText {
  runs: DesignTextRun[];
  style: DesignTextStyle;
}

export interface DesignViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignPath {
  d: string;
  viewBox: DesignViewBox;
  closed: boolean;
  fillRule?: 'nonzero' | 'evenodd';
}

export interface DesignPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DesignAutoLayout {
  direction: 'horizontal' | 'vertical';
  gap: number;
  padding: DesignPadding;
  /** 交叉轴对齐 */
  align: 'start' | 'center' | 'end' | 'stretch';
  /** 主轴分布 */
  justify: 'start' | 'center' | 'end' | 'space-between';
  /** hug：画板随内容收缩；fixed：画板尺寸不变 */
  sizing: 'hug' | 'fixed';
}

export interface DesignFrame {
  /** 画板预设 id，如 'phone' / 'a4' / 'square' */
  preset?: string;
  clip: boolean;
  childIds: string[];
  autoLayout?: DesignAutoLayout;
}

export interface DesignElement {
  kind: DesignElementKind;
  fill: DesignFill;
  stroke?: DesignStroke;
  cornerRadius?: number;
  /** 0..1 */
  opacity?: number;
  text?: DesignText;
  path?: DesignPath;
  frame?: DesignFrame;
}

export interface DesignFramePreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const DESIGN_FRAME_PRESETS: DesignFramePreset[] = [
  { id: 'phone', label: '手机 390×844', width: 390, height: 844 },
  { id: 'tablet', label: '平板 834×1194', width: 834, height: 1194 },
  { id: 'desktop', label: '桌面 1440×900', width: 1440, height: 900 },
  { id: 'square', label: '方图 1080×1080', width: 1080, height: 1080 },
  { id: 'story', label: '竖版海报 1080×1920', width: 1080, height: 1920 },
  { id: 'xiaohongshu', label: '小红书 1242×1660', width: 1242, height: 1660 },
  { id: 'banner', label: '横幅 1920×1080', width: 1920, height: 1080 },
  { id: 'a4', label: 'A4 794×1123', width: 794, height: 1123 },
];

export const DEFAULT_TEXT_STYLE: DesignTextStyle = {
  fontFamily: 'Inter',
  fontSize: 32,
  fontWeight: 400,
  lineHeight: 1.3,
  letterSpacing: 0,
  align: 'left',
  color: '#111111',
};
