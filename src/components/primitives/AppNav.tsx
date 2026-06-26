'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useIsMobile } from './useIsMobile';

const LINKS = [
  { href: '/',                   label: 'DASH' },
  { href: '/backtest',           label: 'BACKTEST' },
  { href: '/compare',            label: 'COMPARE' },
  { href: '/paper',              label: 'PAPER' },
  { href: '/journal',            label: 'JOURNAL' },
  { href: '/dashboard/session',  label: 'SESSION' },
  { href: '/settings',           label: 'SETTINGS' },
];

export default function AppNav() {
  const pathname  = usePathname();
  const isMobile  = useIsMobile();
  const [open, setOpen] = useState(false);
  const menuRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  function isActive(href: string) {
    return href === '/' ? pathname === '/' : pathname.startsWith(href);
  }

  if (!isMobile) {
    return (
      <nav className="flex gap-6" style={{ fontSize: 'var(--fs-sm)' }}>
        {LINKS.map(({ href, label }) => (
          <a
            key={href}
            href={href}
            style={{
              color:          isActive(href) ? 'var(--color-accent)' : 'var(--text-muted)',
              textDecoration: 'none',
            }}
          >
            {label}
          </a>
        ))}
      </nav>
    );
  }

  const activeLink = LINKS.find(({ href }) => isActive(href));

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background:    'none',
          border:        '1px solid var(--border)',
          color:         'var(--color-accent)',
          fontFamily:    'var(--font-mono)',
          fontSize:      'var(--fs-xs)',
          padding:       '3px 8px',
          cursor:        'pointer',
          letterSpacing: '0.06em',
          display:       'flex',
          alignItems:    'center',
          gap:           6,
        }}
        aria-label="Navigation menu"
        aria-expanded={open}
      >
        <span style={{ fontSize: 14, lineHeight: 1 }}>☰</span>
        {activeLink && (
          <span style={{ color: 'var(--color-accent)' }}>{activeLink.label}</span>
        )}
      </button>

      {open && (
        <div
          style={{
            position:    'absolute',
            top:         'calc(100% + 4px)',
            left:        0,
            zIndex:      200,
            background:  'var(--bg-panel-header)',
            border:      '1px solid var(--border)',
            minWidth:    140,
            display:     'flex',
            flexDirection: 'column',
          }}
        >
          {LINKS.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              style={{
                color:          isActive(href) ? 'var(--color-accent)' : 'var(--text-muted)',
                textDecoration: 'none',
                padding:        '8px 14px',
                fontSize:       'var(--fs-sm)',
                borderBottom:   '1px solid var(--border)',
                fontWeight:     isActive(href) ? 700 : 400,
              }}
            >
              {label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
