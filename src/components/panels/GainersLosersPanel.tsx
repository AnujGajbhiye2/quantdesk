'use client';

import { memo, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Panel from '@/components/primitives/Panel';
import EmptyState from '@/components/primitives/EmptyState';
import { DataTable } from '@/components/table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import { fmtMoney } from '@/core/format/currency';
import type { MarketRow } from '@/core/market/snapshot';

interface Props {
  rows: MarketRow[];
}

function fmt(n: number) {
  return isFinite(n) ? n.toFixed(2) : '--';
}

const TOP_N = 10;

function MiniDataTable({ items, positive }: { items: MarketRow[]; positive: boolean }) {
  const router = useRouter();
  const color  = positive ? 'var(--color-up)' : 'var(--color-down)';

  const columns = useMemo<ColumnDef<MarketRow, unknown>[]>(() => [
    {
      accessorKey: 'symbol',
      header: 'SYMBOL',
      meta: { accent: true },
    },
    {
      accessorKey: 'name',
      header: 'NAME',
      cell: ({ getValue }) => (
        <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', maxWidth: 100 }}>
          {getValue() as string}
        </span>
      ),
    },
    {
      id: 'price',
      header: 'PRICE',
      cell: ({ row }) => fmtMoney(row.original.last, row.original.currency),
      meta: { numeric: true },
    },
    {
      accessorKey: 'changePct',
      header: 'CHG%',
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return <span style={{ color }}>{v >= 0 ? '+' : ''}{fmt(v)}%</span>;
      },
      meta: { numeric: true },
    },
  ], [color]);

  if (items.length === 0) {
    return <EmptyState message="— no data —" />;
  }

  return (
    <DataTable
      columns={columns}
      data={items}
      onRowClick={(row) => router.push(`/backtest?symbol=${row.symbol}`)}
    />
  );
}

function GainersLosersPanel({ rows }: Props) {
  const { gainers, losers } = useMemo(() => {
    const sorted = [...rows].filter((r) => isFinite(r.changePct)).sort((a, b) => b.changePct - a.changePct);
    return { gainers: sorted.slice(0, TOP_N), losers: [...sorted].reverse().slice(0, TOP_N) };
  }, [rows]);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ gap: '1px', background: 'var(--border)' }}>
      <Panel
        title="TOP GAINERS"
        className="flex-1"
        subtitle="Today's biggest risers - momentum candidates. Click to backtest."
        info="Biggest risers today in the current market filter - momentum candidates worth a backtest. Click a row to open it."
      >
        <MiniDataTable items={gainers} positive />
      </Panel>
      <Panel
        title="TOP LOSERS"
        className="flex-1"
        subtitle="Today's biggest fallers - mean-reversion candidates. Click to backtest."
        info="Biggest fallers today - mean-reversion candidates or names to avoid. Click a row to backtest."
      >
        <MiniDataTable items={losers} positive={false} />
      </Panel>
    </div>
  );
}

export default memo(GainersLosersPanel);
