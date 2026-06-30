// Canvas overlay positioning: canvas-space -> fixed-screen positioning with four-direction flip.
//
// Two overlay anchoring modes are supported:
//   - element-relative (used by node prompt bars, ElementToolbar): anchored to the element bbox
//     with one of {below-center, above-center, left-center, right-center}.
//   - centroid (used by inpaint prompt box): anchored to a canvas-space point, centered on it.
//
// The caller supplies the current viewport (zoom + pan in screen px) and the canvas container's
// bounding rect, plus the element's canvas-space bbox. Output is the `left/top` for a
// `position: fixed` element. The container rect already accounts for the workspace sidebar /
// right panel offset since it is read via getBoundingClientRect at mount time of the canvas.
//
// Four-direction flip: when the overlay under default placement would exceed the viewport
// (window.innerWidth / innerHeight), it flips to the opposite side of the element bbox. When the
// overlay still does not fit horizontally, it is clamped inside the viewport with a small margin.

export interface CanvasViewport {
  /** Current canvas zoom factor. */
  zoom: number;
  /** Screen-space pan offset (px). For legacy Konva this is `board.panOffset.x/y`. For Excalidraw
   *  this is `appState.scrollX * zoom` / `appState.scrollY * zoom`. */
  panScreenX: number;
  panScreenY: number;
}

export interface CanvasContainerRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type OverlayAnchorType =
  | 'below-center'
  | 'above-center'
  | 'center'
  | 'left-center'
  | 'right-center';

export interface OverlayAnchor {
  type: OverlayAnchorType;
  /** Element bbox in canvas-space. */
  canvasX: number;
  canvasY: number;
  canvasW: number;
  canvasH: number;
  /** For 'center' anchor: optional explicit centroid overrides (used by inpaint). */
  centroidX?: number;
  centroidY?: number;
}

export interface OverlaySize {
  width: number;
  height: number;
}

export interface PlaceOverlayInput {
  viewport: CanvasViewport;
  containerRect: CanvasContainerRect;
  anchor: OverlayAnchor;
  overlaySize: OverlaySize;
  /** Gap from element bbox to overlay (screen px). Default 10. */
  margin?: number;
  /** Enable four-direction flip on overflow. Default true. */
  flip?: boolean;
  /** Clamp overlay inside viewport if flip is disabled or both sides overflow. Default true. */
  clamp?: boolean;
  /** Viewport bounds override (for tests / SSR-safe). Defaults to window.innerWidth/Height. */
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface OverlayPlacement {
  left: number;
  top: number;
  /** Final placement after flip resolution; useful for arrow direction / animation tuning. */
  placement: OverlayAnchorType;
}

const DEFAULT_MARGIN = 10;
const CLAMP_PADDING = 8;

function elementScreenRect(anchor: OverlayAnchor, viewport: CanvasViewport, containerRect: CanvasContainerRect) {
  const screenX = anchor.canvasX * viewport.zoom + viewport.panScreenX + containerRect.left;
  const screenY = anchor.canvasY * viewport.zoom + viewport.panScreenY + containerRect.top;
  const screenW = anchor.canvasW * viewport.zoom;
  const screenH = anchor.canvasH * viewport.zoom;
  return { screenX, screenY, screenW, screenH };
}

function centroidScreen(anchor: OverlayAnchor, viewport: CanvasViewport, containerRect: CanvasContainerRect) {
  const cx = anchor.centroidX ?? anchor.canvasX + anchor.canvasW / 2;
  const cy = anchor.centroidY ?? anchor.canvasY + anchor.canvasH / 2;
  return {
    screenX: cx * viewport.zoom + viewport.panScreenX + containerRect.left,
    screenY: cy * viewport.zoom + viewport.panScreenY + containerRect.top,
  };
}

export function placeOverlay(input: PlaceOverlayInput): OverlayPlacement {
  const margin = input.margin ?? DEFAULT_MARGIN;
  const enableFlip = input.flip ?? true;
  const enableClamp = input.clamp ?? true;
  const vw = input.viewportWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const vh = input.viewportHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 720);
  const { viewport, containerRect, anchor, overlaySize } = input;

  // Compute the screen-space anchor point + desired top-left based on placement type.
  let placement = anchor.type;
  let left: number;
  let top: number;

  if (placement === 'center') {
    const c = centroidScreen(anchor, viewport, containerRect);
    left = c.screenX - overlaySize.width / 2;
    top = c.screenY - overlaySize.height / 2;
  } else {
    const el = elementScreenRect(anchor, viewport, containerRect);
    if (placement === 'below-center') {
      left = el.screenX + el.screenW / 2 - overlaySize.width / 2;
      top = el.screenY + el.screenH + margin;
    } else if (placement === 'above-center') {
      left = el.screenX + el.screenW / 2 - overlaySize.width / 2;
      top = el.screenY - overlaySize.height - margin;
    } else if (placement === 'left-center') {
      left = el.screenX - overlaySize.width - margin;
      top = el.screenY + el.screenH / 2 - overlaySize.height / 2;
    } else {
      // right-center
      left = el.screenX + el.screenW + margin;
      top = el.screenY + el.screenH / 2 - overlaySize.height / 2;
    }
  }

  // Four-direction flip: vertical first, then horizontal.
  if (enableFlip) {
    const belowOverflow = top + overlaySize.height > vh - CLAMP_PADDING;
    const aboveOverflow = top < CLAMP_PADDING;
    // Only flip when the anchor mode is vertical-flippable and only one side overflows.
    if (anchor.type === 'below-center' && belowOverflow && !aboveOverflow) {
      const el = elementScreenRect(anchor, viewport, containerRect);
      top = el.screenY - overlaySize.height - margin;
      placement = 'above-center';
    } else if (anchor.type === 'above-center' && aboveOverflow && !belowOverflow) {
      const el = elementScreenRect(anchor, viewport, containerRect);
      top = el.screenY + el.screenH + margin;
      placement = 'below-center';
    }
    // Horizontal flip for left/right center anchors
    if (anchor.type === 'left-center' && left < CLAMP_PADDING) {
      const el = elementScreenRect(anchor, viewport, containerRect);
      left = el.screenX + el.screenW + margin;
      placement = 'right-center';
    } else if (anchor.type === 'right-center' && left + overlaySize.width > vw - CLAMP_PADDING) {
      const el = elementScreenRect(anchor, viewport, containerRect);
      left = el.screenX - overlaySize.width - margin;
      placement = 'left-center';
    }
  }

  // Final clamp: ensure overlay stays inside viewport even after flipping.
  if (enableClamp) {
    left = Math.max(CLAMP_PADDING, Math.min(left, vw - overlaySize.width - CLAMP_PADDING));
    top = Math.max(CLAMP_PADDING, Math.min(top, vh - overlaySize.height - CLAMP_PADDING));
  }

  return { left, top, placement };
}

/** Convenience: convert a canvas-space point to a fixed-screen position (no flip). */
export function canvasToScreen(
  canvasX: number,
  canvasY: number,
  viewport: CanvasViewport,
  containerRect: CanvasContainerRect,
): { left: number; top: number } {
  return {
    left: canvasX * viewport.zoom + viewport.panScreenX + containerRect.left,
    top: canvasY * viewport.zoom + viewport.panScreenY + containerRect.top,
  };
}