'use client';

import { memo, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  type ColumnDef,
  type FilterFn,
} from '@tanstack/react-table';
import Panel from '@/components/primitives/Panel';
import EmptyState from '@/components/primitives/EmptyState';
import EdgeBadge from '@/components/primitives/EdgeBadge';
import { DataTable } from '@/components/table/DataTable';
import { fmtMoney } from '@/core/format/currency';
import { tierOpacity } from '@/core/edge/score';
import type { EnrichedTradeIdea } from '@/core/signals/gate';

export type IdeaSortKey = 'symbol' | 'entry' | 'qty' | 'risk' | 'rr' | 'conv';

function convColor(band: string | undefined): string {
  if (band === 'STRONG') return 'var(--color-up)';
  if (band === 'WEAK')   return 'var(--color-down)';
  return 'var(--color-accent)';
}

function fmt(n: number, dec = 2) {
  return isFinite(n) ? n.toFixed(dec) : '--';
}

function sideColor(side: 'long' | 'short') {
  return side === 'long' ? 'var(--color-up)' : 'var(--color-down)';
}

function rrColor(rr: number) {
  if (!isFinite(rr)) return 'var(--text-muted)';
  if (rr >= 2) return 'var(--color-up)';
  if (rr >= 1) return 'var(--color-accent)';
  return 'var(--color-down)';
}

// Custom filter: show only rows where gate.passed === true when filterValue=true.
const gateFilter: FilterFn<EnrichedTradeIdea> = (row, _columnId, filterValue: boolean) => {
  if (!filterValue) return true;
  return row.original.gate.passed;
};
gateFilter.autoRemove = (val: unknown) => !val;

interface Props {
  ideas:      EnrichedTradeIdea[];
  onTake?:    (idea: EnrichedTradeIdea) => void;
  busy?:      boolean;
  /** Map strategyId -> display name for the edge badge. */
  strategyNames?: Record<string, string>;
  /** Keyboard focus zone active ([i] pressed) - highlights the panel border. */
  focused?:   boolean;
  /** Index of the keyboard-selected idea row; -1 = none. */
  selected?:  number;
}

