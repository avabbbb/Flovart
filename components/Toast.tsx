import React from 'react';
import { Z } from '../utils/zLayers';
import type { ToastItem } from '../hooks/useToast';

const LEVEL_STYLES: Record<ToastItem['level'], { accent: string; icon: string }> = {
  info:    { accent: 'var(--isl-mint)',  icon: '🔄' },
  success: { accent: 'var(--isl-mint)',  icon: '✅' },
  warning: { accent: 'var(--isl-sun)',   icon: '⚠️' },
  error:   { accent: 'var(--isl-coral)', icon: '' },
};

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

export default function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="theme-aware fixed top-4 left-1/2 -translate-x-1/2 flex flex-col gap-2 pointer-events-none"
      style={{ zIndex: Z.notification }}
    >
      {toasts.map(t => {
        const s = LEVEL_STYLES[t.level];
        return (
          <div
            key={t.id}
            className="isl-shell isl-bounce-in pointer-events-auto flex max-w-lg items-center p-3"
            style={{ borderLeftWidth: '5px', borderLeftColor: s.accent }}
          >
            {s.icon && <span className="mr-2">{s.icon}</span>}
            <span className="flex-grow text-sm font-bold" style={{ color: 'var(--isl-ink)' }}>{t.message}</span>
            <button
              onClick={() => onDismiss(t.id)}
              className="isl-icon-btn ml-4 h-7 w-7"
              aria-label="close"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
