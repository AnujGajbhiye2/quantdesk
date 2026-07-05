'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useIsMobile } from './useIsMobile';
import { getLastResearchPath } from './ResearchTabs';
import { useAuth } from '@/components/auth/AuthContext';

// PAPER/JOURNAL show executed trades + performance - visible to any
// logged-in user (read-only). SESSION (ops/ingestion internals) and
// SETTINGS stay admin-only.
const ADMIN_ONLY_HREFS = new Set(['/dashboard/session', '/settings']);

const BASE_LINKS = [
  { href: '/',                   label: 'DASH' },
  { href: '/paper',              label: 'PAPER' },
  { href: '/journal',            label: 'JOURNAL' },
  { href: '/dashboard/session',  label: 'SESSION' },
  { href: '/settings',           label: 'SETTINGS' },
];

/** Sensible always-available fallback when no symbol is in context (e.g. landing on DASH). */
const DEFAULT_DOSSIER_SYMBOL = 'AAPL';

/** BACKTEST/COMPARE/DOSSIER/RECON used to be four separate links; they're one
 *  RESEARCH entry now (ResearchTabs switches between them on the page
 *  itself), pointing at whichever of the four was last visited. */
const RESEARCH_PREFIXES = ['/backtest', '/compare', '/symbol/', '/reconcile'];

export default function AppNav() {
  const pathname  = usePathname();
  const isMobile  = useIsMobile();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef   = useRef<HTMLDivElement>(null);

  // DOSSIER has no fixed URL (route is /symbol/[symbol]) - carry whatever
  // symbol is currently in view (?symbol= on backtest/compare) or fall back
  // to a default, so it's always one click away instead of unreachable from
  // the nav (previous gap: dossier only linked from inside backtest/scan rows).
  // Read via window.location (client-only, after mount) rather than
  // useSearchParams() - that hook requires a Suspense boundary around every
  // page AppNav renders in, which this shared layout component doesn't have.
  const [contextSymbol, setContextSymbol] = useState<string | null>(null);
  const [currentSearch, setCurrentSearch] = useState('');
  const [lastResearchPath, setLastResearchPath] = useState<string | null>(null);
  useEffect(() => {
    setContextSymbol(new URLSearchParams(window.location.search).get('symbol'));
    setCurrentSearch(window.location.search);
    setLastResearchPath(getLastResearchPath());
  }, [pathname]);

  const researchHref = RESEARCH_PREFIXES.some((p) => pathname.startsWith(p))
    ? pathname + currentSearch
    : lastResearchPath ?? `/symbol/${(contextSymbol ?? DEFAULT_DOSSIER_SYMBOL).toUpperCase()}`;

  const LINKS = [
    ...BASE_LINKS.slice(0, 1),
    { href: researchHref, label: 'RESEARCH', matchPrefix: '__research__' },
    ...BASE_LINKS.slice(1),
  ].filter((link) => isAdmin || !ADMIN_ONLY_HREFS.has(link.href));

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

  function isActive(link: { href: string; matchPrefix?: string }) {
    if (link.matchPrefix === '__research__') return RESEARCH_PREFIXES.some((p) => pathname.startsWith(p));
    return link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
  }

  if (!isMobile) {
    return (
      <nav className="flex gap-6" style={{ fontSize: 'var(--fs-sm)' }}>
        {LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            style={{
              color:          isActive(link) ? 'var(--color-accent)' : 'var(--text-muted)',
              textDecoration: 'none',
            }}
          >
            {link.label}
          </a>
        ))}
      </nav>
    );
  }

  const activeLink = LINKS.find((link) => isActive(link));

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
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              style={{
                color:          isActive(link) ? 'var(--color-accent)' : 'var(--text-muted)',
                textDecoration: 'none',
                padding:        '8px 14px',
                fontSize:       'var(--fs-sm)',
                borderBottom:   '1px solid var(--border)',
                fontWeight:     isActive(link) ? 700 : 400,
              }}
            >
              {link.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
