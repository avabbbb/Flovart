import ImageTracer, { type ImageTracerImageData, type ImageTracerOptions } from 'imagetracerjs';

export type VectorizePreset = 'detailed' | 'poster' | 'line';

export const VECTORIZE_PRESET_LABELS: Record<VectorizePreset, string> = { detailed: '细节', poster: '色块', line: '线稿' };

const PRESET_OPTIONS: Record<VectorizePreset, ImageTracerOptions> = {
  detailed: { numberofcolors: 16, ltres: 0.5, qtres: 0.5, pathomit: 4, roundcoords: 1 },
  poster: { numberofcolors: 6, blurradius: 2, blurdelta: 20, pathomit: 16, roundcoords: 1 },
  line: { numberofcolors: 2, colorquantcycles: 1, pathomit: 8, roundcoords: 1 },
};

// 描摹是同步 CPU 计算，长边上限控制主线程阻塞时长。
export const VECTORIZE_MAX_EDGE = 1024;

export function traceImageDataToSvg(imageData: ImageTracerImageData, preset: VectorizePreset): string {
  // viewbox 模式不写 width/height，<img> 会退回 300x150；补上原始尺寸，节点导入才能拿到正确宽高。
  const svg = ImageTracer.imagedataToSVG(imageData, { ...PRESET_OPTIONS[preset], viewbox: true });
  return svg.replace(/^<svg /, '<svg width="' + imageData.width + '" height="' + imageData.height + '" ');
}

export async function vectorizeImageBlob(blob: Blob, preset: VectorizePreset, maxEdge = VECTORIZE_MAX_EDGE): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器不支持 Canvas 2D，无法矢量化');
    context.drawImage(bitmap, 0, 0, width, height);
    const svg = traceImageDataToSvg(context.getImageData(0, 0, width, height), preset);
    return new Blob([svg], { type: 'image/svg+xml' });
  } finally {
    bitmap.close();
  }
}
