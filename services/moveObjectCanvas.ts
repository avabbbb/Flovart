export interface NormalizedPoint { x: number; y: number }

export interface NormalizedBounds { minX: number; minY: number; maxX: number; maxY: number }

export function polygonBounds(points: readonly NormalizedPoint[]): NormalizedBounds {
  let minX = 1; let minY = 1; let maxX = 0; let maxY = 0;
  for (const point of points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

// 位移限制在画面内：选区包围盒移动后不越出 [0, 1]。
export function clampMoveOffset(points: readonly NormalizedPoint[], dx: number, dy: number) {
  const bounds = polygonBounds(points);
  return {
    dx: Math.min(Math.max(dx, -bounds.minX), 1 - bounds.maxX),
    dy: Math.min(Math.max(dy, -bounds.minY), 1 - bounds.maxY),
  };
}

export function tracePolygon(context: CanvasRenderingContext2D, points: readonly NormalizedPoint[], width: number, height: number, dx = 0, dy = 0) {
  context.beginPath();
  points.forEach((point, index) => {
    const x = (point.x + dx) * width;
    const y = (point.y + dy) * height;
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.closePath();
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('移动物体画布导出失败')), 'image/png'));
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持 Canvas 2D，无法移动物体');
  return { canvas, context };
}

/**
 * 生成移动物体的重绘输入：
 * image：原图上把选区像素贴到新位置（原位置保留，交给模型补背景）；
 * mask：白色保留，透明为重绘区，包括原选区整体与新位置边缘一圈（用于融合阴影和接缝）。
 */
export async function buildMoveObjectCanvas(blob: Blob, points: readonly NormalizedPoint[], dx: number, dy: number, edgeRatio = 0.02) {
  if (points.length < 3) throw new Error('请先圈选要移动的物体');
  const offset = clampMoveOffset(points, dx, dy);
  const bitmap = await createImageBitmap(blob);
  try {
    const width = bitmap.width;
    const height = bitmap.height;
    const image = createCanvas(width, height);
    image.context.drawImage(bitmap, 0, 0);
    const cut = createCanvas(width, height);
    tracePolygon(cut.context, points, width, height);
    cut.context.clip();
    cut.context.drawImage(bitmap, 0, 0);
    image.context.drawImage(cut.canvas, offset.dx * width, offset.dy * height);

    const mask = createCanvas(width, height);
    mask.context.fillStyle = '#fff';
    mask.context.fillRect(0, 0, width, height);
    mask.context.globalCompositeOperation = 'destination-out';
    mask.context.lineJoin = 'round';
    mask.context.lineWidth = Math.max(8, Math.round(edgeRatio * Math.max(width, height)));
    tracePolygon(mask.context, points, width, height);
    mask.context.fill();
    mask.context.stroke();
    tracePolygon(mask.context, points, width, height, offset.dx, offset.dy);
    mask.context.stroke();

    return { image: await canvasBlob(image.canvas), mask: await canvasBlob(mask.canvas), width, height, offset };
  } finally {
    bitmap.close();
  }
}
