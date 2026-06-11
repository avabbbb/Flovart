import type { Element, ImageElement, VideoElement } from '../types';

export type KonvaMediaElement = ImageElement | VideoElement;

const EMPTY_SET = new Set<string>();

function hasActiveImageFilters(element: ImageElement): boolean {
  const filters = element.filters;
  if (!filters) return false;
  return Object.entries(filters).some(([, value]) => typeof value === 'number');
}

export function shouldRenderMediaInKonva(
  element: Element,
  disabledElementIds: ReadonlySet<string> = EMPTY_SET,
): element is KonvaMediaElement {
  if (disabledElementIds.has(element.id)) return false;
  if (element.isVisible === false) return false;
  if (element.type === 'video') return true;
  if (element.type !== 'image') return false;
  if (!element.href) return false;
  if (element.mask) return false;
  if (element.borderRadius && element.borderRadius > 0) return false;
  if (hasActiveImageFilters(element)) return false;
  return true;
}
