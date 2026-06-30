// 纯前端 Canvas 宫格切分：将拼图切分为独立子图
// 例如九宫格拼图 → 9 张独立图片

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas 导出失败')), type);
  });
}

export interface SplitGridResult {
  blob: Blob;
  row: number;
  col: number;
  index: number;
}

export async function splitGrid(src: string, rows: number, cols: number): Promise<SplitGridResult[]> {
  const img = await loadImage(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cellW = Math.floor(w / cols);
  const cellH = Math.floor(h / rows);
  const results: SplitGridResult[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const canvas = document.createElement('canvas');
      canvas.width = cellW;
      canvas.height = cellH;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(img, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);
      const blob = await canvasToBlob(canvas);
      results.push({ blob, row, col, index: row * cols + col });
    }
  }

  return results;
}
