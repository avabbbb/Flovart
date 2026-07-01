
const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus',
};

export function detectMediaType(file: Pick<File, 'name' | 'type'>): 'image' | 'video' | 'audio' | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const mime = MIME_BY_EXTENSION[ext];
  if (!mime) return null;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

export function resolveMimeType(file: Pick<File, 'name' | 'type'>): string {
  if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return MIME_BY_EXTENSION[ext] || file.type;
}

export const fileToDataUrl = (file: File): Promise<{ dataUrl: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve({ dataUrl: reader.result, mimeType: file.type });
            } else {
                reject(new Error('Failed to read file as a data URL.'));
            }
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
};

export const dataUrlToImage = (dataUrl: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = dataUrl;
    });
};

/** 图片文件大小上限 (bytes) — 20 MB */
export const IMAGE_MAX_FILE_SIZE = 20 * 1024 * 1024;
/** 图片单边像素上限 — 超过此值自动缩小 */
export const IMAGE_MAX_DIMENSION = 4096;
/** 自动压缩时的 JPEG 画质 */
export const IMAGE_COMPRESS_QUALITY = 0.85;

/**
 * 校验并压缩图片：
 *  1. 文件体积 > IMAGE_MAX_FILE_SIZE → 直接拒绝
 *  2. 任意一边 > IMAGE_MAX_DIMENSION → 等比缩小后重新编码
 * 返回最终的 dataUrl / 尺寸 / mimeType，并附带 resized 标记
 */
export const validateAndResizeImage = async (
    file: File,
): Promise<{ dataUrl: string; mimeType: string; width: number; height: number; resized: boolean }> => {
    if (file.size > IMAGE_MAX_FILE_SIZE) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        throw new Error(`图片文件过大 (${sizeMB} MB)，上限为 ${IMAGE_MAX_FILE_SIZE / 1024 / 1024} MB。请先缩小图片再试。`);
    }

    const { dataUrl, mimeType } = await fileToDataUrl(file);
    const img = await dataUrlToImage(dataUrl);

    if (img.width === 0 || img.height === 0) {
        throw new Error('图片尺寸无效（宽度或高度为 0），请选择有效的图片文件。');
    }

    const needsResize = img.width > IMAGE_MAX_DIMENSION || img.height > IMAGE_MAX_DIMENSION;

    if (!needsResize) {
        return { dataUrl, mimeType, width: img.width, height: img.height, resized: false };
    }

    // 等比缩小到 IMAGE_MAX_DIMENSION 以内
    const scale = Math.min(IMAGE_MAX_DIMENSION / img.width, IMAGE_MAX_DIMENSION / img.height);
    const newW = Math.round(img.width * scale);
    const newH = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 canvas 上下文来压缩图片。');
    ctx.drawImage(img, 0, 0, newW, newH);

    const outMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    const outDataUrl = canvas.toDataURL(outMime, IMAGE_COMPRESS_QUALITY);
    return { dataUrl: outDataUrl, mimeType: outMime, width: newW, height: newH, resized: true };
};

export const downloadDataUrl = (dataUrl: string, filename: string) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};
