'use client';

import { memo, useMemo } from 'react';
import Sparkline from './Sparkline';
import { fmtMoney } from '@/core/format/currency';
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

function sourceLabel(row: MarketRow) {
  return row.priceSource === 'quote' && row.quoteTime ? `Q ${row.quoteTime.slice(11, 16)}` : row.latestTime;
}

function MarketSummaryStrip({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div
        className="flex items-center px-4 gap-8 overflow-x-auto"
        style={{ background: 'var(--bg-panel-header)', borderTop: '1px solid var(--border)', height: '100%' }}
      >
        {['S&P 500', 'NASDAQ', 'VIX', '10Y YIELD', 'BTC/USD', 'EUR/USD', 'XAU/USD'].map((label) => (
          <div key={label} className="flex flex-col shrink-0">
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.06em' }}>{label}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>—</span>
          </div>
        ))}
      </div>
    );
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => sortRows(rows).slice(0, 12), [rows]);

  const renderItem = (row: MarketRow, key: string) => {
    const chgColor = row.changePct >= 0 ? 'var(--color-up)' : 'var(--color-down)';
    return (
      <div key={key} className="flex items-center gap-2 shrink-0" style={{ paddingTop: 4, paddingBottom: 4 }}>
        <div className="flex flex-col">
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.06em' }}>
            {row.symbol}
          </span>
          <span style={{ fontSize: 'var(--fs-sm)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(row.last, row.currency)}</span>
          <span style={{ color: row.priceSource === 'quote' ? 'var(--color-accent)' : 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
            {sourceLabel(row)}
          </span>
          <span style={{ color: chgColor, fontSize: 'var(--fs-xs)', fontVariantNumeric: 'tabular-nums' }}>
            {row.changePct >= 0 ? '+' : ''}{fmt(row.changePct)}%
          </span>
        </div>
        <Sparkline data={row.spark} width={48} height={22} />
      </div>
    );
  };

  return (
    <div
      className="marquee-mask flex items-center overflow-hidden"
      style={{ background: 'var(--bg-panel-header)', borderTop: '1px solid var(--border)', height: '100%' }}
    >
      <div className="marquee-track flex items-center px-4 gap-6">
        {sorted.map((row) => renderItem(row, row.symbol))}
        {/* duplicate set for seamless wrap-around loop */}
        {sorted.map((row) => renderItem(row, `${row.symbol}-dup`))}
      </div>
      <style jsx>{`
        .marquee-mask:hover .marquee-track {
          animation-play-state: paused;
        }
        .marquee-track {
          flex-shrink: 0;
          min-width: max-content;
          animation: marquee-scroll 40s linear infinite;
          will-change: transform;
        }
        @keyframes marquee-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .marquee-track { animation: none; }
        }
      `}</style>
    </div>
  );
}

export default memo(MarketSummaryStrip);
