'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const LAST_PATH_KEY   = 'qd-last-research-path';
const LAST_SYMBOL_KEY = 'qd-last-symbol';

export function saveLastResearchPath(path: string) {
  try { localStorage.setItem(LAST_PATH_KEY, path); } catch { /* ignore */ }
}
export function getLastResearchPath(): string | null {
  try { return localStorage.getItem(LAST_PATH_KEY); } catch { return null; }
}
export function saveLastSymbol(sym: string) {
  if (!sym) return;
  try { localStorage.setItem(LAST_SYMBOL_KEY, sym.toUpperCase()); } catch { /* ignore */ }
}
export function getLastSymbol(): string | null {
  try { return localStorage.getItem(LAST_SYMBOL_KEY); } catch { return null; }
}

const TABS = [
  { match: '/backtest',  label: 'BACKTEST',  href: (sym: string) => sym ? `/backtest?symbol=${sym}` : '/backtest' },
  { match: '/compare',   label: 'COMPARE',   href: (sym: string) => sym ? `/compare?symbol=${sym}`  : '/compare' },
  { match: '/symbol/',   label: 'DOSSIER',   href: (sym: string) => `/symbol/${sym || 'AAPL'}` },
  { match: '/reconcile', label: 'RECON',     href: () => '/reconcile' },
] as const;

/** Sub-nav strip shared by the three research surfaces (backtest/compare/dossier) -
 *  they're one "RESEARCH" entry in the main nav, this switches between them
 *  while keeping whatever symbol is in view. Also records the current path so
 *  the main nav's RESEARCH link remembers where you left off. */
export default function ResearchTabs({ symbol }: { symbol: string }) {
  const pathname = usePathname();

  useEffect(() => { saveLastResearchPath(pathname); }, [pathname]);

  return (
    <div className="flex items-center gap-1 shrink-0">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.match);
        return (
          <a
            key={t.match}
            href={t.href(symbol)}
            style={{
              padding:        '2px 8px',
              border:         `1px solid ${active ? 'var(--color-accent)' : 'var(--border)'}`,
              color:          active ? 'var(--color-accent)' : 'var(--text-muted)',
              fontWeight:     active ? 700 : 400,
              fontSize:       'var(--fs-xs)',
              fontFamily:     'var(--font-mono)',
              textDecoration: 'none',
              whiteSpace:     'nowrap',
            }}
          >
            {t.label}
          </a>
        );
      })}
    </div>
  );
}
