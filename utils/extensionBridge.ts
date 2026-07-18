import type { AssetItem } from '../types';

export interface CollectedExtensionImage {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface CollectedExtensionImagesPayload {
  images: CollectedExtensionImage[];
  source?: string;
  timestamp?: number;
}

const asNumber = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

export function normalizeCollectedImagesPayload(input: unknown): CollectedExtensionImagesPayload | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as { images?: unknown; source?: unknown; timestamp?: unknown };
  if (!Array.isArray(raw.images)) return null;

  const images = raw.images
    .map((item): CollectedExtensionImage | null => {
      if (!item || typeof item !== 'object') return null;
      const candidate = item as { src?: unknown; alt?: unknown; width?: unknown; height?: unknown };
      const src = typeof candidate.src === 'string' ? candidate.src.trim() : '';
      if (!src) return null;
      return {
        src,
        alt: typeof candidate.alt === 'string' ? candidate.alt.trim() : undefined,
        width: asNumber(candidate.width, 512),
        height: asNumber(candidate.height, 512),
      };
    })
    .filter((item): item is CollectedExtensionImage => !!item);

  if (images.length === 0) return null;

  return {
    images,
    source: typeof raw.source === 'string' ? raw.source : undefined,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : undefined,
  };
}

export function buildAssetItemsFromCollectedImages(
  payload: CollectedExtensionImagesPayload,
  now = Date.now(),
): AssetItem[] {
  return payload.images.map((image, index) => ({
    id: `ext_asset_${now}_${index}`,
    name: image.alt || `Collected image ${index + 1}`,
    category: 'scene',
    folderIds: [],
    tags: [],
    dataUrl: image.src,
    mimeType: inferImageMimeType(image.src),
    width: image.width || 512,
    height: image.height || 512,
    createdAt: now + index,
    source: 'extension',
    sourceUrl: payload.source,
  }));
}

function inferImageMimeType(src: string): string {
  const match = src.match(/^data:([^;]+);/);
  if (match) return match[1];
  if (/\.jpe?g(?:[?#].*)?$/i.test(src)) return 'image/jpeg';
  if (/\.webp(?:[?#].*)?$/i.test(src)) return 'image/webp';
  if (/\.gif(?:[?#].*)?$/i.test(src)) return 'image/gif';
  return 'image/png';
}
