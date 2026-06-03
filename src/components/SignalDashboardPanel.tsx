'use client';

import Panel from './Panel';
import EmptyState from './EmptyState';
import type { MarketRow } from '@/core/market/snapshot';
import type { Signal } from '@/core/types';

interface Props {
  rows:    MarketRow[];
  signals: Signal[];
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

export default function SignalDashboardPanel({ rows, signals }: Props) {
  // Index signals by symbol (latest per symbol if duplicate)
  const sigMap = new Map<string, Signal>();
  for (const s of signals) sigMap.set(s.symbol, s);

  if (rows.length === 0) {
    return (
      <Panel title="SIGNAL DASHBOARD" headerRight={<span>RSI · MACD · MA · STRATEGY</span>}>
        <EmptyState message="— no data —" hint="ingest market data first" />
      </Panel>
    );
  }

  return (
    <Panel title="SIGNAL DASHBOARD" headerRight={<span>RSI(14) · MACD · MA50/200 · SIGNAL</span>}>
      <div style={{ overflowX: 'auto', overflowY: 'auto', height: '100%' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 400 }}>SYMBOL</th>
              <th style={{ textAlign: 'right', padding: '2px 6px', fontWeight: 400 }}>RSI(14)</th>
              <th style={{ textAlign: 'center', padding: '2px 8px', fontWeight: 400 }}>MACD</th>
              <th style={{ textAlign: 'center', padding: '2px 8px', fontWeight: 400 }}>MA50/200</th>
              <th style={{ textAlign: 'center', padding: '2px 8px', fontWeight: 400 }}>SIGNAL</th>
              <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 400, maxWidth: 200 }}>REASON</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const macd   = macdBadge(row.macdState);
              const cross  = maCrossBadge(row.maCross);
              const sig    = sigMap.get(row.symbol);
              const badge  = signalBadge(sig);
              return (
                <tr key={row.symbol} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '3px 6px', color: 'var(--color-accent)', fontWeight: 600 }}>
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
                    {sig?.reason ?? ''}
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
