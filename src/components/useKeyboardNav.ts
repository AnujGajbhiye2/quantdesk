'use client';

import { useState, useCallback, useEffect } from 'react';

interface UseKeyboardNavOpts {
  count:          number;         // total number of items
  onActivate?:    (i: number) => void;
  onCommand?:     () => void;     // '/' pressed
  onGoToSymbol?:  () => void;     // 'g' pressed
  enabled?:       boolean;        // default true
}

/**
 * Keyboard navigation hook for terminal-style lists.
 *
 * j / ArrowDown  - move selection down
 * k / ArrowUp    - move selection up
 * Enter          - activate selected
 * /              - open command bar
 * g              - open go-to-symbol overlay
 * Escape         - deselect
 *
 * Returns: { selected, setSelected }
 */
export function useKeyboardNav({
  count,
  onActivate,
  onCommand,
  onGoToSymbol,
  enabled = true,
}: UseKeyboardNavOpts) {
  const [selected, setSelected] = useState(-1);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;
      // Ignore when focus is inside an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (inInput && e.key !== 'Escape') return;

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          setSelected((s) => (count > 0 ? Math.min(s + 1, count - 1) : -1));
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          setSelected((s) => (count > 0 ? Math.max(s - 1, 0) : -1));
          break;
        case 'Enter':
          if (selected >= 0) onActivate?.(selected);
          break;
        case '/':
          if (!inInput) {
            e.preventDefault();
            onCommand?.();
          }
          break;
        case 'g':
          if (!inInput) {
            e.preventDefault();
            onGoToSymbol?.();
          }
          break;
        case 'Escape':
          setSelected(-1);
          break;
      }
    },
    [count, enabled, onActivate, onCommand, onGoToSymbol, selected],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  return { selected, setSelected };
}
