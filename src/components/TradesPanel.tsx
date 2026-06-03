'use client';

import Panel from './Panel';
import EmptyState from './EmptyState';
import { fmtMoney } from '@/core/format/currency';
import type { PaperTrade } from '@/core/types';

/** Map of tradeId -> unrealized P&L for open positions (from mark action). */
export type MarksMap = Map<string, { unrealizedPnl: number; unrealizedPnlPct: number }>;

interface Props {
  trades: PaperTrade[];
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

export default function TradesPanel({ trades, marks }: Props) {
  const recent = [...trades].reverse().slice(0, 20);

  return (
    <Panel
      title="RECENT / PAPER TRADES"
      className="h-full"
      headerRight={<span>DATE · SYMBOL · SIDE · ENTRY · EXIT · P&amp;L</span>}
    >
      {recent.length === 0 ? (
        <EmptyState message="— no trades —" hint="open a paper trade via POST /api/paper" />
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 400 }}>DATE</th>
              <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 400 }}>SYMBOL</th>
              <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 400 }}>STRATEGY</th>
              <th style={{ textAlign: 'center', padding: '2px 4px', fontWeight: 400 }}>SIDE</th>
              <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 400 }}>ENTRY</th>
              <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 400 }}>EXIT</th>
              <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 400 }}>QTY</th>
              <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 400 }}>P&amp;L</th>
              <th style={{ textAlign: 'right', padding: '2px 4px', fontWeight: 400 }}>P&amp;L%</th>
              <th style={{ textAlign: 'center', padding: '2px 4px', fontWeight: 400 }}>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((t) => {
              const sideColor   = t.side === 'long' ? 'var(--color-up)' : 'var(--color-down)';
              const statusColor = t.status === 'open' ? 'var(--color-accent)' : 'var(--text-muted)';
              const cur         = t.currency ?? 'USD';
              const mark        = t.status === 'open' ? marks?.get(t.id) : undefined;
              // For open trades show MTM unrealized P&L; for closed show realized P&L
              const displayPnl    = mark != null ? mark.unrealizedPnl    : t.pnl;
              const displayPnlPct = mark != null ? mark.unrealizedPnlPct : t.pnlPct;
              const isMtm         = mark != null;

              return (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '2px 4px', color: 'var(--text-muted)' }}>{fmtDate(t.entryTime)}</td>
                  <td style={{ padding: '2px 4px', color: 'var(--color-accent)', fontWeight: 600 }}>{t.symbol}</td>
                  <td style={{ padding: '2px 4px', color: 'var(--text-muted)' }}>{t.strategyId}</td>
                  <td style={{ padding: '2px 4px', textAlign: 'center', color: sideColor, fontWeight: 600 }}>
                    {t.side.toUpperCase()}
                  </td>
                  <td style={{ padding: '2px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoney(t.entryPrice, cur)}
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
