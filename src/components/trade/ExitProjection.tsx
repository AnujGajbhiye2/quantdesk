'use client';

import Panel from '@/components/primitives/Panel';
import type { TradeIdea } from '@/core/types';

export interface ExitProjectionData {
  earliest:       string;
  latest:         string;
  medianHoldBars: number;
  source:         'symbol' | 'universe';
  sampleSize:     number;
}

interface Props {
  idea:       TradeIdea;
  projection: ExitProjectionData | null;
}

const row: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  padding: '2px 0',
  fontSize: 'var(--fs-xs)',
};

export default function ExitProjection({ idea, projection }: Props) {
  const sideColor = idea.side === 'long' ? 'var(--color-up)' : 'var(--color-down)';

  return (
    <Panel
      title="CURRENT SIGNAL"
      className="h-full"
      info="What this strategy says on the latest closed bar of this symbol, with its suggested stop, target and the historical exit window. Not quality-gated - this page is for inspecting a strategy; the dashboard applies the gate."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={row}>
          <span style={{ color: 'var(--text-muted)' }}>Signal</span>
          <span style={{ color: sideColor, fontWeight: 700 }}>
            {idea.side.toUpperCase()} {idea.symbol}
          </span>
        </div>
        <div style={row}>
          <span style={{ color: 'var(--text-muted)' }}>Entry</span>
          <span style={{ color: 'var(--color-accent)' }}>{idea.entryPrice.toFixed(2)}</span>
        </div>
        <div style={row}>
          <span style={{ color: 'var(--text-muted)' }}>Stop</span>
          <span style={{ color: 'var(--color-down)' }}>{idea.stopPrice.toFixed(2)}</span>
        </div>
        <div style={row}>
          <span style={{ color: 'var(--text-muted)' }}>Target</span>
          <span style={{ color: 'var(--color-up)' }}>{idea.targetPrice.toFixed(2)}</span>
        </div>
        <div style={row}>
          <span style={{ color: 'var(--text-muted)' }}>R/R</span>
          <span>{idea.rr.toFixed(2)}</span>
        </div>

        {projection ? (
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: '1px solid var(--border)',
              fontSize: 'var(--fs-xs)',
            }}
          >
            <div style={{ color: 'var(--text-primary)' }}>
              Based on {projection.sampleSize} winning trades
              {projection.source === 'universe' ? ' (universe-wide)' : ''}, median exit:
              +{projection.medianHoldBars} bars from entry
            </div>
            <div style={{ color: 'var(--color-accent)', marginTop: 2 }}>
              {projection.earliest} to {projection.latest}
            </div>
            <div style={{ color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
              Historical median - not a forecast.
            </div>
          </div>
        ) : (
          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: '1px solid var(--border)',
              color: 'var(--text-muted)',
              fontSize: 'var(--fs-xs)',
            }}
          >
            Not enough winning trades to project an exit window.
          </div>
        )}
      </div>
    </Panel>
  );
}
