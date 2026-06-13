'use client';

import { memo } from 'react';
import { useRouter } from 'next/navigation';
import Panel from '@/components/primitives/Panel';
import EmptyState from '@/components/primitives/EmptyState';
import { useTableSort } from '@/hooks/useTableSort';
import { fmtMoney } from '@/core/format/currency';
import type { PaperTradeWithHold } from '@/core/paper/hold';

/** Map of tradeId -> mark data for open positions (from mark action). */
export type MarksMap = Map<string, { unrealizedPnl: number; unrealizedPnlPct: number; markPrice: number }>;

interface Props {
  trades: PaperTradeWithHold[];
  marks?: MarksMap;
}

function pnlColor(v: number | undefined) {
  if (v == null || !isFinite(v)) return 'var(--text-muted)';
  return v >= 0 ? 'var(--color-up)' : 'var(--color-down)';
}

function fmtDate(s: string | undefined) {
  if (!s) return '--';
  return s.slice(0, 10);
}

function fmt(n: number | undefined, dec = 2) {
  if (n == null || !isFinite(n)) return '--';
  return n.toFixed(dec);
}

/** 'Jun 18 - Jun 24' from two ISO dates. */
function fmtRange(a: string, b: string): string {
  const f = (s: string) =>
    new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', timeZone: 'UTC',
    });
  return `${f(a)} - ${f(b)}`;
}

/** Hold cell: open trades show the historical-median estimate; closed show actual days. */
function holdCell(t: PaperTradeWithHold): { text: string; title: string } {
  if (t.status === 'open') {
    if (!t.estHold) return { text: '--', title: 'no edge data yet - run a few backtests or wait for the nightly edge compute' };
    const { medianHoldBars, earliest, latest, source, sampleSize } = t.estHold;
    return {
      text:  `~${medianHoldBars}d (${fmtRange(earliest, latest)})`,
      title: `historical median winner hold, ${source === 'symbol' ? 'this symbol' : 'whole universe'}, ${sampleSize} trades - not a forecast`,
    };
  }
  if (t.exitTime) {
    const days = Math.round(
      (new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()) / 86_400_000,
    );
    return { text: `${days}d`, title: 'actual calendar days held' };
  }
  return { text: '--', title: '' };
}

