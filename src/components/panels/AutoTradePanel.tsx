'use client';

import { useEffect, useState, useCallback } from 'react';

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
    qty: number; entryPrice: number; entryTime: string;
    pnl?: number | null; pnlPct?: number | null;
  }>;
}

interface TriggerResult {
  ingest:    { symbols: number; barsAdded: number; errors: number };
  autoTrade: { entries: unknown[]; exits: unknown[]; skips: unknown[]; halted: boolean; haltReason?: string; dryRun: boolean };
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
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-xs)' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '2px 6px 2px 0' }}>SYM</th>
                  <th style={{ padding: '2px 6px' }}>SIDE</th>
                  <th style={{ padding: '2px 6px' }}>STATUS</th>
                  <th style={{ padding: '2px 6px', textAlign: 'right' }}>QTY</th>
                  <th style={{ padding: '2px 6px', textAlign: 'right' }}>ENTRY</th>
                  <th style={{ padding: '2px 6px', textAlign: 'right' }}>P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {status.trades.map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '2px 6px 2px 0', color: 'var(--text-primary)' }}>{t.symbol}</td>
                    <td style={{ padding: '2px 6px', color: t.side === 'long' ? 'var(--color-up)' : 'var(--color-down)' }}>
                      {t.side.toUpperCase()}
                    </td>
                    <td style={{ padding: '2px 6px', color: t.status === 'open' ? 'var(--color-accent)' : 'var(--text-muted)' }}>
                      {t.status.toUpperCase()}
                    </td>
                    <td style={{ padding: '2px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {t.qty.toFixed(2)}
                    </td>
                    <td style={{ padding: '2px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      ${t.entryPrice.toFixed(2)}
                    </td>
                    <td style={{ padding: '2px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                      color: t.pnl != null ? pnlColor(t.pnl) : 'var(--text-muted)' }}>
                      {t.pnl != null
                        ? `${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
