// 纯前端 Canvas 图像变换：旋转 / 镜像
// 无需 AI，零网络成本

export type RotateAction = 'rotate-90' | 'rotate-180' | 'rotate-270' | 'flip-h' | 'flip-v';

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

export async function transformImage(src: string, action: RotateAction): Promise<Blob> {
  const img = await loadImage(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');

  if (action === 'rotate-90' || action === 'rotate-270') {
    canvas.width = h;
    canvas.height = w;
  } else {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context 不可用');

  switch (action) {
    case 'rotate-90':
      ctx.translate(h, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0);
      break;
    case 'rotate-180':
      ctx.translate(w, h);
      ctx.rotate(Math.PI);
      ctx.drawImage(img, 0, 0);
      break;
    case 'rotate-270':
      ctx.translate(0, w);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, 0, 0);
      break;
    case 'flip-h':
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
      break;
    case 'flip-v':
      ctx.translate(0, h);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, 0);
      break;
  }

  return canvasToBlob(canvas);
}