function TradesPanel({ trades, marks }: Props) {
  const router = useRouter();
  const recent = [...trades].reverse().slice(0, 20);
  const { sorted, clickHeader, indicator } = useTableSort(recent, {
    date:   (t) => t.entryTime,
    symbol: (t) => t.symbol,
    pnl:    (t) => (t.status === 'open' ? marks?.get(t.id)?.unrealizedPnl : t.pnl) ?? null,
  });
  const sortableTh = (key: 'date' | 'symbol' | 'pnl', label: string, align: 'left' | 'right') => (
    <th
      onClick={() => clickHeader(key)}
      title="click to sort"
      style={{ textAlign: align, padding: '2px 4px', fontWeight: indicator(key) ? 700 : 400, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {label}{indicator(key)}
    </th>
  );

  return (
    <Panel
      title="RECENT / PAPER TRADES"
      className="h-full"
      subtitle="Your track record in the making. ~ = unrealized (marked to CUR price). Stops, targets and the 21-bar max hold auto-close nightly."
      info="Your paper trade book - the track record this terminal is building for you. ~ values are unrealized, marked to the latest close. EST HOLD on open trades = the strategy's historical median winner hold time (not a forecast); stops, targets and the max-hold cap are auto-closed by the nightly sweep."
      headerRight={<span>DATE · SYMBOL · SIDE · ENTRY · EXIT · P&amp;L</span>}
    >
      {recent.length === 0 ? (
        <EmptyState message="— no trades —" hint="open a paper trade via POST /api/paper" />
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
              {sortableTh('date', 'DATE', 'left')}
              {sortableTh('symbol', 'SYMBOL', 'left')}
              <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 400 }}>STRATEGY</th>
              <th style={{ textAlign: 'center', padding: '2px 4px', fontWeight: 400 }}>SIDE</th>
              <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 400 }}>ENTRY</th>
              <th
                style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 400 }}
                title="latest stored close for open trades - what the position is worth right now"
              >
                CUR
              </th>
              <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 400 }}>EXIT</th>
              <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 400 }}>QTY</th>
              {sortableTh('pnl', 'P&L', 'right')}
              <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 400 }}>P&amp;L%</th>
              <th
                style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 400 }}
                title="open: historical median winner hold time (not a forecast); closed: actual days held"
              >
                EST HOLD
              </th>
              <th style={{ textAlign: 'center', padding: '2px 4px', fontWeight: 400 }}>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => {
              const sideColor   = t.side === 'long' ? 'var(--color-up)' : 'var(--color-down)';
              const statusColor = t.status === 'open' ? 'var(--color-accent)' : 'var(--text-muted)';
              const cur         = t.currency ?? 'USD';
              const mark        = t.status === 'open' ? marks?.get(t.id) : undefined;
              // For open trades show MTM unrealized P&L; for closed show realized P&L
              const displayPnl    = mark != null ? mark.unrealizedPnl    : t.pnl;
              const displayPnlPct = mark != null ? mark.unrealizedPnlPct : t.pnlPct;
              const isMtm         = mark != null;
              const hold          = holdCell(t);

              return (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '2px 4px', color: 'var(--text-muted)' }}>{fmtDate(t.entryTime)}</td>
                  <td
                    style={{ padding: '2px 4px', color: 'var(--color-accent)', fontWeight: 600, cursor: 'pointer' }}
                    title={`backtest ${t.symbol}`}
                    onClick={() => router.push(`/backtest?symbol=${t.symbol}`)}
                  >
                    {t.symbol}
                  </td>
                  <td style={{ padding: '2px 4px', color: 'var(--text-muted)' }}>{t.strategyId}</td>
                  <td style={{ padding: '2px 4px', textAlign: 'center', color: sideColor, fontWeight: 600 }}>
                    {t.side.toUpperCase()}
                  </td>
                  <td style={{ padding: '2px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoney(t.entryPrice, cur)}
                  </td>
                  <td style={{ padding: '2px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: mark != null ? pnlColor(mark.unrealizedPnl) : 'var(--text-muted)' }}>
                    {mark != null ? fmtMoney(mark.markPrice, cur) : '--'}
                  </td>
                  <td style={{ padding: '2px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                    {t.exitPrice != null ? fmtMoney(t.exitPrice, cur) : '--'}
                  </td>
                  <td style={{ padding: '2px 4px', textAlign: 'right', color: 'var(--text-muted)' }}>
                    {fmt(t.qty, 4)}
                  </td>
                  <td style={{ padding: '2px 4px', textAlign: 'right', color: pnlColor(displayPnl), fontVariantNumeric: 'tabular-nums' }}>
                    {displayPnl != null
                      ? `${isMtm ? '~' : ''}${displayPnl >= 0 ? '+' : ''}${fmtMoney(displayPnl, cur)}`
                      : '--'}
                  </td>
                  <td style={{ padding: '2px 4px', textAlign: 'right', color: pnlColor(displayPnlPct), fontVariantNumeric: 'tabular-nums' }}>
                    {displayPnlPct != null
                      ? `${isMtm ? '~' : ''}${displayPnlPct >= 0 ? '+' : ''}${fmt(displayPnlPct)}%`
                      : '--'}
                  </td>
                  <td
                    style={{ padding: '2px 4px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
                    title={hold.title}
                  >
                    {hold.text}
                  </td>
                  <td style={{ padding: '2px 4px', textAlign: 'center', color: statusColor }}>
                    {t.status.toUpperCase()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

export default memo(TradesPanel);
