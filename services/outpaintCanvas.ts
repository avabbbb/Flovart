export type OutpaintDirection = 'left' | 'right' | 'top' | 'bottom' | 'all';

export interface OutpaintLayout {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  sourceWidth: number;
  sourceHeight: number;
}

// 扩图几何：按方向把画布扩展 amount 倍原边长（四周时两侧各分一半），超过 maxEdge 时等比缩小。
export function computeOutpaintLayout(sourceWidth: number, sourceHeight: number, direction: OutpaintDirection, amount: number, maxEdge = 4096): OutpaintLayout {
  const extraX = direction === 'top' || direction === 'bottom' ? 0 : Math.round(sourceWidth * amount);
  const extraY = direction === 'left' || direction === 'right' ? 0 : Math.round(sourceHeight * amount);
  const offsetX = direction === 'left' ? extraX : direction === 'all' ? Math.round(extraX / 2) : 0;
  const offsetY = direction === 'top' ? extraY : direction === 'all' ? Math.round(extraY / 2) : 0;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth + extraX, sourceHeight + extraY));
  return {
    width: Math.round((sourceWidth + extraX) * scale),
    height: Math.round((sourceHeight + extraY) * scale),
    offsetX: Math.round(offsetX * scale),
    offsetY: Math.round(offsetY * scale),
    sourceWidth: Math.round(sourceWidth * scale),
    sourceHeight: Math.round(sourceHeight * scale),
  };
}

// 蒴版约定与 MaskDialog 一致：原图区域白色不透明（保留），新区域透明（重绘）。
// 与新区域相邻的边向内收 FEATHER 像素，让模型把接缝一起融合。
const FEATHER = 12;

export async function buildOutpaintCanvas(source: Blob, direction: OutpaintDirection, amount: number) {
  const bitmap = await createImageBitmap(source);
  try {
    const layout = computeOutpaintLayout(bitmap.width, bitmap.height, direction, amount);
    const inset = Math.min(FEATHER, Math.floor(Math.min(layout.sourceWidth, layout.sourceHeight) / 8));
    const left = layout.offsetX > 0 ? inset : 0;
    const top = layout.offsetY > 0 ? inset : 0;
    const right = layout.offsetX + layout.sourceWidth < layout.width ? inset : 0;
    const bottom = layout.offsetY + layout.sourceHeight < layout.height ? inset : 0;
    const painters: Array<(context: CanvasRenderingContext2D) => void> = [
      context => context.drawImage(bitmap, layout.offsetX, layout.offsetY, layout.sourceWidth, layout.sourceHeight),
      context => {
        context.fillStyle = '#fff';
        context.fillRect(layout.offsetX + left, layout.offsetY + top, layout.sourceWidth - left - right, layout.sourceHeight - top - bottom);
      },
    ];
    const [image, mask] = await Promise.all(painters.map(paint => new Promise<Blob>((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = layout.width;
      canvas.height = layout.height;
      const context = canvas.getContext('2d');
      if (!context) { reject(new Error('浏览器不支持 Canvas 2D')); return; }
      paint(context);
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('扩图画布导出失败'))), 'image/png');
    })));
    return { image, mask, layout };
  } finally {
    bitmap.close();
  }
}
