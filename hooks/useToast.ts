import { useState, useCallback, useRef, useMemo } from 'react';

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  level: ToastLevel;
}

const AUTO_DISMISS_MS: Record<ToastLevel, number | null> = {
  info: 5000,
  success: 3000,
  warning: 5000,
  error: null, // manual close only
};

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const show = useCallback((message: string, level: ToastLevel = 'info') => {
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, message, level }]);

    const ms = AUTO_DISMISS_MS[level];
    if (ms !== null) {
      setTimeout(() => dismiss(id), ms);
    }

    return id;
  }, [dismiss]);

  return useMemo(() => ({ toasts, show, dismiss }), [toasts, show, dismiss]);
}
