'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Explanation text. Plain string; line breaks via \n. */
  text: string;
  /** Optional bold first line in the popover (e.g. the term being explained). */
  term?: string;
}

/**
 * [?] affordance that actually works: click (or hover) opens a styled popover
 * with the explanation; Escape, outside click, or mouse-out closes it.
 * Replaces bare title-attribute tooltips, which users never discover.
 */
export default function InfoTip({ text, term }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef  = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <span
      ref={wrapRef}
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => {
        hoverTimer.current = setTimeout(() => setOpen(true), 250);
      }}
      onMouseLeave={() => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        setOpen(false);
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label={term ? `explain ${term}` : 'explain'}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--color-accent)',
          cursor: 'help',
          fontFamily: 'var(--font-mono)',
          fontSize: 'inherit',
          padding: '0 2px',
        }}
      >
        [?]
      </button>
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 400,
            marginTop: 4,
            width: 300,
            background: 'var(--bg-panel)',
            border: '1px solid var(--color-accent)',
            padding: '8px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-primary)',
            lineHeight: 1.5,
            whiteSpace: 'pre-line',
            textAlign: 'left',
            letterSpacing: 'normal',
            fontWeight: 400,
            display: 'block',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
          }}
        >
          {term && (
            <span style={{ color: 'var(--color-accent)', fontWeight: 700, display: 'block', marginBottom: 4 }}>
              {term}
            </span>
          )}
          {text}
        </span>
      )}
    </span>
  );
}
