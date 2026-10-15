import { BlobReader, BlobWriter, ZipWriter } from '@zip.js/zip.js';

export interface PositionedMediaSource {
  id: string;
  x: number;
  y: number;
  name?: string;
  mimeType?: string;
  loadBlob: () => Promise<Blob>;
}

export interface OrderedMediaFile extends PositionedMediaSource {
  fileName: string;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
};

function extensionFor(mimeType = '') {
  if (MIME_EXTENSIONS[mimeType]) return MIME_EXTENSIONS[mimeType];
  const subtype = mimeType.split('/')[1]?.split(/[;+]/)[0].toLowerCase();
  return subtype && /^[a-z0-9]{1,8}$/.test(subtype) ? subtype : 'bin';
}

export function sanitizeMediaFileStem(value: string | undefined, fallback: string) {
  const normalized = (value || '').normalize('NFKC').replace(/\.[a-z0-9]{1,8}$/i, '');
  const safe = normalized
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/[\s_]+/g, '_')
    .replace(/^[\s._-]+|[\s._-]+$/g, '')
    .slice(0, 80);
  return safe || fallback;
}

export function prepareOrderedMediaFiles(sources: PositionedMediaSource[], projectName?: string): OrderedMediaFile[] {
  const ordered = [...sources].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id, 'zh-CN'));
  const digits = Math.max(3, String(ordered.length).length);
  const safeProject = projectName ? sanitizeMediaFileStem(projectName, 'Flovart') : undefined;
  return ordered.map((source, index) => {
    const ext = extensionFor(source.mimeType);
    const safeName = sanitizeMediaFileStem(source.name, '媒体');
    const seq = String(index + 1).padStart(digits, '0');
    const fileName = safeProject
      ? `${safeProject}_${safeName}_${seq}.${ext}`
      : `${seq}_${safeName}.${ext}`;
    return { ...source, fileName };
  });
}

export async function exportMediaArchive(sources: PositionedMediaSource[], archiveName: string, projectName?: string) {
  const files = prepareOrderedMediaFiles(sources, projectName);
  if (!files.length) throw new Error('所选内容中没有可导出的图片、视频或音频。');

  const writer = new ZipWriter(new BlobWriter('application/zip'));
  for (const file of files) {
    const blob = await file.loadBlob();
    await writer.add(file.fileName, new BlobReader(blob), { level: 0 });
  }
  const archive = await writer.close();
  const url = URL.createObjectURL(archive);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${sanitizeMediaFileStem(archiveName, 'Flovart-媒体')}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return files.length;
}
