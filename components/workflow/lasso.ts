export type LassoPoint = { x: number; y: number };
export type LassoFit = 'contain' | 'cover' | 'fill';

export function traceLasso(context: CanvasRenderingContext2D, points: readonly LassoPoint[], close: boolean) {
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
  if (close) context.closePath();
}

// 追加套索点；与上一点距离小于 minDistance（原图像素）时丢弃，避免高频 pointermove 堆积。
export function appendLassoPoint(points: LassoPoint[], next: LassoPoint, minDistance = 4): LassoPoint[] {
  const last = points[points.length - 1];
  return last && Math.hypot(next.x - last.x, next.y - last.y) < minDistance ? points : [...points, next];
}

// 显示坐标转原图坐标。fit 与媒体元素的 object-fit 一致；结果钳制在原图范围内。
export function toLassoPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
  fit: LassoFit = 'contain',
): LassoPoint {
  const clampX = (value: number) => Math.max(0, Math.min(width, value));
  const clampY = (value: number) => Math.max(0, Math.min(height, value));
  if (fit === 'fill' || rect.width <= 0 || rect.height <= 0) {
    return { x: clampX((clientX - rect.left) / ((rect.width || 1) / width)), y: clampY((clientY - rect.top) / ((rect.height || 1) / height)) };
  }
  // inv = 原图像素 / 显示像素；contain 取较大比例，cover 取较小比例。
  const inv = fit === 'contain' ? Math.max(width / rect.width, height / rect.height) : Math.min(width / rect.width, height / rect.height);
  const offsetX = (rect.width - width / inv) / 2;
  const offsetY = (rect.height - height / inv) / 2;
  return { x: clampX((clientX - rect.left - offsetX) / (1 / inv)), y: clampY((clientY - rect.top - offsetY) / (1 / inv)) };
}

export function drawLassoPreview(context: CanvasRenderingContext2D, points: readonly LassoPoint[], closed: boolean) {
  const { canvas } = context;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (points.length < 2) return;
  traceLasso(context, points, closed);
  if (closed) { context.fillStyle = 'rgba(255, 196, 0, .2)'; context.fill(); }
  context.strokeStyle = '#ffc400';
  context.lineWidth = Math.max(2, canvas.width / 320);
  context.setLineDash([12, 8]);
  context.stroke();
}

// 与 MaskDialog 同约定：不透明白底，圈内透明。少于 3 点返回 undefined，表示作用于整张图。
export function buildLassoMaskDataUrl(points: readonly LassoPoint[], width: number, height: number): string | undefined {
  if (points.length < 3 || width <= 0 || height <= 0) return undefined;
  const mask = document.createElement('canvas');
  mask.width = width;
  mask.height = height;
  const context = mask.getContext('2d');
  if (!context) return undefined;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = 'destination-out';
  traceLasso(context, points, true);
  context.fill();
  return mask.toDataURL('image/png');
}
