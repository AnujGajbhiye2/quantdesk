'use client';

import { useState, useCallback, useEffect } from 'react';

interface UseKeyboardNavOpts {
  count:          number;         // total number of items
  onActivate?:    (i: number) => void;
  onCommand?:     () => void;     // '/' pressed
  onGoToSymbol?:  () => void;     // 'g' pressed
  onScanAll?:     () => void;     // 's' pressed
  onWatchlist?:   () => void;     // 'w' pressed
  onPin?:         (i: number) => void; // 'p' pressed with a row selected
  onFocusIdeas?:  () => void;     // 'i' pressed
  onTabSwitch?:   (idx: number) => void; // '1'/'2'/'3' pressed - tab index 0..2
  onEscape?:      () => void;     // Escape pressed (after deselect)
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
 * s              - run all-strategies scan
 * w              - toggle watchlist sidebar
 * p              - pin/unpin selected row to watchlist
 * i              - toggle trade-ideas panel focus
 * 1 / 2 / 3      - switch to tab index 0/1/2 (onTabSwitch)
 * Escape         - deselect (then onEscape, e.g. to exit a focus zone)
 *
 * Multiple instances may be mounted at once (one per focusable panel);
 * exactly one should have enabled=true so a single j/k/Enter handler is live.
 *
 * Returns: { selected, setSelected }
 */
export function useKeyboardNav({
  count,
  onActivate,
  onCommand,
  onGoToSymbol,
  onScanAll,
  onWatchlist,
  onPin,
  onFocusIdeas,
  onTabSwitch,
  onEscape,
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
        case 's':
          if (!inInput) {
            e.preventDefault();
            onScanAll?.();
          }
          break;
        case 'w':
          if (!inInput) {
            e.preventDefault();
            onWatchlist?.();
          }
          break;
        case 'p':
          if (!inInput && selected >= 0) {
            e.preventDefault();
            onPin?.(selected);
          }
          break;
        case 'i':
          if (!inInput) {
            e.preventDefault();
            onFocusIdeas?.();
          }
          break;
        case '1':
        case '2':
        case '3':
          if (!inInput) {
            e.preventDefault();
            onTabSwitch?.(Number(e.key) - 1);
          }
          break;
        case 'Escape':
          setSelected(-1);
          onEscape?.();
          break;
      }
    },
    [count, enabled, onActivate, onCommand, onGoToSymbol, onScanAll, onWatchlist, onPin, onFocusIdeas, onTabSwitch, onEscape, selected],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  return { selected, setSelected };
}
