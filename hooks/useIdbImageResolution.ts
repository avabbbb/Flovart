import { useEffect, useRef, useState } from 'react';
import { isIdbRef, fromIdbRef, getImages } from '../utils/imageDB';

export function useIdbImageResolution(hrefs: string[]): Record<string, string> {
  const cacheRef = useRef<Map<string, string>>(new Map());
  const [resolved, setResolved] = useState<Record<string, string>>({});

  const pending = hrefs.filter(h => isIdbRef(h) && !cacheRef.current.has(h));
  const pendingKey = pending.join('\u0001');

  useEffect(() => {
    if (!pending.length) return;
    let cancelled = false;
    const keys = Array.from(new Set(pending.map(fromIdbRef)));
    getImages(keys).then(map => {
      if (cancelled) return;
      const next = { ...resolved };
      for (const href of pending) {
        const data = map.get(fromIdbRef(href));
        if (data) {
          cacheRef.current.set(href, data);
          next[href] = data;
        }
      }
      setResolved(next);
    });
    return () => { cancelled = true; };
  }, [pendingKey]);

  return resolved;
}
