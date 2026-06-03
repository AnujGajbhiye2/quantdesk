'use client';

import type { BacktestMetrics } from '@/core/backtest/engine';

interface Props {
  metrics:   BacktestMetrics;
  numTrades: number;
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{label}</span>
      <span style={{ color: color ?? 'var(--text-primary)', fontSize: '11px', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function pnlColor(v: number | null | undefined) { return (v ?? 0) >= 0 ? 'var(--color-up)' : 'var(--color-down)'; }
function pct(v: number | null | undefined) {
  if (v == null || !isFinite(v)) return '--';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}
function num(v: number | null | undefined, dec = 2) {
  if (v == null || !isFinite(v)) return '--';
  return v.toFixed(dec);
}

export default function MetricsPanel({ metrics, numTrades }: Props) {
  return (
    <div style={{ padding: '8px 12px', overflowY: 'auto', height: '100%' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '10px', letterSpacing: '0.08em', marginBottom: 8 }}>
        [ BACKTEST METRICS ]
      </div>
      <Row label="Total return" value={pct(metrics.totalReturnPct)} color={pnlColor(metrics.totalReturnPct)} />
      <Row label="CAGR" value={pct(metrics.cagr)} color={pnlColor(metrics.cagr)} />
      <Row label="Win rate" value={metrics.winRate == null ? '--' : `${(metrics.winRate * 100).toFixed(1)}%`} />
      <Row label="Profit factor" value={isFinite(metrics.profitFactor) ? num(metrics.profitFactor) : 'INF'} />
      <Row label="Avg win" value={pct(metrics.avgWinPct)} color="var(--color-up)" />
      <Row label="Avg loss" value={pct(metrics.avgLossPct)} color="var(--color-down)" />
      <Row label="Max drawdown" value={`-${num(metrics.maxDrawdownPct)}%`} color="var(--color-down)" />
      <Row label="Sharpe" value={num(metrics.sharpe)} />
      <Row label="Exposure" value={`${num(metrics.exposurePct)}%`} />
      <Row label="Trades" value={String(numTrades)} />
      <Row label="Avg hold (bars)" value={num(metrics.avgHoldingBars, 1)} />
    </div>
  );
}
