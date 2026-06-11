/**
 * SSR-safe matchMedia hook. Starts `false` (server + first client render) and flips on mount,
 * so the calendar can default to its agenda-first mobile layout below Tailwind's `md`.
 */
import { useEffect, useState } from 'react';

export function useIsMobile(query: string = '(max-width: 767px)'): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);

  return isMobile;
}
