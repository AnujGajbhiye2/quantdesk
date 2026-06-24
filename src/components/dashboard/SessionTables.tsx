'use client';

/**
 * Client-side table components for session/page.tsx (server component).
 * Server passes serializable row data; columns + rendering defined here.
 */

import { DataTable } from '@/components/table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';

// ---------------------------------------------------------------------------
// Ingest errors table
// ---------------------------------------------------------------------------

export interface IngestErrorRow { symbol: string; error: string }

const INGEST_ERROR_COLS: ColumnDef<IngestErrorRow, unknown>[] = [
  { accessorKey: 'symbol', header: 'SYMBOL', meta: { accent: true } },
  {
    accessorKey: 'error',
    header: 'ERROR',
    cell: ({ getValue }) => <span style={{ color: 'var(--color-down)' }}>{getValue() as string}</span>,
  },
];

export function IngestErrorsTable({ errors }: { errors: IngestErrorRow[] }) {
  return <DataTable columns={INGEST_ERROR_COLS} data={errors} dense />;
}

// ---------------------------------------------------------------------------
// Ingest runs table
// ---------------------------------------------------------------------------

export interface IngestRunRow {
  id:           number;
  finishedAt:   string;
  trigger:      string;
  totalSymbols: number;
  totalBars:    number;
  errorCount:   number;
  durationMs:   number;
}

const INGEST_RUN_COLS: ColumnDef<IngestRunRow, unknown>[] = [
  {
    accessorKey: 'finishedAt',
    header: 'DATE',
    cell: ({ getValue }) => (getValue() as string).slice(0, 10),
  },
  {
    accessorKey: 'trigger',
    header: 'TRIGGER',
    cell: ({ getValue }) => <span style={{ color: 'var(--text-muted)' }}>{getValue() as string}</span>,
  },
  { accessorKey: 'totalSymbols', header: 'SYMBOLS', meta: { numeric: true } },
  {
    accessorKey: 'totalBars',
    header: 'NEW BARS',
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return <span style={{ color: v > 0 ? 'var(--color-up)' : 'var(--text-muted)' }}>{v}</span>;
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'errorCount',
    header: 'ERRORS',
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return <span style={{ color: v > 0 ? 'var(--color-down)' : 'var(--color-up)' }}>{v}</span>;
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'durationMs',
    header: 'DURATION',
    cell: ({ getValue }) => <span style={{ color: 'var(--text-muted)' }}>{getValue() as number}ms</span>,
    meta: { numeric: true },
  },
];

export function IngestRunsTable({ runs }: { runs: IngestRunRow[] }) {
  return <DataTable columns={INGEST_RUN_COLS} data={runs} dense />;
}

// ---------------------------------------------------------------------------
// Open positions table
// ---------------------------------------------------------------------------

export interface OpenPositionRow {
  id:          string;
  symbol:      string;
  strategy:    string;
  side:        string;
  entryDate:   string;
  entryPrice:  number;
  current:     number;
  unrealPct:   number;
  days:        number;
  stop:        number | null;
  target:      number | null;
  toStop:      number | null;
  toTarget:    number | null;
}

