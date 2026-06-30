import { useEffect, useState, type RefObject, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { CanvasContainerRect } from '../../utils/canvasOverlayViewport';

/**
 * Tracks the bounding client rect of `ref` and re-reads it whenever the window is
 * scrolled, resized, or the element itself resizes (ResizeObserver). Returns `null`
 * until the element is mounted and a rect has been read.
 *
 * Used by fixed-overlay layers that need to convert canvas-space coordinates into
 * screen-space `position: fixed` coordinates.
 */
export function useElementContainerRect(ref: RefObject<HTMLElement | SVGElement | null>): CanvasContainerRect | null {
  const [rect, setRect] = useState<CanvasContainerRect | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    window.addEventListener('resize', read);
    window.addEventListener('scroll', read, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', read);
      window.removeEventListener('scroll', read, true);
    };
  }, [ref]);

  return rect;
}

export interface CanvasFixedOverlayProps {
  left: number;
  top: number;
  /** Disable the 100ms ease-out when dragging/panning (瞬贴). */
  noTransition?: boolean;
  /** Width of the overlay box in screen px — needed so transition floats it from the right edge. */
  width?: number;
  /** Inline style merge (for z-index overrides etc.). */
  style?: CSSProperties;
  /** Class name applied to the fixed wrapper. */
  className?: string;
  /** Test id for assertions. */
  testId?: string;
  children: ReactNode;
  /** Pause rendering — used by callers that want to compute placement before showing. */
  hidden?: boolean;
}

/**
 * Renders an overlay rooted at document.body using `position: fixed`. Mounts above the SVG
 * (z-index 50) and below modals (z-index 9999). Tippy popovers spawned inside still attach to
 * document.body at z-index 99999, so mention dropdowns render above the bar.
 */
export function CanvasFixedOverlay({
  left,
  top,
  noTransition,
  width,
  style,
  className,
  testId,
  children,
  hidden,
}: CanvasFixedOverlayProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      data-testid={testId}
      data-canvas-overlay="fixed"
      data-no-transition={noTransition ? 'true' : undefined}
      className={className ? `canvas-overlay-fixed ${className}` : 'canvas-overlay-fixed'}
      style={{
        left: Math.round(left),
        top: Math.round(top),
        width,
        visibility: hidden ? 'hidden' : 'visible',
        ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}