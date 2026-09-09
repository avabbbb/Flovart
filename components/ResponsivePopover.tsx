import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';

export type ResponsivePopoverSide = 'up' | 'down';

interface ResponsivePopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  preferredSide?: 'auto' | ResponsivePopoverSide;
  width?: number;
  children: React.ReactNode;
  className?: string;
  role?: 'dialog' | 'menu';
  ariaLabel?: string;
  onRequestClose?: () => void;
  dataTestId?: string;
}

/**
 * A single popup primitive for prompt/config controls.
 * It stays viewport-safe on desktop and becomes a bottom sheet on narrow screens.
 */
export function ResponsivePopover({
  anchorRef,
  preferredSide = 'auto',
  width = 320,
  children,
  className = '',
  role = 'dialog',
  ariaLabel,
  onRequestClose,
  dataTestId,
}: ResponsivePopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 320, side: 'up' as ResponsivePopoverSide, ready: false });

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportWidth = viewport?.width || document.documentElement.clientWidth;
      const viewportHeight = viewport?.height || document.documentElement.clientHeight;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportTop = viewport?.offsetTop || 0;
      const margin = Math.min(16, Math.max(10, viewportWidth * 0.03));
      const gap = 10;
      const spaceAbove = anchorRect.top - viewportTop - margin - gap;
      const spaceBelow = viewportTop + viewportHeight - anchorRect.bottom - margin - gap;
      const desiredHeight = Math.max(180, panelRect.height);
      const preferredFits = preferredSide === 'up'
        ? spaceAbove >= desiredHeight
        : preferredSide === 'down'
          ? spaceBelow >= desiredHeight
          : false;
      const side: ResponsivePopoverSide = preferredSide === 'auto'
        ? (spaceBelow >= desiredHeight || spaceBelow >= spaceAbove ? 'down' : 'up')
        : preferredFits
          ? preferredSide
          : preferredSide === 'up'
            ? 'down'
            : 'up';
      const availableHeight = Math.max(160, side === 'up' ? spaceAbove : spaceBelow);
      const renderedHeight = Math.min(panelRect.height, availableHeight);
      const panelWidth = Math.min(width, Math.max(0, viewportWidth - margin * 2));
      const idealLeft = anchorRect.left + Math.min(16, Math.max(0, anchorRect.width - panelWidth));
      const maxLeft = Math.max(viewportLeft + margin, viewportLeft + viewportWidth - panelWidth - margin);
      const left = Math.min(Math.max(idealLeft, viewportLeft + margin), maxLeft);
      const top = side === 'up'
        ? Math.max(viewportTop + margin, anchorRect.top - gap - renderedHeight)
        : Math.min(anchorRect.bottom + gap, viewportTop + viewportHeight - renderedHeight - margin);

      setPosition(previous => {
        const next = { left, top, maxHeight: availableHeight, side, ready: true };
        return previous.left === next.left && previous.top === next.top && previous.maxHeight === next.maxHeight && previous.side === next.side && previous.ready
          ? previous
          : next;
      });
    };
    const updatePosition = () => {
      if (frame) return;
      if (typeof window.requestAnimationFrame === 'function') frame = window.requestAnimationFrame(measure);
      else measure();
    };

    // Measure the first frame synchronously so the panel is keyboard/queryable
    // immediately after opening. Later viewport changes stay frame-batched.
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    observer?.observe(anchor);
    observer?.observe(panel);
    // Positioning depends on the visual viewport and the anchor/panel boxes.
    // ResizeObserver covers embedded hosts and document viewport changes;
    // visualViewport covers mobile browser chrome/keyboard changes. This is
    // deliberately scoped to the open popover and does not drive page layout.
    const documentObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
    documentObserver?.observe(document.documentElement);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);
    return () => {
      if (frame && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame);
      observer?.disconnect();
      documentObserver?.disconnect();
      window.removeEventListener('scroll', updatePosition, true);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
    };
  }, [anchorRef, preferredSide, width]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {onRequestClose && (
        <div
          className="flv-responsive-popover__backdrop"
          aria-hidden="true"
          onPointerDown={event => {
            event.stopPropagation();
            onRequestClose();
          }}
        />
      )}
      <motion.div
        ref={panelRef}
        role={role}
        aria-label={ariaLabel}
        data-responsive-popover
        data-prompt-floating-panel={dataTestId === 'prompt-floating-panel' ? true : undefined}
        data-testid={dataTestId}
        data-side={position.side}
        data-preferred-side={preferredSide}
        className={`theme-aware flv-responsive-popover isl-scrollbar ${className}`.trim()}
        style={{
          left: position.left,
          top: position.top,
          width: `min(${width}px, calc(100% - 24px))`,
          maxHeight: position.maxHeight,
          visibility: position.ready ? 'visible' : 'hidden',
          overflowY: 'auto',
          overflowX: 'hidden',
          overscrollBehavior: 'contain',
          borderRadius: 16,
          transformOrigin: position.side === 'up' ? 'bottom left' : 'top left',
        }}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: position.ready ? 1 : 0, scale: position.ready ? 1 : 0.97 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
        onPointerDown={event => event.stopPropagation()}
        onWheel={event => event.stopPropagation()}
      >
        {children}
      </motion.div>
    </>,
    document.body,
  );
}
