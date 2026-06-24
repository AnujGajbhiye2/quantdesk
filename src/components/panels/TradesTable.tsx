'use client';

import { useMemo } from 'react';
import Panel from '@/components/primitives/Panel';
import EmptyState from '@/components/primitives/EmptyState';
import { DataTable } from '@/components/table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import type { TradeRecord } from '@/core/backtest/engine';
import { fmtDate } from '@/core/format/date';

type ExitReason = TradeRecord['exitReason'];

const EXIT_BADGE: Record<ExitReason, { text: string; color: string }> = {
  stop:            { text: 'STOP',   color: 'var(--color-down)' },
  target:          { text: 'TARGET', color: 'var(--color-up)' },
  signal:          { text: 'SIGNAL', color: 'var(--color-accent)' },
  time:            { text: 'TIME',   color: 'var(--color-accent)' },
  'end-of-series': { text: 'EOS',    color: 'var(--text-muted)' },
};

const COLUMNS: ColumnDef<TradeRecord, unknown>[] = [
  {
    id: 'idx',
    header: '#',
    cell: ({ row }) => row.index + 1,
  },
  {
    accessorKey: 'side',
    header: 'SIDE',
    cell: ({ getValue }) => {
      const side = getValue() as string;
      return <span style={{ color: side === 'long' ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 700 }}>{side.toUpperCase()}</span>;
    },
  },
  {
    accessorKey: 'entryTime',
    header: 'ENTRY DATE',
    cell: ({ getValue }) => fmtDate(getValue() as string),
  },
  {
    accessorKey: 'entryPrice',
    header: 'ENTRY',
    cell: ({ getValue }) => (getValue() as number).toFixed(2),
    meta: { numeric: true },
  },
  {
    accessorKey: 'exitTime',
    header: 'EXIT DATE',
    cell: ({ getValue }) => fmtDate(getValue() as string),
  },
  {
    accessorKey: 'exitPrice',
    header: 'EXIT',
    cell: ({ getValue }) => (getValue() as number).toFixed(2),
    meta: { numeric: true },
  },
  {
    accessorKey: 'holdingBars',
    header: 'HOLD',
    cell: ({ getValue }) => `${getValue()}d`,
    meta: { numeric: true },
  },
  {
    accessorKey: 'pnlPct',
    header: 'P&L%',
    cell: ({ getValue }) => {
      const v = getValue() as number;
      const color = v >= 0 ? 'var(--color-up)' : 'var(--color-down)';
      return <span style={{ color }}>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</span>;
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'exitReason',
    header: 'EXIT VIA',
    cell: ({ getValue }) => {
      const badge = EXIT_BADGE[getValue() as ExitReason];
      return <span style={{ color: badge.color }}>{badge.text}</span>;
    },
    meta: { align: 'center' },
  },
];

export default function TradesTable({ trades }: { trades: TradeRecord[] }) {
  if (trades.length === 0) {
    return (
      <Panel title="CLOSED TRADES" className="h-full">
        <EmptyState message="— no trades —" hint="strategy produced no fills on this series" />
      </Panel>
    );
  }

  return (
    <Panel
      title={`CLOSED TRADES (${trades.length})`}
      className="h-full"
      info="Every simulated trade the backtest took: fills at the next bar's open, commission and slippage included, worst-case assumed when stop and target hit in the same bar."
    >
      <DataTable
        columns={COLUMNS}
        data={trades}
        dense
        enableSorting
        defaultSort={[{ id: 'entryTime', desc: false }]}
      />
    </Panel>
  );
}
