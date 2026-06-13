'use client';

import type { EdgeSummary } from '@/core/edge/context';

interface Props {
  edge:          EdgeSummary | null;
  /** Display name of the strategy; falls back to omitting the name segment. */
  strategyName?: string;
  /** Compact: drop the avg win/loss segments to fit dense table cells. */
  compact?:      boolean;
}

function testedSpan(from: string, to: string): string {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!isFinite(ms) || ms <= 0) return '';
  const days = ms / 86_400_000;
  if (days >= 350) return `${Math.round(days / 365)}y`;
  return `${Math.round(days / 30)}mo`;
}

/**
 * Inline edge context for a signal or trade idea:
 * "RSI Reversion | Win 58% | Avg win +4.2% | Avg loss -2.1% | 47 trades | tested 2y daily"
 * Scope suffix "(class)" / "(global)" appears when per-symbol stats were too thin.
 */
export default function EdgeBadge({ edge, strategyName, compact }: Props) {
  if (!edge) {
    return (
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
        no edge data
      </span>
    );
  }

  const parts: string[] = [];
  if (strategyName) parts.push(strategyName);
  parts.push(`Win ${(edge.winRate * 100).toFixed(0)}%`);
  if (!compact) {
    parts.push(`Avg win +${edge.avgWinPct.toFixed(1)}%`);
    parts.push(`Avg loss ${edge.avgLossPct.toFixed(1)}%`);
  }
  parts.push(`${edge.numTrades} trades`);
  const span = testedSpan(edge.testedFrom, edge.testedTo);
  if (span) parts.push(`tested ${span} daily`);

  const scopeSuffix =
    edge.scopeUsed === 'sym' ? '' : ` (${edge.scopeUsed === 'class' ? 'class' : 'global'})`;

  return (
    <span
      title={`Backtested edge${scopeSuffix}: win rate ${(edge.winRate * 100).toFixed(1)}%, ` +
        `avg win +${edge.avgWinPct.toFixed(2)}%, avg loss ${edge.avgLossPct.toFixed(2)}%, ` +
        `profit factor ${edge.profitFactor >= 9999 ? 'inf' : edge.profitFactor.toFixed(2)}, ` +
        `${edge.numTrades} trades, ${edge.testedFrom} to ${edge.testedTo}`}
      style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}
    >
      {parts.join(' | ')}{scopeSuffix}
    </span>
  );
}
