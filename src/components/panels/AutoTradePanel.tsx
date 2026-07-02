'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { DataTable } from '@/components/table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import { toUSD } from '@/core/format/fx';

interface AutoTradeStatus {
  enabled:          boolean;
  dryRun:           boolean;
  timeframe:        string;
  minConsensus:     number;
  maxTradesPerDay:  number;
  dailyLossHaltPct: number;
  today:            string;
  autoTradesToday:  number;
  openAutoToday:    number;
  closedAutoToday:  number;
  todayPnlUsd:      number;
  trades:           Array<{
    id: string; symbol: string; side: string; status: string;
    qty: number; entryPrice: number; entryTime: string; currency?: string;
    pnl?: number | null; pnlPct?: number | null;
  }>;
}

interface TriggerResult {
  ingest:    { symbols: number; barsAdded: number; errors: number };
  autoTrade: { entries: unknown[]; exits: unknown[]; skips: unknown[]; halted: boolean; haltReason?: string; dryRun: boolean };
}

type TradeItem = AutoTradeStatus['trades'][number];

const AUTO_TRADE_COLS: ColumnDef<TradeItem, unknown>[] = [
  { accessorKey: 'symbol', header: 'SYM' },
  {
    accessorKey: 'side',
    header: 'SIDE',
    cell: ({ getValue }) => {
      const side = getValue() as string;
      return <span style={{ color: side === 'long' ? 'var(--color-up)' : 'var(--color-down)' }}>{side.toUpperCase()}</span>;
    },
  },
  {
    accessorKey: 'status',
    header: 'STATUS',
    cell: ({ getValue }) => {
      const s = getValue() as string;
      return <span style={{ color: s === 'open' ? 'var(--color-accent)' : 'var(--text-muted)' }}>{s.toUpperCase()}</span>;
    },
  },
  {
    accessorKey: 'qty',
    header: 'QTY',
    cell: ({ getValue }) => (getValue() as number).toFixed(2),
    meta: { numeric: true },
  },
  {
    accessorKey: 'entryPrice',
    header: 'ENTRY',
    cell: ({ getValue, row }) => `$${toUSD(getValue() as number, row.original.currency).toFixed(2)}`,
    meta: { numeric: true },
  },
  {
    accessorKey: 'pnl',
    header: 'P&L',
    cell: ({ getValue, row }) => {
      const v = getValue() as number | null | undefined;
      if (v == null) return <span style={{ color: 'var(--text-muted)' }}>-</span>;
      const usd = toUSD(v, row.original.currency);
      const color = usd > 0 ? 'var(--color-up)' : usd < 0 ? 'var(--color-down)' : 'var(--text-muted)';
      return <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{usd >= 0 ? '+' : ''}${usd.toFixed(2)}</span>;
    },
    meta: { numeric: true },
  },
];

function AutoTradesTable({ trades, pnlColor: _ }: { trades: TradeItem[]; pnlColor: (v: number) => string }) {
  return <DataTable columns={AUTO_TRADE_COLS} data={trades} dense />;
}

