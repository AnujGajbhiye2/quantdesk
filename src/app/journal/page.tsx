'use client';

import { useEffect, useState, useMemo } from 'react';
import DublinClock from '@/components/primitives/DublinClock';
import InfoTip from '@/components/primitives/InfoTip';
import { fmtMoney } from '@/core/format/currency';
import type { JournalRow, ComboReport } from '@/app/api/journal/route';
import { DataTable } from '@/components/table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';

/**
 * Trade journal + system report.
 * Journal: WHY frozen at open, outcome at close - the decision log.
 * System report: strategy x market combos ranked by LIVE record with
 * TRUST/WATCH/AVOID - the closest honest answer to "what can I follow?".
 */

function pnlColor(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return 'var(--text-muted)';
  return v >= 0 ? 'var(--color-up)' : 'var(--color-down)';
}

const REPORT_COLS: ColumnDef<ComboReport, unknown>[] = [
  { accessorKey: 'strategyId', header: 'STRATEGY', meta: { accent: true } },
  { accessorKey: 'market',     header: 'MARKET',   cell: ({ getValue }) => <span style={{ color: 'var(--text-muted)' }}>{getValue() as string}</span>, meta: { align: 'center' } },
  {
    accessorKey: 'verdict',
    header: 'VERDICT',
    cell: ({ getValue }) => {
      const v = getValue() as ComboReport['verdict'];
      const color = v === 'TRUST' ? 'var(--color-up)' : v === 'AVOID' ? 'var(--color-down)' : 'var(--color-accent)';
      return <span style={{ color, fontWeight: 700 }}>{v}</span>;
    },
    meta: { align: 'center' },
  },
  {
    accessorKey: 'trades',
    header: 'TRADES',
    cell: ({ getValue }) => <span style={{ color: 'var(--text-muted)' }}>{getValue() as number}</span>,
    meta: { numeric: true },
  },
  {
    accessorKey: 'liveWinRate',
    header: 'LIVE WIN%',
    cell: ({ getValue }) => `${((getValue() as number) * 100).toFixed(0)}%`,
    meta: { numeric: true },
  },
  {
    accessorKey: 'backtestWinRate',
    header: 'BT WIN%',
    cell: ({ getValue }) => {
      const v = getValue() as number | null;
      return <span style={{ color: 'var(--text-muted)' }}>{v != null ? `${(v * 100).toFixed(0)}%` : '--'}</span>;
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'avgPnlPct',
    header: 'AVG P&L%',
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return <span style={{ color: pnlColor(v) }}>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</span>;
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'totalPnlUSD',
    header: 'P&L (USD)',
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return <span style={{ color: pnlColor(v), fontVariantNumeric: 'tabular-nums' }}>{v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}</span>;
    },
    meta: { numeric: true },
  },
];

interface WhyShape {
  reason?: string;
  rr?: number;
  conviction?: { score: number; band: string } | null;
  signalTime?: string;
  notes?: string;
}

interface OutcomeShape {
  exitReason?: string;
  pnl?: number;
  pnlPct?: number;
  heldDays?: number;
}

