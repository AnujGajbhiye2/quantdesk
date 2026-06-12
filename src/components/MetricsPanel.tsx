'use client';

import InfoTip from './InfoTip';
import { gloss, type GlossaryKey } from '@/core/glossary';
import type { BacktestMetrics } from '@/core/backtest/engine';

interface Props {
  metrics:   BacktestMetrics;
  numTrades: number;
}

function Row({ label, value, color, glossKey }: { label: string; value: string; color?: string; glossKey?: GlossaryKey }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
        {label}
        {glossKey && <InfoTip term={gloss(glossKey).term} text={gloss(glossKey).text} />}
      </span>
      <span style={{ color: color ?? 'var(--text-primary)', fontSize: 'var(--fs-xs)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
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
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em', marginBottom: 8 }}>
        [ BACKTEST METRICS ]
        <span style={{ marginLeft: 4 }}>
          <InfoTip
            term="BACKTEST METRICS"
            text="How this strategy performed on this symbol's full history. Watch profit factor (>1 = net winner), max drawdown (worst equity drop you must sit through) and trade count (under ~15 trades, every other number here is noise)."
          />
        </span>
      </div>
      <Row label="Total return" value={pct(metrics.totalReturnPct)} color={pnlColor(metrics.totalReturnPct)} glossKey="totalReturn" />
      <Row label="CAGR" value={pct(metrics.cagr)} color={pnlColor(metrics.cagr)} glossKey="cagr" />
      <Row label="Win rate" value={metrics.winRate == null ? '--' : `${(metrics.winRate * 100).toFixed(1)}%`} glossKey="winRate" />
      <Row label="Profit factor" value={isFinite(metrics.profitFactor) ? num(metrics.profitFactor) : 'INF'} glossKey="profitFactor" />
      <Row label="Avg win" value={pct(metrics.avgWinPct)} color="var(--color-up)" />
      <Row label="Avg loss" value={pct(metrics.avgLossPct)} color="var(--color-down)" />
      <Row label="Max drawdown" value={`-${num(metrics.maxDrawdownPct)}%`} color="var(--color-down)" glossKey="maxDrawdown" />
      <Row label="Sharpe" value={num(metrics.sharpe)} glossKey="sharpe" />
      <Row label="Exposure" value={`${num(metrics.exposurePct)}%`} glossKey="exposure" />
      <Row label="Trades" value={String(numTrades)} glossKey="numTrades" />
      <Row label="Avg hold (bars)" value={num(metrics.avgHoldingBars, 1)} glossKey="avgHold" />
    </div>
  );
}
