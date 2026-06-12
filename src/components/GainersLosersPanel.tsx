'use client';

import { useRouter } from 'next/navigation';
import Panel from './Panel';
import EmptyState from './EmptyState';
import { fmtMoney } from '@/core/format/currency';
import type { MarketRow } from '@/core/market/snapshot';

interface Props {
  rows: MarketRow[];
}

function fmt(n: number) {
  return isFinite(n) ? n.toFixed(2) : '--';
}

function MiniTable({ items, positive }: { items: MarketRow[]; positive: boolean }) {
  const router = useRouter();
  if (items.length === 0) {
    return <EmptyState message="— no data —" />;
  }
  const color = positive ? 'var(--color-up)' : 'var(--color-down)';
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
      <tbody>
        {items.map((row) => (
          <tr
            key={row.symbol}
            onClick={() => router.push(`/backtest?symbol=${row.symbol}`)}
            title={`backtest ${row.symbol}`}
            style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
          >
            <td style={{ padding: '2px 6px', color: 'var(--color-accent)', fontWeight: 600 }}>{row.symbol}</td>
            <td
              style={{
                padding: '2px 6px',
                color: 'var(--text-muted)',
                maxWidth: '100px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {row.name}
            </td>
            <td style={{ padding: '2px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(row.last, row.currency)}</td>
            <td style={{ padding: '2px 6px', textAlign: 'right', color }}>
              {row.changePct >= 0 ? '+' : ''}{fmt(row.changePct)}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const TOP_N = 10;

export default function GainersLosersPanel({ rows }: Props) {
  const sorted  = [...rows].filter((r) => isFinite(r.changePct)).sort((a, b) => b.changePct - a.changePct);
  const gainers = sorted.slice(0, TOP_N);
  const losers  = [...sorted].reverse().slice(0, TOP_N);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ gap: '1px', background: 'var(--border)' }}>
      <Panel
        title="TOP GAINERS"
        className="flex-1"
        subtitle="Today's biggest risers - momentum candidates. Click to backtest."
        info="Biggest risers today in the current market filter - momentum candidates worth a backtest. Click a row to open it."
      >
        <MiniTable items={gainers} positive />
      </Panel>
      <Panel
        title="TOP LOSERS"
        className="flex-1"
        subtitle="Today's biggest fallers - mean-reversion candidates. Click to backtest."
        info="Biggest fallers today - mean-reversion candidates or names to avoid. Click a row to backtest."
      >
        <MiniTable items={losers} positive={false} />
      </Panel>
    </div>
  );
}
