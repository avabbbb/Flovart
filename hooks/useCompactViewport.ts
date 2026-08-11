import { useEffect, useState } from 'react';

export function useCompactViewport(maxWidth = 767) {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth <= maxWidth);
  useEffect(() => {
    const update = () => setCompact(window.innerWidth <= maxWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [maxWidth]);
  return compact;
}
