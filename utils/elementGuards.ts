import type {
  ArrowElement,
  CanvasElement,
  Element,
  GroupElement,
  ImageElement,
  LineElement,
  PathElement,
  ShapeElement,
  TextElement,
  VideoElement,
} from '../types';

export function isImageElement(element: Element | null | undefined): element is ImageElement {
  return element?.type === 'image';
}

export function isVideoElement(element: Element | null | undefined): element is VideoElement {
  return element?.type === 'video';
}

export function isTextElement(element: Element | null | undefined): element is TextElement {
  return element?.type === 'text';
}

export function isShapeElement(element: Element | null | undefined): element is ShapeElement {
  return element?.type === 'shape';
}

export function isPathElement(element: Element | null | undefined): element is PathElement {
  return element?.type === 'path';
}

export function isArrowElement(element: Element | null | undefined): element is ArrowElement {
  return element?.type === 'arrow';
}

export function isLineElement(element: Element | null | undefined): element is LineElement {
  return element?.type === 'line';
}

export function isGroupElement(element: Element | null | undefined): element is GroupElement {
  return element?.type === 'group';
}

export function isCanvasElement(element: Element | null | undefined): element is CanvasElement {
  return isImageElement(element) || isVideoElement(element) || isTextElement(element) || isShapeElement(element);
}

export function elementHasMedia(element: Element | null | undefined): element is ImageElement | VideoElement {
  return isImageElement(element) || isVideoElement(element);
}

export function elementCanBeReferenced(element: Element | null | undefined): boolean {
  return isImageElement(element) || isVideoElement(element) || isTextElement(element) || isShapeElement(element);
}
