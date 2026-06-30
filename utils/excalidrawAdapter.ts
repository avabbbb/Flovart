import type {
  ArrowElement,
  Element as FlovartElement,
  GroupElement,
  ImageElement,
  LineElement,
  PathElement,
  ShapeElement,
  TextElement,
  VideoElement,
  Point,
} from '../types';
import { generateId } from './canvasHelpers';

/**
 * Phase A adapter: Flovart Element <-> Excalidraw Element.
 *
 * Strategy:
 * - Flovart Element is the single source of truth in App.tsx; Excalidraw renders as a view + input layer.
 * - Element IDs are preserved (Flovart `id_xxx` used directly as Excalidraw `id`).
 * - Flovart-only metadata (generationState, filters, mask, mimeType, href for images) is mirrored
 *   onto the Excalidraw element's `customData` so we can rebuild Flovart state from Excalidraw events.
 * - Image files are registered with Excalidraw through a separate async helper (see `registerImageFiles`).
 *   This adapter only emits a `fileHintKey` (the element id) for callers to look up the href.
 */

export interface ExcalidrawFileEntry {
  fileId: string;
  dataURL: string;
  mimeType: string;
}

export interface FlovartToExcalidrawResult {
  elements: ExcalidrawElementLike[];
  /** map of flovart element id -> file entry required to register */
  imageFiles: Map<string, ExcalidrawFileEntry>;
}

// Excalidraw element shape (subset we actually write) to avoid brandle.
export interface ExcalidrawElementLike {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: 'hachure' | 'cross-hatch' | 'solid' | 'zigzag';
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  roundness: null | { type: number; value?: number };
  roughness: number;
  opacity: number;
  angle: number;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  groupIds: string[];
  frameId: string | null;
  boundElements: { id: string; type: 'arrow' | 'text' }[] | null;
  updated: number;
  link: string | null;
  locked: boolean;
  name?: string;
  customData?: Record<string, unknown>;
  // type-specific
  points?: { x: number; y: number }[];
  pressures?: number[];
  simulatePressure?: boolean;
  lastCommittedPoint?: { x: number; y: number } | null;
  startBinding?: unknown;
  endBinding?: unknown;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  elbowed?: boolean;
  fileId?: string | null;
  status?: 'pending' | 'saved' | 'error';
  scale?: [number, number];
  crop?: unknown;
  fontSize?: number;
  fontFamily?: string;
  text?: string;
  textAlign?: string;
  verticalAlign?: string;
  containerId?: string | null;
  originalText?: string;
  autoResize?: boolean;
  lineHeight?: number;
  name2?: string;
  establishedLines?: unknown[];
}

const SOLID_FILL: ExcalidrawElementLike['fillStyle'] = 'solid';
function makeSeed(): number {
  return Math.floor(Math.random() * 2000000000);
}
function makeNonce(): number {
  return Math.floor(Math.random() * 2000000000);
}

function baseFields(
  el: FlovartElement,
  overrides: Partial<ExcalidrawElementLike> = {},
): ExcalidrawElementLike {
  const isVisible = (el as { isVisible?: boolean }).isVisible !== false;
  const locked = (el as { isLocked?: boolean }).isLocked === true;
  const opacity = overrides.opacity ?? (isVisible ? 100 : 0);
  const customData = { ...overrides.customData, flovartId: el.id, flovartName: el.name, parentId: el.parentId };
  const { x, y, width: bw, height: bh } = boundsOf(el);
  return {
    id: el.id,
    type: '',
    x: overrides.x ?? x,
    y: overrides.y ?? y,
    width: overrides.width ?? bw ?? 0,
    height: overrides.height ?? bh ?? 0,
    strokeColor: '#1b1b1f',
    backgroundColor: 'transparent',
    fillStyle: SOLID_FILL,
    strokeWidth: 1,
    strokeStyle: 'solid',
    roundness: null,
    roughness: 0,
    opacity,
    angle: 0,
    seed: makeSeed(),
    version: 1,
    versionNonce: makeNonce(),
    isDeleted: false,
    groupIds: el.parentId ? [el.parentId] : [],
    frameId: null,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked,
    name: el.name,
    customData,
    ...overrides,
  };
}

