'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Drop-in replacement for useState that persists to localStorage.
 *
 * SSR-safe: component initializes to `initial` on first render (so server and
 * client HTML match), then hydrates from localStorage on mount.
 *
 * Keys should be versioned (e.g. "qd.v1.foo") so stale shapes after a schema
 * change degrade cleanly to the default instead of throwing.
 */
export function usePersistedState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(initial);
  // Track whether we've hydrated so we don't overwrite fresh state with stale storage
  const hydrated = useRef(false);

  // Hydrate from localStorage once on mount (client only)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as T;
        setState(parsed);
      }
    } catch {
      // Corrupt or missing entry - stay with initial value
    }
    hydrated.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist every change after hydration
  useEffect(() => {
    if (!hydrated.current) return;
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Storage full or unavailable - ignore, state still works in-memory
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return [state, setState];
}
