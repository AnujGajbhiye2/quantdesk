'use client';

import { memo, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Panel from '@/components/primitives/Panel';
import { useTableSort } from '@/hooks/useTableSort';
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
                    <div
                      style={{
                        background: color,
                        height: '100%',
                        width: `${Math.round(c.strength * 100)}%`,
                      }}
                    />
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

function SignalDashboardPanel({ rows, signals, consensus = [], edges = {} }: Props) {
  const router = useRouter();
  // Index signals by symbol (latest per symbol if duplicate)
  const sigMap = useMemo(() => {
    const m = new Map<string, Signal>();
    for (const s of signals) m.set(s.symbol, s);
    return m;
  }, [signals]);

  const { sorted, clickHeader, indicator } = useTableSort(rows, {
    symbol: (r) => r.symbol,
    rsi:    (r) => r.rsi14,
    signal: (r) => sigMap.get(r.symbol)?.side ?? '',
  });

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
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
              <th
                onClick={() => clickHeader('symbol')}
                title="click to sort"
                style={{ textAlign: 'left', padding: '2px 6px', fontWeight: indicator('symbol') ? 700 : 400, cursor: 'pointer', userSelect: 'none' }}
              >
                SYMBOL{indicator('symbol')}
              </th>
              <th
                onClick={() => clickHeader('rsi')}
                title="click to sort"
                style={{ textAlign: 'right', padding: '2px 6px', fontWeight: indicator('rsi') ? 700 : 400, cursor: 'pointer', userSelect: 'none' }}
              >
                RSI(14){indicator('rsi')}
              </th>
              <th style={{ textAlign: 'center', padding: '2px 8px', fontWeight: 400 }}>MACD</th>
              <th style={{ textAlign: 'center', padding: '2px 8px', fontWeight: 400 }}>MA50/200</th>
              <th
                onClick={() => clickHeader('signal')}
                title="click to sort"
                style={{ textAlign: 'center', padding: '2px 8px', fontWeight: indicator('signal') ? 700 : 400, cursor: 'pointer', userSelect: 'none' }}
              >
                SIGNAL{indicator('signal')}
              </th>
              <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 400, maxWidth: 200 }}>REASON</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const macd   = macdBadge(row.macdState);
              const cross  = maCrossBadge(row.maCross);
              const sig    = sigMap.get(row.symbol);
              const badge  = signalBadge(sig);
              // Visual weight proportional to the strategy's backtested edge;
              // rows without an active signal keep full opacity.
              const edge = sig && sig.side !== 'flat'
                ? edges[`${sig.strategyId}|${sig.symbol}`] ?? null
                : null;
              const opacity = sig && sig.side !== 'flat'
                ? tierOpacity(edge?.tier ?? 'unknown')
                : 1;
              return (
                <tr key={row.symbol} style={{ borderBottom: '1px solid var(--border)', opacity }}>
                  <td
                    style={{ padding: '3px 6px', color: 'var(--color-accent)', fontWeight: 600, cursor: 'pointer' }}
                    title={`backtest ${row.symbol}`}
                    onClick={() => router.push(`/backtest?symbol=${row.symbol}`)}
                  >
                    {row.symbol}
                  </td>
                  <td
                    style={{
                      padding: '3px 6px',
                      textAlign: 'right',
                      color: rsiColor(row.rsi14),
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {isFinite(row.rsi14) ? row.rsi14.toFixed(1) : '--'}
                  </td>
                  <td style={{ padding: '3px 8px', textAlign: 'center', color: macd.color }}>
                    {macd.text}
                  </td>
                  <td style={{ padding: '3px 8px', textAlign: 'center', color: cross.color }}>
                    {cross.text}
                  </td>
                  <td
                    style={{
                      padding: '3px 8px',
                      textAlign: 'center',
                      color: badge.color,
                      fontWeight: 700,
                    }}
                  >
                    {badge.text}
                  </td>
                  <td
                    style={{
                      padding: '3px 6px',
                      color: 'var(--text-muted)',
                      maxWidth: '200px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {sig && sig.side !== 'flat' ? (
                      <>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sig.reason}</div>
                        <EdgeBadge edge={edge} compact />
                      </>
                    ) : (
                      sig?.reason ?? ''
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export default memo(SignalDashboardPanel);
