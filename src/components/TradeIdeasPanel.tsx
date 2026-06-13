'use client';

import { memo } from 'react';
import { useRouter } from 'next/navigation';
import Panel from './Panel';
import EmptyState from './EmptyState';
import EdgeBadge from './EdgeBadge';
import { fmtMoney } from '@/core/format/currency';
import { tierOpacity } from '@/core/edge/score';
import type { EnrichedTradeIdea } from '@/core/signals/gate';

export type IdeaSortKey = 'symbol' | 'entry' | 'qty' | 'risk' | 'rr' | 'conv';

function convColor(band: string | undefined): string {
  if (band === 'STRONG') return 'var(--color-up)';
  if (band === 'WEAK')   return 'var(--color-down)';
  return 'var(--color-accent)';
}

interface Props {
  ideas:      EnrichedTradeIdea[];
  onTake?:    (idea: EnrichedTradeIdea) => void;
  busy?:      boolean;
  /** Map strategyId -> display name for the edge badge. */
  strategyNames?: Record<string, string>;
  /** Keyboard focus zone active ([i] pressed) - highlights the panel border. */
  focused?:   boolean;
  /** Index of the keyboard-selected idea row; -1 = none. */
  selected?:  number;
  /** Header-click sorting handlers (state lives in Dashboard so j/k stays aligned). */
  sort?: { click: (key: IdeaSortKey) => void; indicator: (key: IdeaSortKey) => string };
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

function TradeIdeasPanel({ ideas, onTake, busy, strategyNames = {}, focused, selected = -1, sort }: Props) {
  const router = useRouter();
  const sortableTh = (key: IdeaSortKey, label: string, align: 'left' | 'center' | 'right') => (
    <th
      onClick={sort ? () => sort.click(key) : undefined}
      title={sort ? 'click to sort' : undefined}
      style={{
        textAlign: align,
        padding: '2px 6px',
        fontWeight: sort && sort.indicator(key) ? 700 : 400,
        cursor: sort ? 'pointer' : undefined,
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {label}{sort ? sort.indicator(key) : ''}
    </th>
  );
  if (ideas.length === 0) {
    return (
      <Panel title="TRADE IDEAS" className="h-full" headerRight={<span>entry · stop · target · qty · risk · R:R</span>}>
        <EmptyState message="— no ideas —" hint="run a scan to generate trade ideas" />
      </Panel>
    );
  }

  const passedCount = ideas.filter((i) => i.gate.passed).length;
  const noEdgeData = ideas.every((i) => i.edge === null);

  return (
    <div
      className="h-full"
      style={focused ? { outline: '1px solid var(--color-accent)', outlineOffset: -1 } : undefined}
    >
    <Panel
      title="TRADE IDEAS"
      className="h-full"
      subtitle="Signals that passed the quality gate, turned into executable orders: entry, stop, target, size. This is your action list."
      info="Concrete entries from the last scan: entry, stop, target, position size and risk per trade. GATED rows failed the quality filter (R:R under 1.5, win rate under 40%, or fewer than 15 trades of history) - shown muted with the reason so you know the system is filtering, not broken. [i] focuses the panel, Enter-Enter opens a paper trade."
      headerRight={
        <span style={{ color: 'var(--color-accent)' }}>
          {focused
            ? '[j/k] nav · [Enter] take · [Esc] exit'
            : noEdgeData
              ? 'edge data missing - run edge compute'
              : `${passedCount}/${ideas.length} pass quality gate`}
        </span>
      }
    >
      <div style={{ overflowX: 'auto', overflowY: 'auto', height: '100%' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
              {sortableTh('symbol', 'SYMBOL', 'left')}
              <th style={{ textAlign: 'center', padding: '2px 6px', fontWeight: 400 }}>SIDE</th>
              {sortableTh('entry', 'ENTRY', 'right')}
              <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>STOP</th>
              <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>TARGET</th>
              {sortableTh('qty', 'QTY', 'right')}
              {sortableTh('risk', 'RISK', 'right')}
              {sortableTh('rr', 'R:R', 'right')}
              {sortableTh('conv', 'CONV', 'right')}
              <th style={{ textAlign: 'left',   padding: '2px 6px', fontWeight: 400, maxWidth: 220 }}>REASON / EDGE</th>
              {onTake && <th style={{ textAlign: 'center', padding: '2px 6px', fontWeight: 400 }}>ACTION</th>}
            </tr>
          </thead>
          <tbody>
            {ideas.map((idea, idx) => {
              const gated = !idea.gate.passed;
              const opacity = gated ? 0.45 : tierOpacity(idea.edge?.tier ?? 'unknown');
              const isSelected = focused && idx === selected;
              return (
                <tr
                  key={`${idea.symbol}-${idea.strategyId}-${idea.time}-${idx}`}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    opacity: isSelected ? 1 : opacity,
                    color: gated ? 'var(--text-muted)' : undefined,
                    background: isSelected ? 'var(--bg-panel-header)' : 'transparent',
                  }}
                >
                  <td
                    style={{ padding: '3px 6px', color: gated ? 'var(--text-muted)' : 'var(--color-accent)', fontWeight: 600, cursor: 'pointer' }}
                    title={`backtest ${idea.symbol}`}
                    onClick={() => router.push(`/backtest?symbol=${idea.symbol}`)}
                  >
                    {idea.symbol}
                  </td>
                  <td
                    style={{
                      padding: '3px 6px',
                      textAlign: 'center',
                      color: gated ? 'var(--text-muted)' : sideColor(idea.side),
                      fontWeight: 700,
                    }}
                  >
                    {gated ? 'GATED' : idea.side.toUpperCase()}
                  </td>
                  <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoney(idea.entryPrice, idea.currency)}
                  </td>
                  <td style={{ padding: '3px 6px', textAlign: 'right', color: gated ? undefined : 'var(--color-down)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoney(idea.stopPrice, idea.currency)}
                  </td>
                  <td style={{ padding: '3px 6px', textAlign: 'right', color: gated ? undefined : 'var(--color-up)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoney(idea.targetPrice, idea.currency)}
                  </td>
                  <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(idea.qty, 4)}
                  </td>
                  <td style={{ padding: '3px 6px', textAlign: 'right', color: gated ? undefined : 'var(--color-down)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoney(idea.riskAmount, idea.currency)}
                  </td>
                  <td style={{ padding: '3px 6px', textAlign: 'right', color: gated ? undefined : rrColor(idea.rr), fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {isFinite(idea.rr) ? `${idea.rr.toFixed(1)}x` : '--'}
                  </td>
                  <td
                    style={{
                      padding: '3px 6px',
                      textAlign: 'right',
                      color: gated ? 'var(--text-muted)' : convColor(idea.conviction?.band),
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                    title={idea.conviction
                      ? idea.conviction.components.map((c) => `${c.label}: ${c.detail}`).join('\n')
                      : 'conviction not computed'}
                  >
                    {idea.conviction ? `${idea.conviction.score}` : '--'}
                  </td>
                  <td
                    style={{
                      padding: '3px 6px',
                      color: 'var(--text-muted)',
                      maxWidth: '220px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={gated ? `insufficient edge - ${idea.gate.reason}` : idea.reason}
                  >
                    {gated ? (
                      <span>insufficient edge - {idea.gate.reason}</span>
                    ) : (
                      <>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{idea.reason}</div>
                        <EdgeBadge
                          edge={idea.edge}
                          strategyName={strategyNames[idea.strategyId] ?? idea.strategyId}
                          compact
                        />
                      </>
                    )}
                  </td>
                  {onTake && (
                    <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                      {!gated && (
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
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
    </div>
  );
}

export default memo(TradeIdeasPanel);
