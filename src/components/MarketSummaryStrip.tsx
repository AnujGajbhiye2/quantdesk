'use client';

import Sparkline from './Sparkline';
import type { MarketRow } from '@/core/market/snapshot';

interface Props {
  rows: MarketRow[];
}

// Symbols that conventionally appear in the market summary strip.
// Show whatever is in the DB; these are just preferred ordering.
const PREFERRED = ['SPY', '^GSPC', 'QQQ', '^NDX', '^VIX', '^TNX', 'BTC-USD', 'EURUSD=X', 'GC=F'];

function sortRows(rows: MarketRow[]): MarketRow[] {
  const preferred: MarketRow[] = [];
  const rest: MarketRow[] = [];
  for (const sym of PREFERRED) {
    const r = rows.find((r) => r.symbol === sym);
    if (r) preferred.push(r);
  }
  for (const r of rows) {
    if (!PREFERRED.includes(r.symbol)) rest.push(r);
  }
  return [...preferred, ...rest];
}

function fmt(n: number) {
  return isFinite(n) ? n.toFixed(2) : '--';
}

export default function MarketSummaryStrip({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div
        className="col-span-2 flex items-center px-4 gap-8 overflow-x-auto"
        style={{ background: 'var(--bg-panel-header)', borderTop: '1px solid var(--border)', height: '100%' }}
      >
        {['S&P 500', 'NASDAQ', 'VIX', '10Y YIELD', 'BTC/USD', 'EUR/USD', 'XAU/USD'].map((label) => (
          <div key={label} className="flex flex-col shrink-0">
            <span style={{ color: 'var(--text-muted)', fontSize: '10px', letterSpacing: '0.06em' }}>{label}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>—</span>
          </div>
        ))}
      </div>
    );
  }

  const sorted = sortRows(rows).slice(0, 12);

  return (
    <div
      className="col-span-2 flex items-center px-4 gap-6 overflow-x-auto"
      style={{ background: 'var(--bg-panel-header)', borderTop: '1px solid var(--border)', height: '100%' }}
    >
      {sorted.map((row) => {
        const chgColor = row.changePct >= 0 ? 'var(--color-up)' : 'var(--color-down)';
        return (
          <div key={row.symbol} className="flex items-center gap-2 shrink-0" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <div className="flex flex-col">
              <span style={{ color: 'var(--text-muted)', fontSize: '9px', letterSpacing: '0.06em' }}>
                {row.symbol}
              </span>
              <span style={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>{fmt(row.last)}</span>
              <span style={{ color: chgColor, fontSize: '10px', fontVariantNumeric: 'tabular-nums' }}>
                {row.changePct >= 0 ? '+' : ''}{fmt(row.changePct)}%
              </span>
            </div>
            <Sparkline data={row.spark} width={48} height={22} />
          </div>
        );
      })}
    </div>
  );
}
