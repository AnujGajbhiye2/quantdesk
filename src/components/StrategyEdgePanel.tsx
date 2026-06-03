'use client';

import Panel from './Panel';
import EmptyState from './EmptyState';
import type { TradeBook } from '@/core/paper/tradebook';

interface Props {
  book: TradeBook | null;
}

function fmtPnl(v: number) {
  if (!isFinite(v)) return '--';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

function pnlColor(v: number) {
  if (!isFinite(v)) return 'var(--text-muted)';
  return v >= 0 ? 'var(--color-up)' : 'var(--color-down)';
}

export default function StrategyEdgePanel({ book }: Props) {
  if (!book) {
    return (
      <Panel title="STRATEGY EDGE" className="h-full">
        <EmptyState message="- loading -" />
      </Panel>
    );
  }

  const entries = Object.entries(book.byStrategy)
    .sort((a, b) => b[1].winRate - a[1].winRate);

  if (entries.length === 0) {
    return (
      <Panel title="STRATEGY EDGE" className="h-full" headerRight={<span>no paper trades yet</span>}>
        <EmptyState message="- no trades -" hint="run a scan and take ideas to build a track record" />
      </Panel>
    );
  }

  const headerRight = (
    <span>WIN RATE · REALIZED P&amp;L · OPEN MTM</span>
  );

  return (
    <Panel title="STRATEGY EDGE" className="h-full" headerRight={headerRight}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
        <thead>
          <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left',   padding: '2px 6px', fontWeight: 400 }}>STRATEGY</th>
            <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>TRADES</th>
            <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>WIN%</th>
            <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>P&amp;L (CLOSED)</th>
            <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>MTM (OPEN)</th>
            <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>AVG P&amp;L%</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([id, stats]) => (
            <tr key={id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '2px 6px', color: 'var(--color-accent)', fontWeight: 600 }}>{id}</td>
              <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>{stats.trades}</td>
              <td style={{ padding: '2px 6px', textAlign: 'right', fontWeight: 600 }}>
                {(stats.winRate * 100).toFixed(1)}%
              </td>
              <td style={{ padding: '2px 6px', textAlign: 'right', color: pnlColor(stats.totalPnl), fontVariantNumeric: 'tabular-nums' }}>
                {fmtPnl(stats.totalPnl)}
              </td>
              <td style={{ padding: '2px 6px', textAlign: 'right', color: pnlColor(stats.openUnrealizedPnl), fontVariantNumeric: 'tabular-nums' }}>
                {stats.openUnrealizedPnl !== 0 ? `~${fmtPnl(stats.openUnrealizedPnl)}` : '--'}
              </td>
              <td style={{ padding: '2px 6px', textAlign: 'right', color: pnlColor(stats.avgPnlPct), fontVariantNumeric: 'tabular-nums' }}>
                {`${stats.avgPnlPct >= 0 ? '+' : ''}${stats.avgPnlPct.toFixed(2)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
