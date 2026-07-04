'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import SymbolTypeahead from './SymbolTypeahead';

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

/**
 * One shared control bar for all four research surfaces
 * (backtest/compare/dossier/recon) - they're one "RESEARCH" entry in the
 * main nav; this row holds the tabs plus the single symbol search shared
 * between them, so searching once carries the symbol to whichever tab you
 * switch to next (recon has no per-symbol view, so the box hides there).
 * Also records the current path so the main nav's RESEARCH link remembers
 * where you left off.
 */
export default function ResearchTabs({ symbol }: { symbol: string }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [input, setInput] = useState(symbol);

  useEffect(() => { saveLastResearchPath(pathname); }, [pathname]);
  useEffect(() => { setInput(symbol); }, [symbol]);

  const activeTab = TABS.find((t) => pathname.startsWith(t.match)) ?? TABS[0];
  const showSearch = activeTab.match !== '/reconcile';

  function pick(sym: string) {
    saveLastSymbol(sym);
    router.push(activeTab.href(sym));
  }

  return (
    <div
      className="flex items-center gap-2 px-4 py-1 shrink-0 flex-wrap"
      style={{ background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}
    >
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.06em' }}>RESEARCH</span>
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
      {showSearch && (
        <SymbolTypeahead
          value={input}
          onChange={setInput}
          onPick={pick}
          width={120}
        />
      )}
    </div>
  );
}