export default function JournalPage() {
  const [rows, setRows]     = useState<JournalRow[]>([]);
  const [report, setReport] = useState<ComboReport[]>([]);
  const [error, setError]   = useState('');

  useEffect(() => {
    fetch('/api/journal')
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) { setError(d.error ?? r.statusText); return; }
        setRows(d.rows ?? []);
        setReport(d.report ?? []);
      })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="flex flex-col h-full" style={{ minHeight: '100vh', fontFamily: 'var(--font-mono)' }}>
      {/* Status bar */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-4">
          <span style={{ color: 'var(--color-accent)', fontWeight: 700, letterSpacing: '0.1em', fontSize: 'var(--fs-sm)' }}>
            QUANTDESK
          </span>
          <nav className="flex gap-3" style={{ fontSize: 'var(--fs-xs)' }}>
            <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>DASH</a>
            <a href="/backtest" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>BACKTEST</a>
            <a href="/compare" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>COMPARE</a>
            <a href="/paper" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>PAPER</a>
            <a href="/journal" style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>JOURNAL</a>
            <a href="/settings" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>SETTINGS</a>
          </nav>
        </div>
        <DublinClock />
      </div>

      {error && <div style={{ padding: 24, color: 'var(--color-down)' }}>{error}</div>}

      <div className="flex-1 overflow-auto" style={{ background: 'var(--bg-base)' }}>
        {/* System report */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em', marginBottom: 2 }}>
            [ SYSTEM REPORT - what can you actually follow? ]
            <InfoTip
              term="System report"
              text={
                'Every strategy x market combo, ranked by LIVE paper P&L.\n' +
                'TRUST: 10+ closed trades and live win rate within 5 points of backtest - the edge survives reality.\n' +
                'AVOID: 10+ trades and live materially worse - was curve-fit, stop following it.\n' +
                'WATCH: not enough closed trades yet to judge.\n' +
                'Even TRUST is hypothetical paper performance - past results never guarantee anything.'
              }
            />
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', marginBottom: 8 }}>
            Combos earn TRUST by performing live, not by backtesting well. Build the sample by taking ideas.
          </div>
          {report.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
              no closed trades yet - the report builds itself as your paper trades close
            </div>
          ) : (
            <DataTable columns={REPORT_COLS} data={report} enableSorting />
          )}
        </div>

        {/* Journal entries */}
        <div style={{ padding: '12px 16px' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em', marginBottom: 8 }}>
            [ DECISION LOG ({rows.length}) ]
            <InfoTip
              term="Decision log"
              text="Every paper trade with its WHY frozen at the moment you took it - signal reason, conviction, R:R - and the outcome appended when it closed. Reading your own past reasoning against what actually happened is how trading judgment is built."
            />
          </div>
          {rows.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
              no journal entries yet - they are written automatically when you open a trade
            </div>
          ) : (
            rows.map(({ entry, trade }) => {
              const why = entry.why as WhyShape;
              const outcome = entry.outcome as OutcomeShape | null;
              const cur = trade?.currency ?? 'USD';
              return (
                <div
                  key={entry.tradeId}
                  style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)', marginBottom: 8, fontSize: 'var(--fs-xs)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 8px', background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}>
                    <span>
                      <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>{trade?.symbol ?? '?'}</span>
                      <span style={{ color: trade?.side === 'long' ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 700, marginLeft: 8 }}>
                        {trade?.side.toUpperCase()}
                      </span>
                      <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{trade?.strategyId}</span>
                      {why.conviction && (
                        <span style={{ color: 'var(--color-accent)', marginLeft: 8 }}>
                          conviction {why.conviction.score} {why.conviction.band}
                        </span>
                      )}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>{entry.openedAt.slice(0, 10)}</span>
                  </div>
                  <div style={{ padding: '4px 8px', color: 'var(--text-muted)' }}>
                    WHY: {why.reason ?? why.notes ?? 'manual entry - no reason recorded'}
                    {why.rr != null && <span> · R:R {why.rr.toFixed(1)}x</span>}
                    {trade && (
                      <span> · entry {fmtMoney(trade.entryPrice, cur)}
                        {trade.stopPrice != null && <> · stop {fmtMoney(trade.stopPrice, cur)}</>}
                        {trade.targetPrice != null && <> · target {fmtMoney(trade.targetPrice, cur)}</>}
                      </span>
                    )}
                  </div>
                  <div style={{ padding: '4px 8px', borderTop: '1px solid var(--border)' }}>
                    {outcome ? (
                      <span>
                        <span style={{ color: 'var(--text-muted)' }}>OUTCOME:</span>{' '}
                        <span style={{ color: pnlColor(outcome.pnl) , fontWeight: 700 }}>
                          {outcome.pnl != null ? `${outcome.pnl >= 0 ? '+' : ''}${fmtMoney(outcome.pnl, cur)}` : '--'}
                          {outcome.pnlPct != null ? ` (${outcome.pnlPct >= 0 ? '+' : ''}${outcome.pnlPct.toFixed(2)}%)` : ''}
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {' '}via {outcome.exitReason ?? '?'} after {outcome.heldDays ?? '?'}d
                        </span>
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-accent)' }}>still open</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Disclaimer */}
      <div
        className="px-4 py-1 shrink-0 text-center"
        style={{ background: 'var(--bg-base)', borderTop: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.04em' }}
      >
        Research tool. Not financial advice. Results hypothetical - paper performance never guarantees real returns.
      </div>
    </div>
  );
}
