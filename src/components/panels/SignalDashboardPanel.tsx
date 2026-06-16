'use client';

import { memo, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import Panel from '@/components/primitives/Panel';
import { DataTable } from '@/components/table/DataTable';
import EmptyState from '@/components/primitives/EmptyState';
import EdgeBadge from '@/components/primitives/EdgeBadge';
import { tierOpacity } from '@/core/edge/score';
import type { EdgeSummary } from '@/core/edge/context';
import type { MarketRow } from '@/core/market/snapshot';
import type { ConsensusSignal } from '@/core/scan/consensus';
import type { Signal } from '@/core/types';

interface Props {
  rows:       MarketRow[];
  signals:    Signal[];
  consensus?: ConsensusSignal[];
  /** Edge summaries keyed 'strategyId|symbol' from the scan response. */
  edges?:     Record<string, EdgeSummary | null>;
}

function rsiColor(v: number) {
  if (!isFinite(v)) return 'var(--text-muted)';
  if (v >= 70) return 'var(--color-down)';
  if (v <= 30) return 'var(--color-up)';
  return 'var(--text-primary)';
}

function macdBadge(state: string) {
  if (state === 'bullish') return { text: 'BULL', color: 'var(--color-up)' };
  if (state === 'bearish') return { text: 'BEAR', color: 'var(--color-down)' };
  return { text: '--', color: 'var(--text-muted)' };
}

function maCrossBadge(cross: string) {
  if (cross === 'golden') return { text: 'GOLDEN', color: 'var(--color-up)' };
  if (cross === 'death')  return { text: 'DEATH',  color: 'var(--color-down)' };
  if (cross === 'none')   return { text: 'FLAT',   color: 'var(--text-muted)' };
  return { text: '--', color: 'var(--text-muted)' };
}

function signalBadge(signal: Signal | undefined) {
  if (!signal) return { text: 'HOLD', color: 'var(--text-muted)' };
  if (signal.side === 'long')  return { text: 'BUY',  color: 'var(--color-up)' };
  if (signal.side === 'short') return { text: 'SELL', color: 'var(--color-down)' };
  return { text: 'EXIT', color: 'var(--color-accent)' };
}

// --------------------------------------------------------------------------
// Consensus sub-section (not a DataTable - stays as simple table)
// --------------------------------------------------------------------------

function ConsensusSection({ consensus }: { consensus: ConsensusSignal[] }) {
  const router = useRouter();
  return (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 4 }}>
      <div
        style={{
          color: 'var(--text-muted)',
          fontSize: 'var(--fs-xs)',
          letterSpacing: '0.08em',
          padding: '2px 6px',
        }}
      >
        CONSENSUS - strongest first
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
        <tbody>
          {consensus.slice(0, 30).map((c) => {
            const color = c.side === 'long' ? 'var(--color-up)' : 'var(--color-down)';
            const firstReason = c.reasons[c.strategyIds[0]] ?? '';
            return (
              <tr key={`${c.symbol}|${c.side}`} style={{ borderBottom: '1px solid var(--border)' }}>
                <td
                  style={{ padding: '3px 6px', color: 'var(--color-accent)', fontWeight: 600, width: 90, cursor: 'pointer' }}
                  title={`backtest ${c.symbol}`}
                  onClick={() => router.push(`/backtest?symbol=${c.symbol}`)}
                >
                  {c.symbol}
                </td>
                <td style={{ padding: '3px 6px', color, fontWeight: 700, whiteSpace: 'nowrap', width: 90 }}>
                  {c.agreeCount}/{c.totalStrategies} {c.side.toUpperCase()}
                </td>
                <td style={{ padding: '3px 6px', width: 110 }}>
                  <div
                    title={`${(c.strength * 100).toFixed(0)}% of strategies agree`}
                    style={{ background: 'var(--bg-panel-header)', height: 8, width: 100 }}
                  >
                    <div style={{ background: color, height: '100%', width: `${Math.round(c.strength * 100)}%` }} />
                  </div>
                </td>
                <td
                  style={{
                    padding: '3px 6px',
                    color: 'var(--text-muted)',
                    fontSize: 'var(--fs-xs)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 240,
                  }}
                  title={c.strategyIds.map((id) => `${id}: ${c.reasons[id]}`).join('\n')}
                >
                  {c.strategyIds.join(', ')}{firstReason ? ` - ${firstReason}` : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --------------------------------------------------------------------------
// Row shape enriched with resolved signal/edge
// --------------------------------------------------------------------------

interface SignalRow extends MarketRow {
  _sig:     Signal | undefined;
  _edge:    EdgeSummary | null;
  _opacity: number;
}

// --------------------------------------------------------------------------
// Main panel
// --------------------------------------------------------------------------

function SignalDashboardPanel({ rows, signals, consensus = [], edges = {} }: Props) {
  const router = useRouter();

  const sigMap = useMemo(() => {
    const m = new Map<string, Signal>();
    for (const s of signals) m.set(s.symbol, s);
    return m;
  }, [signals]);

  const enriched = useMemo<SignalRow[]>(() => rows.map((row) => {
    const sig  = sigMap.get(row.symbol);
    const edge = sig && sig.side !== 'flat' ? (edges[`${sig.strategyId}|${row.symbol}`] ?? null) : null;
    const opacity = sig && sig.side !== 'flat' ? tierOpacity(edge?.tier ?? 'unknown') : 1;
    return { ...row, _sig: sig, _edge: edge, _opacity: opacity };
  }), [rows, sigMap, edges]);

  const columns = useMemo<ColumnDef<SignalRow, unknown>[]>(() => [
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
      id:         'rsi',
      accessorFn: (r) => r.rsi14,
      header:     'RSI(14)',
      meta:       { align: 'right', numeric: true },
      enableSorting: true,
      cell:       ({ row }) => (
        <span style={{ color: rsiColor(row.original.rsi14), fontVariantNumeric: 'tabular-nums' }}>
          {isFinite(row.original.rsi14) ? row.original.rsi14.toFixed(1) : '--'}
        </span>
      ),
    },
    {
      id:         'macd',
      accessorFn: (r) => r.macdState,
      header:     'MACD',
      meta:       { align: 'center' },
      enableSorting: false,
      cell:       ({ row }) => {
        const badge = macdBadge(row.original.macdState);
        return <span style={{ color: badge.color }}>{badge.text}</span>;
      },
    },
    {
      id:         'maCross',
      accessorFn: (r) => r.maCross,
      header:     'MA50/200',
      meta:       { align: 'center' },
      enableSorting: false,
      cell:       ({ row }) => {
        const badge = maCrossBadge(row.original.maCross);
        return <span style={{ color: badge.color }}>{badge.text}</span>;
      },
    },
    {
      id:         'signal',
      accessorFn: (r) => r._sig?.side ?? 'flat',
      header:     'SIGNAL',
      meta:       { align: 'center' },
      enableSorting: true,
      cell:       ({ row }) => {
        const badge = signalBadge(row.original._sig);
        return <span style={{ color: badge.color, fontWeight: 700 }}>{badge.text}</span>;
      },
    },
    {
      id:         'reason',
      accessorFn: (r) => r._sig?.reason ?? '',
      header:     'REASON',
      meta:       { align: 'left' },
      enableSorting: false,
      cell:       ({ row }) => {
        const { _sig: sig, _edge: edge } = row.original;
        if (sig && sig.side !== 'flat') {
          return (
            <div style={{ maxWidth: 200, overflow: 'hidden' }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                {sig.reason}
              </div>
              <EdgeBadge edge={edge} compact />
            </div>
          );
        }
        return <span style={{ color: 'var(--text-muted)' }}>{sig?.reason ?? ''}</span>;
      },
    },
  ], [router]);

  if (rows.length === 0) {
    return (
      <Panel title="SIGNAL DASHBOARD" className="h-full" headerRight={<span>RSI · MACD · MA · STRATEGY</span>}>
        <EmptyState message="— no data —" hint="ingest market data first" />
      </Panel>
    );
  }

  return (
    <Panel
      title="SIGNAL DASHBOARD"
      className="h-full"
      subtitle="Raw strategy opinions per symbol - research, not yet sized or risk-checked. Actionable subset lives in TRADE IDEAS."
      info="What each strategy says right now per symbol, plus standard indicator state. Row brightness = backtested edge of the signalling strategy on that symbol - bright rows earned trust, dim ones have weak or unproven stats. Consensus section ranks symbols where several strategies agree."
      headerRight={<span>RSI(14) · MACD · MA50/200 · SIGNAL</span>}
    >
      <div style={{ overflowX: 'auto', overflowY: 'auto', height: '100%' }}>
        {consensus.length > 0 && <ConsensusSection consensus={consensus} />}
        <DataTable
          columns={columns}
          data={enriched}
          enableSorting
          defaultSort={[]}
          rowStyle={(row) => ({ opacity: row._opacity })}
        />
      </div>
    </Panel>
  );
}

export default memo(SignalDashboardPanel);
