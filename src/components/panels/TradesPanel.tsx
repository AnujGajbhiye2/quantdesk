'use client';

import { memo, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import Panel from '@/components/primitives/Panel';
import EmptyState from '@/components/primitives/EmptyState';
import { DataTable } from '@/components/table/DataTable';
import { fmtMoney } from '@/core/format/currency';
import { fmtDate } from '@/core/format/date';
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

// --------------------------------------------------------------------------
// Row shape passed to DataTable (includes resolved mark + computed values)
// --------------------------------------------------------------------------

interface TradeRow extends PaperTradeWithHold {
  _displayPnl:    number | undefined;
  _displayPnlPct: number | undefined;
  _isMtm:         boolean;
  _markPrice:     number | undefined;
  _hold:          { text: string; title: string };
}

function TradesPanel({ trades, marks }: Props) {
  const router = useRouter();
  const recent = useMemo<TradeRow[]>(() => {
    return [...trades].reverse().slice(0, 20).map((t) => {
      const mark       = t.status === 'open' ? marks?.get(t.id) : undefined;
      const isMtm      = mark != null;
      return {
        ...t,
        _displayPnl:    mark != null ? mark.unrealizedPnl    : t.pnl,
        _displayPnlPct: mark != null ? mark.unrealizedPnlPct : t.pnlPct,
        _isMtm:         isMtm,
        _markPrice:     mark?.markPrice,
        _hold:          holdCell(t),
      };
    });
  }, [trades, marks]);

  const columns = useMemo<ColumnDef<TradeRow, unknown>[]>(() => [
    {
      id:         'date',
      accessorFn: (r) => r.entryTime,
      header:     'DATE',
      meta:       { align: 'left' },
      enableSorting: true,
      cell:       ({ row }) => (
        <span style={{ color: 'var(--text-muted)' }}>{fmtDate(row.original.entryTime)}</span>
      ),
    },
    {
      id:         'symbol',
      accessorFn: (r) => r.symbol,
      header:     'SYMBOL',
      meta:       { align: 'left', accent: true },
      enableSorting: true,
      cell:       ({ row }) => (
        <span
          style={{ color: 'var(--color-accent)', fontWeight: 600, cursor: 'pointer' }}
          title={`backtest ${row.original.symbol}`}
          onClick={(e) => { e.stopPropagation(); router.push(`/backtest?symbol=${row.original.symbol}`); }}
        >
          {row.original.symbol}
        </span>
      ),
    },
    {
      id:         'strategy',
      accessorFn: (r) => r.strategyId,
      header:     'STRATEGY',
      meta:       { align: 'left' },
      enableSorting: false,
      cell:       ({ row }) => (
        <span style={{ color: 'var(--text-muted)' }}>{row.original.strategyId}</span>
      ),
    },
    {
      id:         'side',
      accessorFn: (r) => r.side,
      header:     'SIDE',
      meta:       { align: 'center' },
      enableSorting: false,
      cell:       ({ row }) => {
        const color = row.original.side === 'long' ? 'var(--color-up)' : 'var(--color-down)';
        return <span style={{ color, fontWeight: 600 }}>{row.original.side.toUpperCase()}</span>;
      },
    },
    {
      id:         'entry',
      accessorFn: (r) => r.entryPrice,
      header:     'ENTRY',
      meta:       { align: 'right', numeric: true },
      enableSorting: false,
      cell:       ({ row }) => fmtMoney(row.original.entryPrice, row.original.currency ?? 'USD'),
    },
    {
      id:         'cur',
      accessorFn: (r) => r._markPrice,
      header:     'CUR',
      meta:       { align: 'right', numeric: true },
      enableSorting: false,
      cell:       ({ row }) => {
        const t = row.original;
        if (t._markPrice == null) return <span style={{ color: 'var(--text-muted)' }}>--</span>;
        return (
          <span style={{ color: pnlColor(t._displayPnl), fontVariantNumeric: 'tabular-nums' }}>
            {fmtMoney(t._markPrice, t.currency ?? 'USD')}
          </span>
        );
      },
    },
    {
      id:         'exit',
      accessorFn: (r) => r.exitPrice,
      header:     'EXIT',
      meta:       { align: 'right', numeric: true },
      enableSorting: false,
      cell:       ({ row }) => {
        const ep = row.original.exitPrice;
        return (
          <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {ep != null ? fmtMoney(ep, row.original.currency ?? 'USD') : '--'}
          </span>
        );
      },
    },
    {
      id:         'qty',
      accessorFn: (r) => r.qty,
      header:     'QTY',
      meta:       { align: 'right', numeric: true },
      enableSorting: false,
      cell:       ({ row }) => (
        <span style={{ color: 'var(--text-muted)' }}>{fmt(row.original.qty, 4)}</span>
      ),
    },
    {
      id:         'pnl',
      accessorFn: (r) => r._displayPnl,
      header:     'P&L',
      meta:       { align: 'right', numeric: true },
      enableSorting: true,
      cell:       ({ row }) => {
        const t = row.original;
        if (t._displayPnl == null) return <span style={{ color: 'var(--text-muted)' }}>--</span>;
        const prefix = `${t._isMtm ? '~' : ''}${t._displayPnl >= 0 ? '+' : ''}`;
        return (
          <span style={{ color: pnlColor(t._displayPnl), fontVariantNumeric: 'tabular-nums' }}>
            {prefix}{fmtMoney(t._displayPnl, t.currency ?? 'USD')}
          </span>
        );
      },
    },
    {
      id:         'pnlPct',
      accessorFn: (r) => r._displayPnlPct,
      header:     'P&L%',
      meta:       { align: 'right', numeric: true },
      enableSorting: false,
      cell:       ({ row }) => {
        const t = row.original;
        if (t._displayPnlPct == null) return <span style={{ color: 'var(--text-muted)' }}>--</span>;
        const prefix = `${t._isMtm ? '~' : ''}${t._displayPnlPct >= 0 ? '+' : ''}`;
        return (
          <span style={{ color: pnlColor(t._displayPnlPct), fontVariantNumeric: 'tabular-nums' }}>
            {prefix}{fmt(t._displayPnlPct)}%
          </span>
        );
      },
    },
    {
      id:         'hold',
      accessorFn: (r) => r._hold.text,
      header:     'EST HOLD',
      meta:       { align: 'left' },
      enableSorting: false,
      cell:       ({ row }) => (
        <span
          style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
          title={row.original._hold.title}
        >
          {row.original._hold.text}
        </span>
      ),
    },
    {
      id:         'status',
      accessorFn: (r) => r.status,
      header:     'STATUS',
      meta:       { align: 'center' },
      enableSorting: false,
      cell:       ({ row }) => {
        const t = row.original;
        const color = t.status === 'open' ? 'var(--color-accent)' : 'var(--text-muted)';
        return <span style={{ color }}>{t.status.toUpperCase()}</span>;
      },
    },
  ], [router]);

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
        <DataTable
          columns={columns}
          data={recent}
          enableSorting
          defaultSort={[{ id: 'date', desc: true }]}
        />
      )}
    </Panel>
  );
}

export default memo(TradesPanel);
