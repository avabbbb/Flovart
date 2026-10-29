import { saveBlob } from '../../services/desktopNetwork';
import { sanitizeMediaFileStem } from '../../utils/batchMediaExport';
import { loadWorkflowMediaBlob } from './media';
import type { WorkflowNode } from './types';

export type WorkflowCanvasExportFormat = 'png' | 'pdf';

export interface WorkflowCanvasExportOptions {
  // 像素倍率，默认 2；超出像素上限时自动降低。
  scale?: number;
  padding?: number;
  background?: string;
  maxPixels?: number;
}

export interface WorkflowExportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_SIDE = 16384;
const DEFAULT_MAX_PIXELS = 40_000_000;
const CARD_RADIUS = 12;
const FONT_STACK = 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

// 有选区时只导出选中的可见节点，否则导出全部可见节点（保持图层顺序）。
export function pickWorkflowExportNodes(nodes: WorkflowNode[], selectedIds: readonly string[] = []): WorkflowNode[] {
  const visible = nodes.filter(node => node.isVisible !== false);
  if (!selectedIds.length) return visible;
  const selected = new Set(selectedIds);
  const picked = visible.filter(node => selected.has(node.id));
  return picked.length ? picked : visible;
}

export function workflowExportBounds(nodes: WorkflowNode[], padding = 32): WorkflowExportBounds | null {
  if (!nodes.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.position.x);
    top = Math.min(top, node.position.y);
    right = Math.max(right, node.position.x + Math.max(1, node.width));
    bottom = Math.max(bottom, node.position.y + Math.max(1, node.height));
  }
  return { x: left - padding, y: top - padding, width: right - left + padding * 2, height: bottom - top + padding * 2 };
}

// 限制导出画布的总像素与单边长度，避免浏览器创建超大 canvas 失败。
export function clampExportScale(bounds: WorkflowExportBounds, scale = 2, maxPixels = DEFAULT_MAX_PIXELS): number {
  const byArea = Math.sqrt(maxPixels / Math.max(1, bounds.width * bounds.height));
  const bySide = MAX_SIDE / Math.max(1, bounds.width, bounds.height);
  return Math.max(0.05, Math.min(scale, byArea, bySide));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>();
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('图片加载失败'));
  image.src = src;
  return promise;
}

