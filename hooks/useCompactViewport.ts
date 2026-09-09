import { useMediaQuery } from './useMediaQuery';

/** @deprecated Prefer useMediaQuery for behavior-specific transitions. */
export function useCompactViewport(maxWidth = 760) {
  return useMediaQuery(`(max-width: ${maxWidth}px)`);
}
