import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function WorkflowToolbarShell({ children, className = '', testId }: { children: ReactNode; className?: string; testId?: string }) {
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      data-workflow-overlay
      data-testid={testId}
      className={`isl-shell isl-pop-in flex items-center justify-start gap-2 overflow-visible p-1.5 ${className}`}
      onMouseDown={stop}
      onPointerDown={stop}
      onWheel={stop}
    >
      {children}
    </div>
  );
}

export interface WorkflowToolbarAction {
  key: string;
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  href?: string;
  download?: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

export function WorkflowToolbarActions({ actions, showLabels = false }: { actions: Array<WorkflowToolbarAction | null | false | undefined>; showLabels?: boolean }) {
  const sizeClass = showLabels ? 'workflow-toolbar-labelled h-9 w-auto gap-1.5 px-2.5' : 'h-9 w-9';
  return <>{actions.filter((action): action is WorkflowToolbarAction => Boolean(action)).map(action => action.href ? (
    <a key={action.key} className={`isl-icon-btn ${sizeClass}`} aria-label={action.label} title={action.label} href={action.href} download={action.download}>{action.icon}{showLabels && <span>{action.label}</span>}</a>
  ) : (
    <button key={action.key} type="button" disabled={action.disabled} className={`isl-icon-btn ${sizeClass} disabled:opacity-40 ${action.active ? 'isl-icon-btn--active' : ''}`} aria-label={action.label} title={action.label} style={action.danger ? { color: 'var(--isl-coral-deep)' } : undefined} onClick={action.onClick}>{action.icon}{showLabels && <span>{action.label}</span>}</button>
  ))}</>;
}

/** An overflow button whose actions are shown with their names, so nothing is an unlabelled mystery icon. */
export function WorkflowToolbarMenu({ label, icon, actions, variant = 'icon', disabled = false }: { label: string; icon: ReactNode; actions: WorkflowToolbarAction[]; variant?: 'icon' | 'labelled' | 'icon-chevron'; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={rootRef} className="workflow-toolbar-menu">
      <button type="button" disabled={disabled} className={['isl-icon-btn h-9 disabled:opacity-40', variant === 'labelled' ? 'workflow-toolbar-labelled w-auto gap-1.5 px-2.5' : variant === 'icon-chevron' ? 'w-auto gap-0.5 px-2' : 'w-9', open ? 'isl-icon-btn--active' : ''].join(' ')} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>{icon}{variant === 'labelled' && <span>{label}</span>}{variant !== 'icon' && <ChevronDown size={12} aria-hidden />}</button>
      {open && (
        <div role="menu" className="workflow-toolbar-menu__list">
          {actions.map(action => action.href ? (
            <a key={action.key} role="menuitem" href={action.href} download={action.download} onClick={() => setOpen(false)}>{action.icon}<span>{action.label}</span></a>
          ) : (
            <button key={action.key} type="button" role="menuitem" aria-label={action.label} disabled={action.disabled} data-active={action.active ? 'true' : undefined} style={action.danger ? { color: 'var(--isl-coral-deep)' } : undefined} onClick={() => { setOpen(false); action.onClick?.(); }}>{action.icon}<span>{action.label}</span></button>
          ))}
        </div>
      )}
    </div>
  );
}