function TradeIdeasPanel({ ideas, onTake, busy, strategyNames = {}, focused, selected = -1 }: Props) {
  const router = useRouter();
  const [goodOnly, setGoodOnly] = useState(false);

  // ---------- column definitions ----------

  const columns = useMemo<ColumnDef<EnrichedTradeIdea, unknown>[]>(() => [
    // Hidden filter-only column on gate.passed
    {
      id:            'gatePassed',
      accessorFn:    (row) => row.gate.passed,
      enableHiding:  true,
      filterFn:      gateFilter,
      header:        () => null,
      cell:          () => null,
      size:          0,
    },
    {
      id:         'symbol',
      accessorFn: (row) => row.symbol,
      header:     'SYMBOL',
      meta:       { align: 'left', accent: true },
      enableSorting: true,
      cell: ({ row }) => {
        const idea = row.original;
        const gated = !idea.gate.passed;
        return (
          <span
            style={{
              color:      gated ? 'var(--text-muted)' : 'var(--color-accent)',
              fontWeight: 600,
              cursor:     'pointer',
            }}
            title={`backtest ${idea.symbol}`}
            onClick={(e) => { e.stopPropagation(); router.push(`/backtest?symbol=${idea.symbol}`); }}
          >
            {idea.symbol}
          </span>
        );
      },
    },
    {
      id:         'side',
      accessorFn: (row) => row.side,
      header:     'SIDE',
      meta:       { align: 'center' },
      enableSorting: false,
      cell: ({ row }) => {
        const idea  = row.original;
        const gated = !idea.gate.passed;
        return (
          <span style={{ color: gated ? 'var(--text-muted)' : sideColor(idea.side), fontWeight: 700 }}>
            {gated ? 'GATED' : idea.side.toUpperCase()}
          </span>
        );
      },
    },
    {
      id:         'entry',
      accessorFn: (row) => row.entryPrice,
      header:     'ENTRY',
      meta:       { align: 'right', numeric: true },
      enableSorting: true,
      cell: ({ row }) => fmtMoney(row.original.entryPrice, row.original.currency),
    },
    {
      id:         'stop',
      accessorFn: (row) => row.stopPrice,
      header:     'STOP',
      meta:       { align: 'right', numeric: true },
      enableSorting: false,
      cell: ({ row }) => {
        const idea  = row.original;
        const gated = !idea.gate.passed;
        return (
          <span style={{ color: gated ? undefined : 'var(--color-down)' }}>
            {fmtMoney(idea.stopPrice, idea.currency)}
          </span>
        );
      },
    },
    {
      id:         'target',
      accessorFn: (row) => row.targetPrice,
      header:     'TARGET',
      meta:       { align: 'right', numeric: true },
      enableSorting: false,
      cell: ({ row }) => {
        const idea  = row.original;
        const gated = !idea.gate.passed;
        return (
          <span style={{ color: gated ? undefined : 'var(--color-up)' }}>
            {fmtMoney(idea.targetPrice, idea.currency)}
          </span>
        );
      },
    },
    {
      id:         'qty',
      accessorFn: (row) => row.qty,
      header:     'QTY',
      meta:       { align: 'right', numeric: true },
      enableSorting: true,
      cell: ({ row }) => fmt(row.original.qty, 4),
    },
    {
      id:         'risk',
      accessorFn: (row) => row.riskAmount,
      header:     'RISK',
      meta:       { align: 'right', numeric: true },
      enableSorting: true,
      cell: ({ row }) => {
        const idea  = row.original;
        const gated = !idea.gate.passed;
        return (
          <span style={{ color: gated ? undefined : 'var(--color-down)' }}>
            {fmtMoney(idea.riskAmount, idea.currency)}
          </span>
        );
      },
    },
    {
      id:         'rr',
      accessorFn: (row) => row.rr,
      header:     'R:R',
      meta:       { align: 'right', numeric: true },
      enableSorting: true,
      cell: ({ row }) => {
        const idea  = row.original;
        const gated = !idea.gate.passed;
        return (
          <span style={{ color: gated ? undefined : rrColor(idea.rr), fontWeight: 600 }}>
            {isFinite(idea.rr) ? `${idea.rr.toFixed(1)}x` : '--'}
          </span>
        );
      },
    },
    {
      id:         'conv',
      accessorFn: (row) => row.conviction?.score ?? -1,
      header:     'CONV',
      meta:       { align: 'right', numeric: true },
      enableSorting: true,
      cell: ({ row }) => {
        const idea  = row.original;
        const gated = !idea.gate.passed;
        return (
          <span
            style={{
              color:      gated ? 'var(--text-muted)' : convColor(idea.conviction?.band),
              fontWeight: 700,
            }}
            title={idea.conviction
              ? idea.conviction.components.map((c) => `${c.label}: ${c.detail}`).join('\n')
              : 'conviction not computed'}
          >
            {idea.conviction ? `${idea.conviction.score}` : '--'}
          </span>
        );
      },
    },
    {
      id:         'reason',
      accessorFn: (row) => row.reason,
      header:     'REASON / EDGE',
      meta:       { align: 'left' },
      enableSorting: false,
      cell: ({ row }) => {
        const idea  = row.original;
        const gated = !idea.gate.passed;
        if (gated) {
          return (
            <span
              style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={`insufficient edge - ${idea.gate.reason}`}
            >
              insufficient edge - {idea.gate.reason}
            </span>
          );
        }
        return (
          <div style={{ overflow: 'hidden', maxWidth: 220 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
              {idea.reason}
            </div>
            <EdgeBadge
              edge={idea.edge}
              strategyName={strategyNames[idea.strategyId] ?? idea.strategyId}
              compact
            />
          </div>
        );
      },
    },
    ...(onTake ? [{
      id:         'action',
      header:     'ACTION',
      meta:       { align: 'center' as const },
      enableSorting: false,
      cell: ({ row }: { row: { original: EnrichedTradeIdea } }) => {
        const idea  = row.original;
        const gated = !idea.gate.passed;
        if (gated) return null;
        return (
          <button
            onClick={(e) => { e.stopPropagation(); onTake(idea); }}
            disabled={busy}
            style={{
              background:  'var(--bg-panel)',
              border:      '1px solid var(--color-accent)',
              color:       'var(--color-accent)',
              fontFamily:  'var(--font-mono)',
              fontSize:    'var(--fs-xs)',
              padding:     '1px 8px',
              cursor:      'pointer',
            }}
          >
            TAKE
          </button>
        );
      },
    }] : []),
  ], [router, strategyNames, onTake, busy]);

  // ---------- state helpers ----------

  if (ideas.length === 0) {
    return (
      <Panel title="TRADE IDEAS" className="h-full" headerRight={<span>entry · stop · target · qty · risk · R:R</span>}>
        <EmptyState message="— no ideas —" hint="run a scan to generate trade ideas" />
      </Panel>
    );
  }

  const passedCount = ideas.filter((i) => i.gate.passed).length;
  const noEdgeData  = ideas.every((i) => i.edge === null);

  // Toolbar: "good trades only" toggle + pass count
  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <label
        style={{
          display:    'flex',
          alignItems: 'center',
          gap:        6,
          cursor:     'pointer',
          fontSize:   'var(--fs-xs)',
          color:      goodOnly ? 'var(--color-accent)' : 'var(--text-muted)',
          userSelect: 'none',
        }}
      >
        <input
          type="checkbox"
          checked={goodOnly}
          onChange={(e) => setGoodOnly(e.target.checked)}
          style={{ accentColor: 'var(--color-accent)', cursor: 'pointer' }}
        />
        good trades only
      </label>
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
        {passedCount}/{ideas.length} pass quality gate
      </span>
    </div>
  );

  // Apply the gate filter by setting column filter state externally via key trick:
  // We drive filtering by toggling column filter via DataTable's columnFilters initial state.
  // Since we need dynamic filter control, we override via a controlled approach below.

  // Filter data before passing to table (simpler than wiring column filter externally)
  const visibleIdeas = goodOnly ? ideas.filter((i) => i.gate.passed) : ideas;

  return (
    <div
      className="h-full"
      style={focused ? { outline: '1px solid var(--color-accent)', outlineOffset: -1 } : undefined}
    >
      <Panel
        title="TRADE IDEAS"
        className="h-full"
        subtitle="Signals that passed the quality gate, turned into executable orders: entry, stop, target, size. This is your action list."
        info="Concrete entries from the last scan: entry, stop, target, position size and risk per trade. GATED rows failed the quality filter (R:R under 1.5, win rate under 40%, or fewer than 15 trades of history) - shown muted with the reason so you know the system is filtering, not broken. [i] focuses the panel, Enter-Enter opens a paper trade. Use 'good trades only' to hide gated rows."
        headerRight={
          <span style={{ color: 'var(--color-accent)' }}>
            {focused
              ? '[j/k] nav · [Enter] take · [Esc] exit'
              : noEdgeData
                ? 'edge data missing - run edge compute'
                : null}
          </span>
        }
      >
        <DataTable
          columns={columns}
          data={visibleIdeas}
          enableSorting
          toolbar={toolbar}
          selectedRow={focused ? selected : -1}
          rowStyle={(idea, _idx) => {
            const gated   = !idea.gate.passed;
            const opacity = gated ? 0.45 : tierOpacity(idea.edge?.tier ?? 'unknown');
            return {
              opacity,
              color: gated ? 'var(--text-muted)' : undefined,
            };
          }}
        />
      </Panel>
    </div>
  );
}

export default memo(TradeIdeasPanel);