async function loadNodeImage(node: WorkflowNode): Promise<HTMLImageElement | null> {
  if (node.type !== 'image') return null;
  const { storageKey, href, artifactRef } = node.metadata;
  if (!storageKey && !href && !artifactRef) return null;
  try {
    const blob = await loadWorkflowMediaBlob(storageKey, href, artifactRef);
    const url = URL.createObjectURL(blob);
    try {
      return await loadImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawContain(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const iw = image.naturalWidth || 1;
  const ih = image.naturalHeight || 1;
  const fit = Math.min(w / iw, h / ih);
  const dw = iw * fit;
  const dh = ih * fit;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// 逐字换行，兼顾中文无空格文本。
export function wrapCanvasText(measure: (text: string) => number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const char of Array.from(paragraph)) {
      const next = line + char;
      if (line && measure(next) > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawNodeText(ctx: CanvasRenderingContext2D, node: WorkflowNode, x: number, y: number, w: number, h: number) {
  const inset = 14;
  const maxWidth = Math.max(10, w - inset - inset);
  const measure = (text: string) => ctx.measureText(text).width;
  ctx.fillStyle = '#14181f';
  ctx.textBaseline = 'top';
  ctx.font = '600 14px ' + FONT_STACK;
  const title = wrapCanvasText(measure, node.title || node.type, maxWidth)[0] || '';
  ctx.fillText(title, x + inset, y + inset);
  const body = (node.metadata.content || node.metadata.prompt || '').trim();
  if (!body) return;
  ctx.fillStyle = '#4b5563';
  ctx.font = '12px ' + FONT_STACK;
  const lineHeight = 18;
  let cursor = y + inset + 26;
  for (const line of wrapCanvasText(measure, body, maxWidth)) {
    if (cursor + lineHeight > y + h - inset) break;
    ctx.fillText(line, x + inset, cursor);
    cursor += lineHeight;
  }
}

export async function renderWorkflowCanvas(nodes: WorkflowNode[], options: WorkflowCanvasExportOptions = {}) {
  const bounds = workflowExportBounds(nodes, options.padding ?? 32);
  if (!bounds) throw new Error('画布中没有可导出的内容');
  const scale = clampExportScale(bounds, options.scale ?? 2, options.maxPixels ?? DEFAULT_MAX_PIXELS);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bounds.width * scale));
  canvas.height = Math.max(1, Math.round(bounds.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器无法创建画布');
  ctx.fillStyle = options.background ?? '#f6f7f9';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(-bounds.x, -bounds.y);
  const images = await Promise.all(nodes.map(loadNodeImage));
  nodes.forEach((node, index) => {
    const { x, y } = node.position;
    const w = Math.max(1, node.width);
    const h = Math.max(1, node.height);
    const image = images[index];
    ctx.save();
    roundedRect(ctx, x, y, w, h, CARD_RADIUS);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.clip();
    if (image) drawContain(ctx, image, x, y, w, h);
    else drawNodeText(ctx, node, x, y, w, h);
    ctx.restore();
    ctx.save();
    roundedRect(ctx, x, y, w, h, CARD_RADIUS);
    ctx.strokeStyle = 'rgba(20, 24, 31, 0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  });
  return { canvas, bounds, scale };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('画布导出失败'))), type, quality);
  return promise;
}

// 无依赖单页 PDF：把一张 JPEG 以 DCTDecode 直接嵌入，页面尺寸以 pt 计。
// 参考 ComfyArt ExportDialog 的最小实现，避免引入 jspdf/pdf-lib 等大依赖。
export function pdfFromJpeg(jpeg: Uint8Array, pixelWidth: number, pixelHeight: number, pageWidth = pixelWidth, pageHeight = pixelHeight): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const nl = String.fromCharCode(10);
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (id: number, body: string) => {
    offsets[id] = length;
    push(id + ' 0 obj' + nl + body + nl + 'endobj' + nl);
  };
  const pw = Math.max(1, Math.round(pageWidth * 100) / 100);
  const ph = Math.max(1, Math.round(pageHeight * 100) / 100);
  const iw = Math.max(1, Math.round(pixelWidth));
  const ih = Math.max(1, Math.round(pixelHeight));
  push('%PDF-1.4' + nl);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
  offsets[4] = length;
  push('4 0 obj' + nl + '<< /Type /XObject /Subtype /Image /Width ' + iw + ' /Height ' + ih + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>' + nl + 'stream' + nl);
  push(jpeg);
  push(nl + 'endstream' + nl + 'endobj' + nl);
  const content = 'q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im0 Do Q';
  obj(5, '<< /Length ' + content.length + ' >>' + nl + 'stream' + nl + content + nl + 'endstream');
  const xref = length;
  const rows = [1, 2, 3, 4, 5].map(id => String(offsets[id]).padStart(10, '0') + ' 00000 n ' + nl).join('');
  push('xref' + nl + '0 6' + nl + '0000000000 65535 f ' + nl + rows);
  push('trailer' + nl + '<< /Size 6 /Root 1 0 R >>' + nl + 'startxref' + nl + xref + nl + '%%EOF');
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

// 渲染并保存；PNG 保留画布像素，PDF 按 1 CSS px = 0.75pt 映射页面尺寸。返回用户是否完成保存。
export async function exportWorkflowCanvas(
  nodes: WorkflowNode[],
  format: WorkflowCanvasExportFormat,
  fileStem: string,
  options: WorkflowCanvasExportOptions = {},
): Promise<boolean> {
  const { canvas, bounds } = await renderWorkflowCanvas(nodes, options);
  const stem = sanitizeMediaFileStem(fileStem, 'Flovart-画布');
  if (format === 'pdf') {
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    const pdf = pdfFromJpeg(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height, bounds.width * 0.75, bounds.height * 0.75);
    return saveBlob(pdf, stem + '.pdf');
  }
  const png = await canvasToBlob(canvas, 'image/png');
  return saveBlob(png, stem + '.png');
}
