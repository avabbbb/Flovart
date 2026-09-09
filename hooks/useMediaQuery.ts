import { useSyncExternalStore } from 'react';

function fallbackMatch(query: string, width: number): boolean {
  const maxWidths = [...query.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map(match => Number(match[1]));
  const minWidths = [...query.matchAll(/min-width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map(match => Number(match[1]));
  if (!maxWidths.length && !minWidths.length) return false;
  return maxWidths.every(value => width <= value) && minWidths.every(value => width >= value);
}

/** Behavior-only media query subscription. CSS owns visual composition. */
export function useMediaQuery(query: string): boolean {
  const subscribe = (onStoreChange: () => void) => {
    if (typeof window === 'undefined') return () => undefined;
    if (typeof window.matchMedia !== 'function') {
      window.addEventListener('resize', onStoreChange);
      return () => window.removeEventListener('resize', onStoreChange);
    }
    const media = window.matchMedia(query);
    const handleChange = () => onStoreChange();
    if (typeof media.addEventListener === 'function') media.addEventListener('change', handleChange);
    else media.addListener(handleChange);
    return () => {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', handleChange);
      else media.removeListener(handleChange);
    };
  };
  const getSnapshot = () => {
    if (typeof window === 'undefined') return false;
    return typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : fallbackMatch(query, window.innerWidth);
  };
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