function boundsOf(el: FlovartElement): { x: number; y: number; width: number; height: number } {
  switch (el.type) {
    case 'image':
    case 'video':
    case 'shape':
    case 'text':
    case 'group':
      return { x: el.x, y: el.y, width: el.width, height: el.height };
    case 'path': {
      const pts = (el as PathElement).points;
      if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
      const xs = pts.map(p => p.x);
      const ys = pts.map(p => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
    }
    case 'arrow':
    case 'line': {
      const [start, end] = (el as ArrowElement).points;
      const minX = Math.min(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      const maxX = Math.max(start.x, end.x);
      const maxY = Math.max(start.y, end.y);
      return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
    }
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

function convertImage(el: ImageElement): ExcalidrawElementLike {
  const base = baseFields(el, {
    type: 'image',
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
  });
  // file hint: caller will resolve href -> file entry, fill in fileId
  base.fileId = null;
  base.status = 'pending';
  base.scale = [1, 1];
  base.crop = null;
  base.customData = {
    ...base.customData,
    flovartType: 'image',
    flovartHref: el.href,
    flovartMimeType: el.mimeType,
    flovartBorderRadius: el.borderRadius,
    flovartFilters: el.filters,
    flovartMask: el.mask,
    flovartAspect: el.width / el.height || 1,
    generationState: el.generationState,
  };
  return base;
}

function convertVideo(el: VideoElement): ExcalidrawElementLike {
  const base = baseFields(el, {
    type: 'embeddable',
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    link: el.href,
  });
  base.customData = {
    ...base.customData,
    flovartType: 'video',
    flovartHref: el.href,
    flovartMime: el.mimeType,
    flovartPoster: el.poster,
    flovartDuration: el.durationSec,
    flovartSourceKind: el.sourceKind,
    flovartGenerationMeta: el.generationMeta,
    generationState: el.generationState,
  };
  return base;
}

function convertShape(el: ShapeElement): ExcalidrawElementLike {
  const map: Record<ShapeElement['shapeType'], string> = {
    rectangle: 'rectangle',
    circle: 'ellipse',
    triangle: 'diamond',
  };
  const base = baseFields(el, {
    type: map[el.shapeType] ?? 'rectangle',
    strokeColor: el.strokeColor,
    backgroundColor: el.fillColor,
    strokeWidth: el.strokeWidth,
    strokeStyle: el.strokeDashArray ? 'dashed' : 'solid',
    roundness: el.borderRadius ? { type: 3, value: el.borderRadius } : null,
  });
  base.customData = {
    ...base.customData,
    flovartShapeType: el.shapeType,
    flovartBorderRadius: el.borderRadius,
    flovartStrokeDashArray: el.strokeDashArray,
  };
  return base;
}

function convertText(el: TextElement): ExcalidrawElementLike {
  const base = baseFields(el, {
    type: 'text',
    strokeColor: el.fontColor,
    backgroundColor: 'transparent',
    strokeWidth: 1,
  });
  base.fontSize = el.fontSize;
  base.fontFamily = 'Virgil';
  base.text = el.text;
  base.originalText = el.text;
  base.textAlign = 'left';
  base.verticalAlign = 'top';
  base.containerId = null;
  base.autoResize = true;
  base.lineHeight = 1.2 as unknown as number;
  base.customData = {
    ...base.customData,
    flovartType: 'text',
    flovartFontColor: el.fontColor,
  };
  return base;
}

function convertPath(el: PathElement): ExcalidrawElementLike {
  const pts = el.points;
  if (!pts.length) {
    return baseFields(el, { type: 'freedraw', width: 1, height: 1 });
  }
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const localPoints = pts.map(p => ({ x: p.x - minX, y: p.y - minY }));
  const base = baseFields(el, {
    type: 'freedraw',
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    strokeColor: el.strokeColor,
    strokeWidth: el.strokeWidth,
    opacity: (el.strokeOpacity ?? 1) * 100,
  });
  base.points = localPoints;
  base.pressures = localPoints.map(() => 0.5);
  base.simulatePressure = true;
  base.lastCommittedPoint = null;
  base.customData = {
    ...base.customData,
    flovartType: 'path',
    flovartStrokeOpacity: el.strokeOpacity,
    flovartAbsolutePoints: pts, // preserve original absolute points for round-trip
  };
  return base;
}

function convertLinear(el: ArrowElement | LineElement): ExcalidrawElementLike {
  const [start, end] = el.points;
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxX = Math.max(start.x, end.x);
  const maxY = Math.max(start.y, end.y);
  const localPoints = [
    { x: start.x - minX, y: start.y - minY },
    { x: end.x - minX, y: end.y - minY },
  ];
  const isArrow = el.type === 'arrow';
  const base = baseFields(el, {
    type: isArrow ? 'arrow' : 'line',
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    strokeColor: el.strokeColor,
    strokeWidth: el.strokeWidth,
    strokeStyle: 'solid',
  });
  base.points = localPoints;
  base.lastCommittedPoint = null;
  base.startBinding = null;
  base.endBinding = null;
  base.startArrowhead = null;
  base.endArrowhead = isArrow ? 'arrow' : null;
  if (isArrow) {
    base.elbowed = false;
  }
  base.customData = {
    ...base.customData,
    flovartType: el.type,
  };
  return base;
}

function convertGroup(el: GroupElement): ExcalidrawElementLike | null {
  // Groups are virtual — children carry parentId in customData; Excalidraw groupIds on children handle layout.
  // We emit an invisible placeholder rectangle so the group's bounding box stays observable.
  const base = baseFields(el, {
    type: 'rectangle',
    strokeColor: 'transparent',
    backgroundColor: 'transparent',
    strokeWidth: 1,
    opacity: 0,
  });
  base.locked = true;
  base.customData = {
    ...base.customData,
    flovartType: 'group',
  };
  return base;
}

export function flovartToExcalidraw(
  elements: FlovartElement[],
): FlovartToExcalidrawResult {
  const imageFiles = new Map<string, ExcalidrawFileEntry>();
  const out: ExcalidrawElementLike[] = [];
  for (const el of elements) {
    let converted: ExcalidrawElementLike | null = null;
    switch (el.type) {
      case 'image':
        converted = convertImage(el as ImageElement);
        break;
      case 'video':
        converted = convertVideo(el as VideoElement);
        break;
      case 'text':
        converted = convertText(el as TextElement);
        break;
      case 'shape':
        converted = convertShape(el as ShapeElement);
        break;
      case 'path':
        converted = convertPath(el as PathElement);
        break;
      case 'arrow':
      case 'line':
        converted = convertLinear(el as ArrowElement | LineElement);
        break;
      case 'group':
        converted = convertGroup(el as GroupElement);
        break;
      default:
        converted = null;
    }
    if (converted) out.push(converted);
  }
  return { elements: out, imageFiles };
}

/**
 * Resolve image source href to a data URL Excalidraw can register as a BinaryFileData.
 * Handles data URLs (passthrough), blob: URLs (fetch + read), and cold-media/idb refs.
 */
export async function hrefToDataUrl(
  href: string,
  options: { resolveColdMediaRef?: (href: string) => Promise<string | null> } = {},
): Promise<string> {
  if (!href) return '';
  if (href.startsWith('data:')) return href;
  if (href.startsWith('blob:')) {
    try {
      const resp = await fetch(href);
      const blob = await resp.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      return '';
    }
  }
  if (options.resolveColdMediaRef) {
    const resolved = await options.resolveColdMediaRef(href);
    if (resolved) return resolved;
  }
  return href;
}

/**
 * Async helper: register all image elements as Excalidraw files via api.addFiles.
 * Returns a map of elementId -> fileId for callers to attach to converted elements.
 */
export async function registerImageFiles(
  elements: ImageElement[],
  api: { addFiles: (files: { id: string; dataURL: string; mimeType: string }[]) => void },
  options: { resolveColdMediaRef?: (href: string) => Promise<string | null>, cache?: Map<string, string> } = {},
): Promise<Map<string, string>> {
  const cache = options.cache ?? new Map<string, string>();
  const result = new Map<string, string>();
  const pending: { elementId: string; href: string }[] = [];
  for (const el of elements) {
    if (cache.has(el.href)) {
      result.set(el.id, cache.get(el.href)!);
      continue;
    }
    pending.push({ elementId: el.id, href: el.href });
  }
  if (!pending.length) return result;

  const filesToAdd: { id: string; dataURL: string; mimeType: string }[] = [];
  for (const { elementId, href } of pending) {
    const dataUrl = await hrefToDataUrl(href, options);
    if (!dataUrl) continue;
    const fileId = `fl_${elementId}`;
    const mimeType = (elements.find(e => e.id === elementId)?.mimeType) || 'image/png';
    filesToAdd.push({ id: fileId, dataURL: dataUrl, mimeType });
    cache.set(href, fileId);
    result.set(elementId, fileId);
  }
  if (filesToAdd.length) api.addFiles(filesToAdd);
  return result;
}

/**
 * Reverse conversion: Excalidraw element -> a partial Flovart patch.
 * Returns null for elements we don't manage (e.g., raw Excalidraw rectangle created by user
 * inside Excalidraw that we have no counterpart for yet — caller can decide to create new).
 */
export interface ExcalidrawToFlovartPatch {
  id: string;
  type: 'image' | 'video' | 'text' | 'shape' | 'path' | 'arrow' | 'line' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  partial: Record<string, unknown>;
}

export function excalidrawToFlovartPatch(exEl: ExcalidrawElementLike): ExcalidrawToFlovartPatch | null {
  const cd = exEl.customData as { flovartType?: string } | undefined;
  const flovartType = cd?.flovartType;
  const isDeleted = exEl.isDeleted === true;
  const common = {
    id: exEl.id,
    x: exEl.x,
    y: exEl.y,
    width: exEl.width,
    height: exEl.height,
    isDeleted,
  };

  switch (exEl.type) {
    case 'image':
      if (flovartType !== 'image' && flovartType !== undefined) return null;
      return {
        ...common,
        type: 'image',
        partial: {
          ...(!isDeleted && {
            href: cd?.flovartHref,
            mimeType: cd?.flovartMimeType,
            borderRadius: cd?.flovartBorderRadius,
            filters: cd?.flovartFilters,
            mask: cd?.flovartMask,
          }),
          generationState: cd?.generationState,
        },
      };
    case 'embeddable':
      if (flovartType !== 'video') return null;
      return {
        ...common,
        type: 'video',
        partial: {
          href: cd?.flovartHref ?? exEl.link,
          mimeType: cd?.flovartMime,
          poster: cd?.flovartPoster,
          durationSec: cd?.flovartDuration,
          sourceKind: cd?.flovartSourceKind,
          generationMeta: cd?.flovartGenerationMeta,
          generationState: cd?.generationState,
        },
      };
    case 'text':
      return {
        ...common,
        type: 'text',
        partial: {
          text: exEl.text ?? '',
          fontSize: exEl.fontSize ?? 20,
          fontColor: (cd?.flovartFontColor as string) ?? '#1b1b1f',
        },
      };
    case 'rectangle':
    case 'ellipse':
    case 'diamond': {
      if (cd?.flovartType === 'group') {
        return { ...common, type: 'group', partial: {} };
      }
      const shapeMap: Record<string, ShapeElement['shapeType']> = {
        rectangle: 'rectangle',
        ellipse: 'circle',
        diamond: 'triangle',
      };
      return {
        ...common,
        type: 'shape',
        partial: {
          shapeType: shapeMap[exEl.type] ?? 'rectangle',
          strokeColor: exEl.strokeColor,
          strokeWidth: exEl.strokeWidth,
          fillColor: exEl.backgroundColor,
          borderRadius: cd?.flovartBorderRadius,
          strokeDashArray: cd?.flovartStrokeDashArray,
        },
      };
    }
    case 'freedraw': {
      const pts = exEl.points ?? [];
      // Back to Flovart absolute coords
      const absolute = pts.map(p => ({ x: p.x + exEl.x, y: p.y + exEl.y }));
      // Recover original absolute points when present (preferred)
      const originalAbs = cd?.flovartAbsolutePoints as Point[] | undefined;
      return {
        ...common,
        type: 'path',
        partial: {
          points: originalAbs ?? absolute,
          strokeColor: exEl.strokeColor,
          strokeWidth: exEl.strokeWidth,
          strokeOpacity: (exEl.opacity ?? 100) / 100,
        },
      };
    }
    case 'arrow':
    case 'line': {
      const pts = exEl.points ?? [];
      const p0 = pts[0] ?? { x: 0, y: 0 };
      const p1 = pts[1] ?? p0;
      return {
        ...common,
        type: exEl.type === 'arrow' ? 'arrow' : 'line',
        // Flovart stores absolute coords for arrow/line points
        partial: {
          x: exEl.x + p0.x,
          y: exEl.y + p0.y,
          points: [
            { x: exEl.x + p0.x, y: exEl.y + p0.y },
            { x: exEl.x + p1.x, y: exEl.y + p1.y },
          ],
          strokeColor: exEl.strokeColor,
          strokeWidth: exEl.strokeWidth,
        },
      };
    }
    default:
      return null;
  }
}

/**
 * Diff two Excalidraw snapshots and return element ids that changed.
 */
export function diffExcalidrawElements(
  prev: ExcalidrawElementLike[],
  next: ExcalidrawElementLike[],
): { added: string[]; removed: string[]; updated: string[] } {
  const prevMap = new Map(prev.map(e => [e.id, e]));
  const nextMap = new Map(next.map(e => [e.id, e]));
  const added: string[] = [];
  const removed: string[] = [];
  const updated: string[] = [];
  for (const [id, nextEl] of nextMap) {
    const prevEl = prevMap.get(id);
    if (!prevEl) {
      added.push(id);
      continue;
    }
    if (
      prevEl.x !== nextEl.x || prevEl.y !== nextEl.y ||
      prevEl.width !== nextEl.width || prevEl.height !== nextEl.height ||
      prevEl.isDeleted !== nextEl.isDeleted ||
      prevEl.opacity !== nextEl.opacity ||
      prevEl.angle !== nextEl.angle ||
      JSON.stringify(prevEl.points) !== JSON.stringify(nextEl.points) ||
      JSON.stringify(prevEl.customData) !== JSON.stringify(nextEl.customData)
    ) {
      updated.push(id);
    }
  }
  for (const [id] of prevMap) {
    if (!nextMap.has(id)) removed.push(id);
  }
  return { added, removed, updated };
}

/**
 * Stable id for an Excalidraw element newly created inside Excalidraw (not from Flovart).
 * Use Flovart's generateId so it looks like a Flovart id when round-tripping.
 */
export function allocateFlovartIdFromExcalidraw(exEl: ExcalidrawElementLike): string {
  // If the customData has a flovartId use it, otherwise keep the excalidraw id.
  const cd = exEl.customData as { flovartId?: string } | undefined;
  return cd?.flovartId ?? (exEl.id && exEl.id.startsWith('id_') ? exEl.id : generateId());
}