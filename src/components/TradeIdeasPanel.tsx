'use client';

import Panel from './Panel';
import EmptyState from './EmptyState';
import type { TradeIdea } from '@/core/types';

interface Props {
  ideas:   TradeIdea[];
  onTake?: (idea: TradeIdea) => void;
  busy?:   boolean;
}

function fmt(n: number, dec = 2) {
  return isFinite(n) ? n.toFixed(dec) : '--';
}

function sideColor(side: 'long' | 'short') {
  return side === 'long' ? 'var(--color-up)' : 'var(--color-down)';
}

function rrColor(rr: number) {
  if (!isFinite(rr)) return 'var(--text-muted)';
  if (rr >= 2) return 'var(--color-up)';
  if (rr >= 1) return 'var(--color-accent)';
  return 'var(--color-down)';
}

export default function TradeIdeasPanel({ ideas, onTake, busy }: Props) {
  if (ideas.length === 0) {
    return (
      <Panel title="TRADE IDEAS" className="h-full" headerRight={<span>entry · stop · target · qty · R:R</span>}>
        <EmptyState message="— no ideas —" hint="run a scan to generate trade ideas" />
      </Panel>
    );
  }

  return (
    <Panel
      title="TRADE IDEAS"
      className="h-full"
      headerRight={<span style={{ color: 'var(--color-accent)' }}>{ideas.length} idea{ideas.length !== 1 ? 's' : ''}</span>}
    >
      <div style={{ overflowX: 'auto', overflowY: 'auto', height: '100%' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left',   padding: '2px 6px', fontWeight: 400 }}>SYMBOL</th>
              <th style={{ textAlign: 'center', padding: '2px 6px', fontWeight: 400 }}>SIDE</th>
              <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>ENTRY</th>
              <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>STOP</th>
              <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>TARGET</th>
              <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>QTY</th>
              <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>RISK$</th>
              <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>R:R</th>
              <th style={{ textAlign: 'left',   padding: '2px 6px', fontWeight: 400, maxWidth: 160 }}>REASON</th>
              {onTake && <th style={{ textAlign: 'center', padding: '2px 6px', fontWeight: 400 }}>ACTION</th>}
            </tr>
          </thead>
          <tbody>
            {ideas.map((idea, idx) => (
              <tr
                key={`${idea.symbol}-${idea.time}-${idx}`}
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <td style={{ padding: '3px 6px', color: 'var(--color-accent)', fontWeight: 600 }}>
                  {idea.symbol}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'center', color: sideColor(idea.side), fontWeight: 700 }}>
                  {idea.side.toUpperCase()}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(idea.entryPrice)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--color-down)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(idea.stopPrice)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--color-up)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(idea.targetPrice)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(idea.qty, 4)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--color-down)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(idea.riskAmount)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: rrColor(idea.rr), fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {isFinite(idea.rr) ? `${idea.rr.toFixed(1)}x` : '--'}
                </td>
                <td
                  style={{
                    padding: '3px 6px',
                    color: 'var(--text-muted)',
                    maxWidth: '160px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {idea.reason}
                </td>
                {onTake && (
                  <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                    <button
                      onClick={() => onTake(idea)}
                      disabled={busy}
                      style={{
                        background: 'var(--bg-panel)',
                        border: '1px solid var(--color-accent)',
                        color: 'var(--color-accent)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-xs)',
                        padding: '1px 8px',
                        cursor: 'pointer',
                      }}
                    >
                      TAKE
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
