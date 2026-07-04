'use client';

import { useEffect, useState } from 'react';
import AppHeader from '@/components/primitives/AppHeader';
import DublinClock from '@/components/primitives/DublinClock';
import Panel from '@/components/primitives/Panel';
import ResearchTabs from '@/components/primitives/ResearchTabs';
import type { ReconcileReport } from '@/core/paper/reconcile';

/**
 * RECON - live-vs-backtest reconciliation + promotion criteria (WS5).
 * Answers two questions off one table: "is the live book behaving like the
 * walk-forward said it would?" and "how far is it from the real-money bar?"
 * The bar itself lives in PROMOTION_CRITERIA.md and is fixed.
 */

const STATUS_COLOR: Record<string, string> = {
  pass:    '#26a641',
  fail:    '#f85149',
  pending: '#e3b341',
  'n/a':   'var(--text-muted)',
};

function fmtPct(v: number | null): string {
  return v == null ? '-' : `${(v * 100).toFixed(0)}%`;
}

export default function ReconcilePage() {
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const [error,  setError]  = useState('');

  useEffect(() => {
    fetch('/api/paper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reconcile' }),
    })
      .then((r) => r.json())
      .then((d: { report?: ReconcileReport; error?: string }) => {
        if (d.report) setReport(d.report);
        else setError(d.error ?? 'no report');
      })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="flex flex-col h-full" style={{ minHeight: '100vh' }}>
      <AppHeader
        center={<span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
          LIVE vs BACKTEST RECONCILIATION
        </span>}
        right={<DublinClock />}
      />
      <ResearchTabs symbol="" />

      <div className="flex-1 overflow-y-auto" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <div style={{ color: '#f85149', fontSize: 'var(--fs-sm)' }}>{error}</div>}
        {!report && !error && <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>Loading...</div>}

        {report && (
          <>
            <Panel
              title="STRATEGY DRIFT - live realized vs walk-forward OOS expectation"
              info="Live stats from closed paper trades per strategy vs the walk-forward out-of-sample numbers the roster was selected on (FEATURE=both evaluation). Small samples show '-' instead of noise. Flags fire when the trailing-20-trade win rate falls 15+ points below expectation."
            >
              <table style={{ width: '100%', fontSize: 'var(--fs-xs)', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '4px 10px' }}>STRATEGY</th>
                    <th style={{ padding: '4px 10px', textAlign: 'right' }}>LIVE TRADES</th>
                    <th style={{ padding: '4px 10px', textAlign: 'right' }}>LIVE WR</th>
                    <th style={{ padding: '4px 10px', textAlign: 'right' }}>WF WR</th>
                    <th style={{ padding: '4px 10px', textAlign: 'right' }}>LIVE AVG R</th>
                    <th style={{ padding: '4px 10px', textAlign: 'right' }}>LIVE PF</th>
                    <th style={{ padding: '4px 10px', textAlign: 'right' }}>WF SHARPE</th>
                    <th style={{ padding: '4px 10px' }}>FLAGS</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.length === 0 && (
                    <tr><td colSpan={8} style={{ padding: 10, color: 'var(--text-muted)' }}>no closed trades yet</td></tr>
                  )}
                  {report.rows.map((r) => (
                    <tr key={r.strategyId} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 10px' }}>{r.strategyId}</td>
                      <td style={{ padding: '4px 10px', textAlign: 'right' }}>{r.liveTrades}</td>
                      <td style={{ padding: '4px 10px', textAlign: 'right' }}>{fmtPct(r.liveWinRate)}</td>
                      <td style={{ padding: '4px 10px', textAlign: 'right', color: 'var(--text-muted)' }}>{fmtPct(r.wfWinRate)}</td>
                      <td style={{ padding: '4px 10px', textAlign: 'right' }}>{r.liveAvgR == null ? '-' : r.liveAvgR.toFixed(2)}</td>
                      <td style={{ padding: '4px 10px', textAlign: 'right' }}>
                        {r.liveProfitFactor == null ? '-' : r.liveProfitFactor === -1 ? 'inf' : r.liveProfitFactor.toFixed(2)}
                      </td>
                      <td style={{ padding: '4px 10px', textAlign: 'right', color: 'var(--text-muted)' }}>
                        {r.wfSharpe == null ? '-' : r.wfSharpe.toFixed(2)}
                      </td>
                      <td style={{ padding: '4px 10px', color: '#e3b341' }}>{r.flags.join('; ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel
              title="PROMOTION CRITERIA - the real-money bar (fixed in PROMOTION_CRITERIA.md)"
              info="All rows must pass simultaneously before real capital is even considered. Numbers were fixed when the file was committed and do not move. Slippage is only measurable in a real-money pilot."
            >
              <table style={{ width: '100%', fontSize: 'var(--fs-xs)', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                    <th style={{ padding: '4px 10px' }}>CRITERION</th>
                    <th style={{ padding: '4px 10px' }}>TARGET</th>
                    <th style={{ padding: '4px 10px' }}>ACTUAL</th>
                    <th style={{ padding: '4px 10px' }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {report.criteria.map((c) => (
                    <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 10px' }}>{c.label}</td>
                      <td style={{ padding: '4px 10px', color: 'var(--text-muted)' }}>{c.target}</td>
                      <td style={{ padding: '4px 10px' }}>{c.actual}</td>
                      <td style={{ padding: '4px 10px', color: STATUS_COLOR[c.status], fontWeight: 700 }}>
                        {c.status.toUpperCase()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ padding: '8px 10px', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                generated {report.generatedAt.slice(0, 19).replace('T', ' ')} UTC
              </div>
            </Panel>
          </>
        )}
      </div>

      <div
        className="px-4 py-1 shrink-0 text-center"
        style={{
          background: 'var(--bg-base)',
          borderTop: '1px solid var(--border)',
          color: 'var(--text-muted)',
          fontSize: 'var(--fs-xs)',
          letterSpacing: '0.04em',
        }}
      >
        Research tool. Not financial advice. All results are hypothetical.
      </div>
    </div>
  );
}
