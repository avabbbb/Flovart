import React from 'react';

const join = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export const CanvasFloatingPanel: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  children,
  ...props
}) => (
  <div className={join('canvas-floating-panel', className)} {...props}>
    {children}
  </div>
);

export const CanvasIconButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
    variant?: 'default' | 'primary';
  }
> = ({ active, variant = 'default', className, children, ...props }) => (
  <button
    type="button"
    className={join(
      'canvas-icon-button',
      variant === 'primary' && 'canvas-icon-button--primary',
      active && 'is-active',
      className,
    )}
    {...props}
  >
    {children}
  </button>
);
