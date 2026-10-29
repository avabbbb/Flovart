import { DEFAULT_TEXT_STYLE, type DesignElement, type DesignStroke, type DesignText, type DesignTextRun } from './designTypes';
import { fillToSvg } from './gradient';
import { clamp01, escapeXml, fmt } from './svgUtils';

export interface DesignRenderOptions {
  /** 渐变 id 前缀；同一文档内多个元素必须不同。 */
  idPrefix?: string;
  /** true 时 svg 宽高写成 100%，交给容器决定显示尺寸（画布节点用）；导出/栅格化用 false。 */
  fluid?: boolean;
}

/** 文字首行基线相对行顶的比例（近似 ascent）。 */
const BASELINE_RATIO = 0.8;

function strokeAttrs(stroke: DesignStroke | undefined): string {
  if (!stroke || stroke.width <= 0) return '';
  const opacity = clamp01(stroke.opacity);
  return [
    ` stroke="${escapeXml(stroke.color)}" stroke-width="${fmt(stroke.width)}"`,
    opacity < 1 ? ` stroke-opacity="${fmt(opacity)}"` : '',
    stroke.dash?.length ? ` stroke-dasharray="${stroke.dash.map(fmt).join(' ')}"` : '',
    stroke.lineJoin ? ` stroke-linejoin="${stroke.lineJoin}"` : '',
    stroke.lineCap ? ` stroke-linecap="${stroke.lineCap}"` : '',
  ].join('');
}

/** 把 runs 按显式换行拆成行；空行保留一个空片段以占位行高。 */
export function splitTextLines(runs: readonly DesignTextRun[]): DesignTextRun[][] {
  const lines: DesignTextRun[][] = [[]];
  for (const run of runs) {
    run.text.split('\n').forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ ...run, text: part });
    });
  }
  return lines.map(line => (line.length ? line : [{ text: '' }]));
}

function textToSvg(text: DesignText, width: number): string {
  const style = { ...DEFAULT_TEXT_STYLE, ...text.style };
  const anchor = style.align === 'center' ? 'middle' : style.align === 'right' ? 'end' : 'start';
  const x = style.align === 'center' ? width / 2 : style.align === 'right' ? width : 0;
  let top = 0;
  return splitTextLines(text.runs).map(line => {
    const size = Math.max(...line.map(run => run.fontSize ?? style.fontSize));
    const baseline = top + size * BASELINE_RATIO + (size * (style.lineHeight - 1)) / 2;
    top += size * style.lineHeight;
    const spans = line.map(run => {
      const attrs = [
        run.fontFamily ? ` font-family="${escapeXml(run.fontFamily)}"` : '',
        run.fontSize ? ` font-size="${fmt(run.fontSize)}"` : '',
        run.fontWeight ? ` font-weight="${fmt(run.fontWeight)}"` : '',
        run.italic ? ' font-style="italic"' : '',
        run.underline ? ' text-decoration="underline"' : '',
        run.color ? ` fill="${escapeXml(run.color)}"` : '',
        run.letterSpacing !== undefined ? ` letter-spacing="${fmt(run.letterSpacing)}"` : '',
      ].join('');
      return `<tspan${attrs}>${escapeXml(run.text)}</tspan>`;
    }).join('');
    return `<text x="${fmt(x)}" y="${fmt(baseline)}" text-anchor="${anchor}" xml:space="preserve">${spans}</text>`;
  }).join('');
}

function textGroupAttrs(text: DesignText): string {
  const style = { ...DEFAULT_TEXT_STYLE, ...text.style };
  return ` font-family="${escapeXml(style.fontFamily)}" font-size="${fmt(style.fontSize)}" font-weight="${fmt(style.fontWeight)}"`
    + ` fill="${escapeXml(style.color)}"${style.letterSpacing ? ` letter-spacing="${fmt(style.letterSpacing)}"` : ''}${style.italic ? ' font-style="italic"' : ''}`;
}

/** 把一个设计元素渲染成独立 SVG 文档；所有属性值都已转义，可直接作为 innerHTML 或 data URL。 */
export function renderDesignSvg(element: DesignElement, width: number, height: number, options: DesignRenderOptions = {}): string {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const fill = fillToSvg(element.fill, `${options.idPrefix ?? 'design'}-fill`);
  const fillAttrs = ` fill="${fill.paint}"${fill.opacity !== undefined ? ` fill-opacity="${fmt(fill.opacity)}"` : ''}`;
  const stroke = strokeAttrs(element.stroke);
  const inset = element.stroke && element.stroke.width > 0 ? element.stroke.width / 2 : 0;
  const radius = Math.max(0, Math.min(element.cornerRadius ?? 0, w / 2, h / 2));
  let body = '';
  switch (element.kind) {
    case 'frame':
    case 'rect':
      body = `<rect x="${fmt(inset)}" y="${fmt(inset)}" width="${fmt(Math.max(0, w - inset * 2))}" height="${fmt(Math.max(0, h - inset * 2))}"${radius ? ` rx="${fmt(radius)}"` : ''}${fillAttrs}${stroke}/>`;
      break;
    case 'ellipse':
      body = `<ellipse cx="${fmt(w / 2)}" cy="${fmt(h / 2)}" rx="${fmt(Math.max(0, w / 2 - inset))}" ry="${fmt(Math.max(0, h / 2 - inset))}"${fillAttrs}${stroke}/>`;
      break;
    case 'path': {
      const path = element.path;
      if (!path || !path.d) break;
      const sx = w / Math.max(1e-6, path.viewBox.width);
      const sy = h / Math.max(1e-6, path.viewBox.height);
      const pathFill = path.closed ? fillAttrs : ' fill="none"';
      body = `<path d="${escapeXml(path.d)}" transform="matrix(${fmt(sx)} 0 0 ${fmt(sy)} ${fmt(-path.viewBox.x * sx)} ${fmt(-path.viewBox.y * sy)})"`
        + `${path.fillRule ? ` fill-rule="${path.fillRule}"` : ''}${pathFill}${stroke} vector-effect="non-scaling-stroke"/>`;
      break;
    }
    case 'text': {
      const background = fill.paint === 'none' ? '' : `<rect width="${fmt(w)}" height="${fmt(h)}"${radius ? ` rx="${fmt(radius)}"` : ''}${fillAttrs}/>`;
      body = element.text ? `${background}<g${textGroupAttrs(element.text)}>${textToSvg(element.text, w)}</g>` : background;
      break;
    }
  }
  const opacity = clamp01(element.opacity);
  const size = options.fluid ? 'width="100%" height="100%" preserveAspectRatio="none"' : `width="${fmt(w)}" height="${fmt(h)}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${fmt(w)} ${fmt(h)}"${opacity < 1 ? ` opacity="${fmt(opacity)}"` : ''}>`
    + `${fill.defs ? `<defs>${fill.defs}</defs>` : ''}${body}</svg>`;
}

export function designSvgDataUrl(element: DesignElement, width: number, height: number): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderDesignSvg(element, width, height))}`;
}
