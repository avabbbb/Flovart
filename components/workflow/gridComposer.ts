import { loadWorkflowMediaBlob } from './media';

export interface GridComposerSource {
  storageKey?: string;
  href?: string;
}

export interface GridComposerOptions {
  cols: number;
  cellWidth?: number;
  cellHeight?: number;
  gap?: number;
  padding?: number;
  background?: string;
  labels?: string[];
  labelColor?: string;
  labelBackground?: string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = src;
  });
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const drawW = image.naturalWidth * scale;
  const drawH = image.naturalHeight * scale;
  context.drawImage(image, x + (w - drawW) / 2, y + (h - drawH) / 2, drawW, drawH);
}

export async function composeImageGrid(
  sources: GridComposerSource[],
  options: GridComposerOptions,
): Promise<Blob> {
  const cols = options.cols;
  const cellW = options.cellWidth ?? 512;
  const cellH = options.cellHeight ?? 512;
  const gap = options.gap ?? 8;
  const padding = options.padding ?? 12;
  const background = options.background ?? '#1a1a2e';
  const labels = options.labels;
  const labelColor = options.labelColor ?? '#ffffff';
  const labelBg = options.labelBackground ?? 'rgba(0,0,0,0.6)';

  const validSources = sources.filter(s => s.storageKey || s.href);
  if (validSources.length === 0) throw new Error('没有可拼接的图片');

  const rows = Math.ceil(validSources.length / cols);
  const canvasW = padding * 2 + cols * cellW + (cols - 1) * gap;
  const canvasH = padding * 2 + rows * cellH + (rows - 1) * gap;

  const blobs = await Promise.all(
    validSources.map(s => loadWorkflowMediaBlob(s.storageKey, s.href).catch(() => null)),
  );

  const images: (HTMLImageElement | null)[] = await Promise.all(
    blobs.map(async blob => {
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      try {
        return await loadImage(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }),
  );

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法创建画布');

  context.fillStyle = background;
  context.fillRect(0, 0, canvasW, canvasH);

  images.forEach((image, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = padding + col * (cellW + gap);
    const y = padding + row * (cellH + gap);

    if (image) {
      drawCover(context, image, x, y, cellW, cellH);
    } else {
      context.fillStyle = '#2a2a3e';
      context.fillRect(x, y, cellW, cellH);
    }

    if (labels && labels[index]) {
      const label = labels[index];
      context.font = 'bold 16px sans-serif';
      const metrics = context.measureText(label);
      const labelW = metrics.width + 14;
      const labelH = 24;
      context.fillStyle = labelBg;
      context.fillRect(x + 6, y + 6, labelW, labelH);
      context.fillStyle = labelColor;
      context.fillText(label, x + 13, y + 22);
    }
  });

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(result => result ? resolve(result) : reject(new Error('网格拼图生成失败')), 'image/png');
  });
}
