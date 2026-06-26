'use client';

import type { ReactNode } from 'react';
import AppNav from './AppNav';

interface AppHeaderProps {
  /** Expanding center slot - sits between brand/nav and right controls. */
  center?: ReactNode;
  /** Per-page controls rendered on the right. */
  right?: ReactNode;
  /** Keyboard shortcut hints or page context, shown after nav. Hidden on mobile. */
  hint?: ReactNode;
}

export default function AppHeader({ center, right, hint }: AppHeaderProps) {
  return (
    <div
      className="flex items-center justify-between px-4 shrink-0 gap-3"
      style={{
        background:   'var(--bg-panel-header)',
        borderBottom: '1px solid var(--border)',
        minHeight:    40,
      }}
    >
      {/* Left: brand + nav + hint */}
      <div className="flex items-center gap-4 shrink-0">
        <span
          style={{
            color:         'var(--color-accent)',
            fontWeight:    700,
            letterSpacing: '0.1em',
            fontSize:      'var(--fs-sm)',
            flexShrink:    0,
          }}
        >
          QUANTDESK
        </span>
        <AppNav />
        {hint && (
          <span className="hidden lg:block" style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
            {hint}
          </span>
        )}
      </div>

      {/* Center: expanding content (forms, search bars) */}
      {center && (
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {center}
        </div>
      )}

      {/* Right: controls */}
      {right && (
        <div className="flex items-center gap-2 shrink-0">
          {right}
        </div>
      )}
    </div>
  );
}