const OPEN_POS_COLS: ColumnDef<OpenPositionRow, unknown>[] = [
  { accessorKey: 'symbol',   header: 'SYMBOL',     meta: { accent: true } },
  {
    accessorKey: 'strategy',
    header: 'STRATEGY',
    cell: ({ getValue }) => <span style={{ color: 'var(--text-muted)' }}>{getValue() as string}</span>,
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
    accessorKey: 'entryDate',
    header: 'ENTRY DATE',
    cell: ({ getValue }) => (getValue() as string).slice(0, 10),
    meta: { numeric: true },
  },
  {
    accessorKey: 'entryPrice',
    header: 'ENTRY',
    cell: ({ getValue }) => (getValue() as number).toFixed(2),
    meta: { numeric: true },
  },
  {
    accessorKey: 'current',
    header: 'CURRENT',
    cell: ({ getValue }) => (getValue() as number).toFixed(2),
    meta: { numeric: true },
  },
  {
    accessorKey: 'unrealPct',
    header: 'UNREAL %',
    cell: ({ getValue }) => {
      const v = getValue() as number;
      const color = v >= 0 ? 'var(--color-up)' : 'var(--color-down)';
      return <span style={{ color }}>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</span>;
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'days',
    header: 'DAYS',
    cell: ({ getValue }) => `${getValue() as number}d`,
    meta: { numeric: true },
  },
  {
    accessorKey: 'stop',
    header: 'STOP',
    cell: ({ getValue }) => {
      const v = getValue() as number | null;
      return <span style={{ color: 'var(--color-down)' }}>{v != null ? v.toFixed(2) : '--'}</span>;
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'target',
    header: 'TARGET',
    cell: ({ getValue }) => {
      const v = getValue() as number | null;
      return <span style={{ color: 'var(--color-up)' }}>{v != null ? v.toFixed(2) : '--'}</span>;
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'toStop',
    header: 'TO STOP',
    cell: ({ getValue }) => {
      const v = getValue() as number | null;
      if (v == null) return <span style={{ color: 'var(--text-muted)' }}>--</span>;
      const color = v < -3 ? 'var(--color-down)' : 'var(--color-accent)';
      return <span style={{ color }}>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</span>;
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'toTarget',
    header: 'TO TARGET',
    cell: ({ getValue }) => {
      const v = getValue() as number | null;
      if (v == null) return <span style={{ color: 'var(--text-muted)' }}>--</span>;
      return <span style={{ color: 'var(--color-up)' }}>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</span>;
    },
    meta: { numeric: true },
  },
];

export function OpenPositionsTable({ positions }: { positions: OpenPositionRow[] }) {
  return <DataTable columns={OPEN_POS_COLS} data={positions} dense enableSorting />;
}

// ---------------------------------------------------------------------------
// Closed trades table
// ---------------------------------------------------------------------------

export interface ClosedTradeRow {
  id:         string;
  symbol:     string;
  strategy:   string;
  side:       string;
  entryDate:  string;
  exitDate:   string;
  pnlPct:     number | null;
  days:       number;
  exitReason: string;
  exitColor:  string;
}

const CLOSED_COLS: ColumnDef<ClosedTradeRow, unknown>[] = [
  { accessorKey: 'symbol',   header: 'SYMBOL',   meta: { accent: true } },
  {
    accessorKey: 'strategy',
    header: 'STRATEGY',
    cell: ({ getValue }) => <span style={{ color: 'var(--text-muted)' }}>{getValue() as string}</span>,
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
    accessorKey: 'entryDate',
    header: 'ENTRY',
    cell: ({ getValue }) => (getValue() as string).slice(0, 10),
    meta: { numeric: true },
  },
  {
    accessorKey: 'exitDate',
    header: 'EXIT',
    cell: ({ getValue }) => (getValue() as string)?.slice(0, 10) ?? '--',
    meta: { numeric: true },
  },
  {
    accessorKey: 'pnlPct',
    header: 'P&L %',
    cell: ({ getValue }) => {
      const v = getValue() as number | null;
      if (v == null) return <span style={{ color: 'var(--text-muted)' }}>--</span>;
      const color = v >= 0 ? 'var(--color-up)' : 'var(--color-down)';
      return <span style={{ color }}>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</span>;
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'days',
    header: 'DAYS',
    cell: ({ getValue }) => `${getValue() as number}d`,
    meta: { numeric: true },
  },
  {
    accessorKey: 'exitReason',
    header: 'EXIT REASON',
    cell: ({ row }) => <span style={{ color: row.original.exitColor }}>{row.original.exitReason}</span>,
    meta: { numeric: true },
  },
];

export function ClosedTradesTable({ trades }: { trades: ClosedTradeRow[] }) {
  return <DataTable columns={CLOSED_COLS} data={trades} dense enableSorting />;
}
