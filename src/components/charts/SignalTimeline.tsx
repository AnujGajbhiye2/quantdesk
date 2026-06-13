'use client';

import { useEffect, useState } from 'react';
import type { SignalHistoryItem } from '@/app/api/signals/route';

interface Props {
  symbol: string;
  /** Map strategyId -> display name. */
  strategyNames?: Record<string, string>;
}

function sideGlyph(side: SignalHistoryItem['side']): { glyph: string; color: string } {
  if (side === 'long')  return { glyph: 'L', color: 'var(--color-up)' };
  if (side === 'short') return { glyph: 'S', color: 'var(--color-down)' };
  return { glyph: 'X', color: 'var(--color-accent)' };
}

/**
 * Was the signal "right"? Long wants a positive forward move, short a
 * negative one. Exit (flat) signals carry no direction - always muted.
 */
function fwdColor(side: SignalHistoryItem['side'], fwd: number | null): string {
  if (fwd === null || side === 'flat') return 'var(--text-muted)';
  const right = side === 'long' ? fwd > 0 : fwd < 0;
  return right ? 'var(--color-up)' : 'var(--color-down)';
}

function fmtFwd(v: number | null): string {
  if (v === null) return '--';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

/**
 * Signal history below the backtest chart: one lane per strategy, every past
 * signal as a flag with the realized +5-bar move. Builds intuition for which
 * strategies actually fire reliably on this symbol. Retrospective display
 * only - the forward returns play no part in signal generation.
 */
export default function SignalTimeline({ symbol, strategyNames = {} }: Props) {
  const [items, setItems]     = useState<SignalHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) { setItems([]); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/signals?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d: { items?: SignalHistoryItem[] }) => {
        if (!cancelled) setItems(d.items ?? []);
      })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);

  if (!symbol) return null;

  // Lane per strategy, signals already oldest-first from the API
  const lanes = new Map<string, SignalHistoryItem[]>();
  for (const item of items) {
    const lane = lanes.get(item.strategyId) ?? [];
    lane.push(item);
    lanes.set(item.strategyId, lane);
  }
  const laneIds = [...lanes.keys()].sort();

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '2px 8px',
          background: 'var(--bg-panel-header)',
          borderBottom: '1px solid var(--border)',
          fontSize: 'var(--fs-xs)',
          letterSpacing: '0.08em',
          color: 'var(--text-muted)',
        }}
      >
        <span>[ SIGNAL HISTORY - {symbol} ]</span>
        <span title="realized close-to-close move 5 bars after each signal - retrospective only, not used for signal generation">
          flag = stored signal · badge = +5-bar move · green = signal direction was right
        </span>
      </div>

      {loading && items.length === 0 && (
        <div style={{ padding: '8px 10px', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
          loading...
        </div>
      )}

      {!loading && laneIds.length === 0 && (
        <div style={{ padding: '8px 10px', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
          no stored signals for {symbol} yet - signals accumulate from scans and the nightly EOD run
        </div>
      )}

      {laneIds.map((id) => {
        const lane = lanes.get(id)!;
        return (
          <div
            key={id}
            style={{
              display: 'flex',
              alignItems: 'center',
              borderBottom: '1px solid var(--border)',
              fontSize: 'var(--fs-xs)',
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 150,
                padding: '3px 8px',
                color: 'var(--text-primary)',
                borderRight: '1px solid var(--border)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`${lane.length} signal(s) on record`}
            >
              {strategyNames[id] ?? id}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 10,
                overflowX: 'auto',
                padding: '3px 8px',
                whiteSpace: 'nowrap',
              }}
            >
              {lane.map((item, i) => {
                const side = sideGlyph(item.side);
                return (
                  <span
                    key={`${item.time}-${i}`}
                    title={`${item.time} ${item.side.toUpperCase()} - ${item.reason}\n+5 bars: ${fmtFwd(item.fwd5Pct)} · +10 bars: ${fmtFwd(item.fwd10Pct)}`}
                    style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}
                  >
                    <span style={{ color: 'var(--text-muted)' }}>{item.time.slice(2)}</span>
                    <span style={{ color: side.color, fontWeight: 700 }}>{side.glyph}</span>
                    <span style={{ color: fwdColor(item.side, item.fwd5Pct), fontVariantNumeric: 'tabular-nums' }}>
                      {fmtFwd(item.fwd5Pct)}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
