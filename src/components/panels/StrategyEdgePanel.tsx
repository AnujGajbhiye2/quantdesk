'use client';

import { memo, useMemo } from 'react';
import Panel from '@/components/primitives/Panel';
import EmptyState from '@/components/primitives/EmptyState';
import InfoTip from '@/components/primitives/InfoTip';
import { DataTable } from '@/components/table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import { gloss } from '@/core/glossary';
import type { TradeBook } from '@/core/paper/tradebook';

interface Props {
  book: TradeBook | null;
  backtestWinRates?: Record<string, number>;
}

type Verdict = 'TRUST' | 'WATCH' | 'AVOID';

const MIN_LIVE_TRADES = 10;
const TOLERANCE_PP    = 5;

function verdictOf(
  liveWinRate: number,
  closedTrades: number,
  backtestWinRate: number | undefined,
): { verdict: Verdict; detail: string } {
  if (closedTrades < MIN_LIVE_TRADES) {
    return { verdict: 'WATCH', detail: `only ${closedTrades} closed live trade(s) - need ${MIN_LIVE_TRADES}+ to judge` };
  }
  if (backtestWinRate == null) {
    return { verdict: 'WATCH', detail: 'no backtested edge stats yet - run edge compute' };
  }
  const gapPp = (backtestWinRate - liveWinRate) * 100;
  if (gapPp <= TOLERANCE_PP) {
    return {
      verdict: 'TRUST',
      detail: `live ${(liveWinRate * 100).toFixed(0)}% vs backtest ${(backtestWinRate * 100).toFixed(0)}% - tracking within ${TOLERANCE_PP}pp`,
    };
  }
  return {
    verdict: 'AVOID',
    detail: `live ${(liveWinRate * 100).toFixed(0)}% vs backtest ${(backtestWinRate * 100).toFixed(0)}% - ${gapPp.toFixed(0)}pp worse than promised`,
  };
}

function pnlColor(v: number) {
  if (!isFinite(v)) return 'var(--text-muted)';
  return v >= 0 ? 'var(--color-up)' : 'var(--color-down)';
}

interface EdgeRow {
  id:                string;
  verdict:           Verdict;
  detail:            string;
  closedTrades:      number;
  totalTrades:       number;
  liveWinRate:       number;
  btWinRate:         number | undefined;
  totalPnl:          number;
  openUnrealizedPnl: number;
  avgPnlPct:         number;
}

const COLUMNS: ColumnDef<EdgeRow, unknown>[] = [
  {
    accessorKey: 'id',
    header: 'STRATEGY',
    meta: { accent: true },
  },
  {
    accessorKey: 'verdict',
    header: 'VERDICT',
    cell: ({ row }) => {
      const v = row.original.verdict;
      const color = v === 'TRUST' ? 'var(--color-up)' : v === 'AVOID' ? 'var(--color-down)' : 'var(--color-accent)';
      return <span style={{ color, fontWeight: 700 }} title={row.original.detail}>{v}</span>;
    },
    meta: { align: 'center' },
  },
  {
    id: 'trades',
    header: 'TRADES',
    cell: ({ row }) => {
      const { closedTrades, totalTrades } = row.original;
      return <span style={{ color: 'var(--text-muted)' }}>{closedTrades}/{totalTrades}</span>;
    },
    meta: { align: 'right' },
  },
  {
    accessorKey: 'liveWinRate',
    header: 'LIVE WIN%',
    cell: ({ row }) => {
      const { closedTrades, liveWinRate } = row.original;
      return <span style={{ fontWeight: 600 }}>{closedTrades > 0 ? `${(liveWinRate * 100).toFixed(1)}%` : '--'}</span>;
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'btWinRate',
    header: 'BT WIN%',
    cell: ({ getValue }) => {
      const bt = getValue() as number | undefined;
      return <span style={{ color: 'var(--text-muted)' }}>{bt != null ? `${(bt * 100).toFixed(1)}%` : '--'}</span>;
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'totalPnl',
    header: 'P&L (CLOSED)',
    cell: ({ getValue }) => {
      const v = getValue() as number;
      const fmt = !isFinite(v) ? '--' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
      return <span style={{ color: pnlColor(v), fontVariantNumeric: 'tabular-nums' }}>{fmt}</span>;
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'openUnrealizedPnl',
    header: 'MTM (OPEN)',
    cell: ({ getValue }) => {
      const v = getValue() as number;
      if (v === 0) return <span style={{ color: 'var(--text-muted)' }}>--</span>;
      const fmt = `~${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
      return <span style={{ color: pnlColor(v), fontVariantNumeric: 'tabular-nums' }}>{fmt}</span>;
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'avgPnlPct',
    header: 'AVG P&L%',
    cell: ({ getValue }) => {
      const v = getValue() as number;
      const fmt = `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
      return <span style={{ color: pnlColor(v), fontVariantNumeric: 'tabular-nums' }}>{fmt}</span>;
    },
    meta: { numeric: true },
  },
];

function StrategyEdgePanel({ book, backtestWinRates = {} }: Props) {
  const rows = useMemo<EdgeRow[]>(() => {
    if (!book) return [];
    return Object.entries(book.byStrategy)
      .sort((a, b) => b[1].winRate - a[1].winRate)
      .map(([id, stats]) => {
        const { verdict, detail } = verdictOf(stats.winRate, stats.closedTrades, backtestWinRates[id]);
        return {
          id,
          verdict,
          detail,
          closedTrades:      stats.closedTrades,
          totalTrades:       stats.trades,
          liveWinRate:       stats.winRate,
          btWinRate:         backtestWinRates[id],
          totalPnl:          stats.totalPnl,
          openUnrealizedPnl: stats.openUnrealizedPnl,
          avgPnlPct:         stats.avgPnlPct,
        };
      });
  }, [book, backtestWinRates]);

  if (!book) {
    return (
      <Panel title="STRATEGY EDGE" className="h-full">
        <EmptyState message="- loading -" />
      </Panel>
    );
  }

  if (rows.length === 0) {
    return (
      <Panel
        title="STRATEGY EDGE"
        className="h-full"
        subtitle="Live scorecard: do strategies deliver in practice what their backtests promised? Builds as you take ideas."
        headerRight={<span>no paper trades yet</span>}
      >
        <EmptyState message="- no trades -" hint="run a scan and take ideas to build a track record" />
      </Panel>
    );
  }

  return (
    <Panel
      title="STRATEGY EDGE"
      className="h-full"
      subtitle="Live results vs backtest per strategy. TRUST = follow it; AVOID = the edge did not survive reality; WATCH = not enough live trades yet."
      info={gloss('strategyEdge').text}
      headerRight={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          VERDICT · WIN RATE · P&L
          <InfoTip term={gloss('trustVerdict').term} text={gloss('trustVerdict').text} />
        </span>
      }
    >
      <DataTable columns={COLUMNS} data={rows} enableSorting />
    </Panel>
  );
}

export default memo(StrategyEdgePanel);
