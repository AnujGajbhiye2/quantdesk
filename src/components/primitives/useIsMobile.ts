'use client';

import { useEffect, useState } from 'react';

const BREAKPOINT = 1024; // px - matches Tailwind lg:

/**
 * Returns true when the viewport is narrower than the md breakpoint (768px).
 * SSR-safe: defaults to false so the desktop layout hydrates without mismatch.
 * Subscribes to matchMedia changes so it reacts to window resize.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${BREAKPOINT - 1}px)`);
    setIsMobile(mq.matches);

    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}
