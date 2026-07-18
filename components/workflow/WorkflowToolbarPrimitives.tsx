import React, { type ReactNode } from 'react';

export function WorkflowToolbarShell({ children, className = '', testId }: { children: ReactNode; className?: string; testId?: string }) {
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      data-workflow-overlay
      data-testid={testId}
      className={`isl-shell isl-pop-in flex items-center justify-start gap-2 overflow-x-auto p-1.5 ${className}`}
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

export function WorkflowToolbarActions({ actions }: { actions: Array<WorkflowToolbarAction | null | false | undefined> }) {
  return <>{actions.filter((action): action is WorkflowToolbarAction => Boolean(action)).map(action => action.href ? (
    <a key={action.key} className="isl-icon-btn h-9 w-9" aria-label={action.label} title={action.label} href={action.href} download={action.download}>{action.icon}</a>
  ) : (
    <button key={action.key} type="button" disabled={action.disabled} className={`isl-icon-btn h-9 w-9 disabled:opacity-40 ${action.active ? 'isl-icon-btn--active' : ''}`} aria-label={action.label} title={action.label} style={action.danger ? { color: 'var(--isl-coral-deep)' } : undefined} onClick={action.onClick}>{action.icon}</button>
  ))}</>;
}
