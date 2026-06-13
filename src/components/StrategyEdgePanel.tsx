'use client';

import { memo } from 'react';
import Panel from './Panel';
import EmptyState from './EmptyState';
import InfoTip from './InfoTip';
import { gloss } from '@/core/glossary';
import type { TradeBook } from '@/core/paper/tradebook';

interface Props {
  book: TradeBook | null;
  /** strategyId -> backtested win rate (0..1) from edge stats, global scope. */
  backtestWinRates?: Record<string, number>;
}

function fmtPnl(v: number) {
  if (!isFinite(v)) return '--';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

function pnlColor(v: number) {
  if (!isFinite(v)) return 'var(--text-muted)';
  return v >= 0 ? 'var(--color-up)' : 'var(--color-down)';
}

type Verdict = 'TRUST' | 'WATCH' | 'AVOID';

const MIN_LIVE_TRADES = 10;
/** Live win rate may lag backtest by this many percentage points and still be TRUST. */
const TOLERANCE_PP = 5;

/**
 * The "can I follow it blindly" verdict: does the strategy's LIVE record
 * match what its backtest promised?
 */
function verdictOf(
  liveWinRate: number,
  closedTrades: number,
  backtestWinRate: number | undefined,
): { verdict: Verdict; detail: string } {
  if (closedTrades < MIN_LIVE_TRADES) {
    return {
      verdict: 'WATCH',
      detail: `only ${closedTrades} closed live trade(s) - need ${MIN_LIVE_TRADES}+ to judge`,
    };
  }
  if (backtestWinRate == null) {
    return { verdict: 'WATCH', detail: 'no backtested edge stats yet - run edge compute' };
  }
  const gapPp = (backtestWinRate - liveWinRate) * 100;
  if (gapPp <= TOLERANCE_PP) {
    return {
      verdict: 'TRUST',
      detail: `live ${(liveWinRate * 100).toFixed(0)}% vs backtest ${(backtestWinRate * 100).toFixed(0)}% - tracking within ${TOLERANCE_PP}pp`,
    };
  }
  return {
    verdict: 'AVOID',
    detail: `live ${(liveWinRate * 100).toFixed(0)}% vs backtest ${(backtestWinRate * 100).toFixed(0)}% - ${gapPp.toFixed(0)}pp worse than promised`,
  };
}

function verdictColor(v: Verdict): string {
  if (v === 'TRUST') return 'var(--color-up)';
  if (v === 'AVOID') return 'var(--color-down)';
  return 'var(--color-accent)';
}

function StrategyEdgePanel({ book, backtestWinRates = {} }: Props) {
  if (!book) {
    return (
      <Panel title="STRATEGY EDGE" className="h-full">
        <EmptyState message="- loading -" />
      </Panel>
    );
  }

  const entries = Object.entries(book.byStrategy)
    .sort((a, b) => b[1].winRate - a[1].winRate);

  if (entries.length === 0) {
    return (
      <Panel
        title="STRATEGY EDGE"
        className="h-full"
        subtitle="Live scorecard: do strategies deliver in practice what their backtests promised? Builds as you take ideas."
        headerRight={<span>no paper trades yet</span>}
      >
        <EmptyState message="- no trades -" hint="run a scan and take ideas to build a track record" />
      </Panel>
    );
  }

  return (
    <Panel
      title="STRATEGY EDGE"
      className="h-full"
      subtitle="Live results vs backtest per strategy. TRUST = follow it; AVOID = the edge did not survive reality; WATCH = not enough live trades yet."
      info={gloss('strategyEdge').text}
      headerRight={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          VERDICT · WIN RATE · P&L
          <InfoTip term={gloss('trustVerdict').term} text={gloss('trustVerdict').text} />
        </span>
      }
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
        <thead>
          <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left',   padding: '2px 6px', fontWeight: 400 }}>STRATEGY</th>
            <th style={{ textAlign: 'center', padding: '2px 6px', fontWeight: 400 }}>VERDICT</th>
            <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>TRADES</th>
            <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }} title="closed live trades only">LIVE WIN%</th>
            <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }} title="backtested win rate, whole universe, hold cap applied">BT WIN%</th>
            <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>P&amp;L (CLOSED)</th>
            <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>MTM (OPEN)</th>
            <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>AVG P&amp;L%</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([id, stats]) => {
            const bt = backtestWinRates[id];
            const { verdict, detail } = verdictOf(stats.winRate, stats.closedTrades, bt);
            return (
              <tr key={id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '2px 6px', color: 'var(--color-accent)', fontWeight: 600 }}>{id}</td>
                <td style={{ padding: '2px 6px', textAlign: 'center', color: verdictColor(verdict), fontWeight: 700 }} title={detail}>
                  {verdict}
                </td>
                <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>
                  {stats.closedTrades}/{stats.trades}
                </td>
                <td style={{ padding: '2px 6px', textAlign: 'right', fontWeight: 600 }}>
                  {stats.closedTrades > 0 ? `${(stats.winRate * 100).toFixed(1)}%` : '--'}
                </td>
                <td style={{ padding: '2px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>
                  {bt != null ? `${(bt * 100).toFixed(1)}%` : '--'}
                </td>
                <td style={{ padding: '2px 6px', textAlign: 'right', color: pnlColor(stats.totalPnl), fontVariantNumeric: 'tabular-nums' }}>
                  {fmtPnl(stats.totalPnl)}
                </td>
                <td style={{ padding: '2px 6px', textAlign: 'right', color: pnlColor(stats.openUnrealizedPnl), fontVariantNumeric: 'tabular-nums' }}>
                  {stats.openUnrealizedPnl !== 0 ? `~${fmtPnl(stats.openUnrealizedPnl)}` : '--'}
                </td>
                <td style={{ padding: '2px 6px', textAlign: 'right', color: pnlColor(stats.avgPnlPct), fontVariantNumeric: 'tabular-nums' }}>
                  {`${stats.avgPnlPct >= 0 ? '+' : ''}${stats.avgPnlPct.toFixed(2)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

export default memo(StrategyEdgePanel);
