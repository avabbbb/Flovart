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
    // Listen to BOTH the matchMedia change event AND window resize. Emulated
    // viewports and some embed contexts don't reliably fire matchMedia change,
    // but they always fire resize — belt-and-suspenders so docked↔overlay
    // flips actually propagate.
    window.addEventListener('resize', onStoreChange);
    let media: MediaQueryList | undefined;
    if (typeof window.matchMedia === 'function') {
      media = window.matchMedia(query);
      const handleChange = () => onStoreChange();
      if (typeof media.addEventListener === 'function') media.addEventListener('change', handleChange);
      else media.addListener(handleChange);
    }
    return () => {
      window.removeEventListener('resize', onStoreChange);
      if (!media) return;
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onStoreChange);
      else media.removeListener(onStoreChange);
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