export default function AutoTradePanel() {
  const [status,        setStatus]        = useState<AutoTradeStatus | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [triggering,    setTriggering]    = useState(false);
  const [triggerResult, setTriggerResult] = useState<TriggerResult | null>(null);
  const [error,         setError]         = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/paper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto-status' }),
      });
      const json = await res.json() as AutoTradeStatus;
      setStatus(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load auto-trade status');
    } finally {
      setLoading(false);
    }
  }, []);

  const trigger = useCallback(async () => {
    setTriggering(true);
    setTriggerResult(null);
    setError('');
    try {
      const res  = await fetch('/api/paper', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'auto-trigger' }),
      });
      const json = await res.json() as TriggerResult;
      setTriggerResult(json);
      await load(); // refresh status after trigger
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Trigger failed');
    } finally {
      setTriggering(false);
    }
  }, [load]);

  useEffect(() => { void load(); }, [load]);

  const pnlColor = (v: number) =>
    v > 0 ? 'var(--color-up)' : v < 0 ? 'var(--color-down)' : 'var(--text-muted)';

  const dotColor = status?.enabled
    ? (status.dryRun ? 'var(--color-accent)' : 'var(--color-up)')
    : 'var(--text-muted)';

  const badge = (label: string, val: string | number, color = 'var(--text-muted)') => (
    <span style={{
      background: 'var(--bg-panel-header)', border: '1px solid var(--border)',
      borderRadius: 2, padding: '1px 6px', fontSize: 'var(--fs-xs)',
      color, fontFamily: 'var(--font-mono)',
    }}>
      {label}: <span style={{ color: 'var(--text-primary)' }}>{val}</span>
    </span>
  );

  return (
    <div style={{
      background: 'var(--bg-panel)', border: '1px solid var(--border)',
      padding: '10px 14px', fontFamily: 'var(--font-mono)',
      fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ color: dotColor, fontSize: 10 }}>⬤</span>
        <span style={{ color: 'var(--text-primary)', letterSpacing: '0.08em' }}>
          AUTO-TRADE
        </span>
        {status && (
          <span style={{ color: 'var(--text-muted)' }}>
            {status.enabled
              ? (status.dryRun ? '[ DRY RUN ]' : '[ LIVE PAPER ]')
              : '[ DISABLED ]'}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button
            onClick={() => { void trigger(); }}
            disabled={triggering || loading}
            title="Run one auto-trade tick now (bypasses market-hours gate)"
            style={{
              background: triggering ? 'var(--bg-panel-header)' : 'var(--color-accent)',
              border: '1px solid var(--color-accent)',
              color: triggering ? 'var(--text-muted)' : 'var(--bg-base)',
              fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)',
              padding: '1px 8px', cursor: triggering ? 'wait' : 'pointer', fontWeight: 600,
            }}
          >
            {triggering ? 'RUNNING...' : 'TRIGGER NOW'}
          </button>
          <button
            onClick={() => { void load(); }}
            disabled={loading}
            style={{
              background: 'none', border: '1px solid var(--border)',
              color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-xs)', padding: '1px 6px', cursor: 'pointer',
            }}
          >
            {loading ? '...' : 'REFRESH'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--color-down)', marginBottom: 6 }}>{error}</div>
      )}

      {!status && !loading && !error && (
        <div style={{ color: 'var(--text-muted)' }}>No status available.</div>
      )}

      {status && (
        <>
          {/* Config badges */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            {badge('tf', status.timeframe)}
            {badge('consensus', `≥${status.minConsensus}`)}
            {badge('max/day', status.maxTradesPerDay)}
            {badge('halt@', `-${(status.dailyLossHaltPct * 100).toFixed(0)}%`)}
          </div>

          {/* Last trigger result */}
          {triggerResult && (
            <div style={{
              background: 'var(--bg-panel-header)', border: '1px solid var(--border)',
              padding: '6px 10px', marginBottom: 8, fontSize: 'var(--fs-xs)',
            }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
                LAST TRIGGER {triggerResult.autoTrade.dryRun ? '[DRY RUN]' : '[LIVE]'}
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>Bars ingested: <b style={{ color: 'var(--text-primary)' }}>{triggerResult.ingest.barsAdded}</b></span>
                <span>Entries: <b style={{ color: triggerResult.autoTrade.entries.length > 0 ? 'var(--color-up)' : 'var(--text-primary)' }}>{triggerResult.autoTrade.entries.length}</b></span>
                <span>Exits: <b style={{ color: 'var(--text-primary)' }}>{triggerResult.autoTrade.exits.length}</b></span>
                <span>Skips: <b style={{ color: 'var(--text-muted)' }}>{triggerResult.autoTrade.skips.length}</b></span>
                {triggerResult.autoTrade.halted && (
                  <span style={{ color: 'var(--color-down)' }}>HALTED: {triggerResult.autoTrade.haltReason}</span>
                )}
              </div>
              {triggerResult.autoTrade.dryRun && triggerResult.autoTrade.entries.length > 0 && (
                <div style={{ color: 'var(--color-accent)', marginTop: 4 }}>
                  Check Telegram for intended trade details.
                </div>
              )}
            </div>
          )}

          {/* Today's stats */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>TODAY </span>
              <span style={{ color: 'var(--text-primary)' }}>{status.today}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>ENTRIES </span>
              <span style={{ color: 'var(--text-primary)' }}>{status.autoTradesToday}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>OPEN </span>
              <span style={{ color: 'var(--color-accent)' }}>{status.openAutoToday}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>CLOSED </span>
              <span style={{ color: 'var(--text-primary)' }}>{status.closedAutoToday}</span>
            </div>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>DAY P&amp;L </span>
              <span style={{ color: pnlColor(status.todayPnlUsd), fontVariantNumeric: 'tabular-nums' }}>
                {status.todayPnlUsd >= 0 ? '+' : ''}${status.todayPnlUsd.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Today's auto trades table */}
          {status.trades.length > 0 && (
            <AutoTradesTable trades={status.trades} pnlColor={pnlColor} />
          )}

          {status.trades.length === 0 && (
            <div style={{ color: 'var(--text-muted)' }}>No auto trades today.</div>
          )}

          {/* Disclaimer */}
          <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', fontStyle: 'italic' }}>
            Research tool - not financial advice. Results are hypothetical paper trades only.
          </div>
        </>
      )}
    </div>
  );
}
