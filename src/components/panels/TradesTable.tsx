'use client';

import Panel from '@/components/primitives/Panel';
import EmptyState from '@/components/primitives/EmptyState';
import type { TradeRecord } from '@/core/backtest/engine';

interface Props {
  trades: TradeRecord[];
}

function exitReasonBadge(reason: TradeRecord['exitReason']) {
  switch (reason) {
    case 'stop':          return { text: 'STOP',   color: 'var(--color-down)' };
    case 'target':        return { text: 'TARGET', color: 'var(--color-up)' };
    case 'signal':        return { text: 'SIGNAL', color: 'var(--color-accent)' };
    case 'time':          return { text: 'TIME',   color: 'var(--color-accent)' };
    case 'end-of-series': return { text: 'EOS',    color: 'var(--text-muted)' };
  }
}

const th: React.CSSProperties = { textAlign: 'right', padding: '2px 8px', fontWeight: 400 };
const thLeft: React.CSSProperties = { ...th, textAlign: 'left' };

export default function TradesTable({ trades }: Props) {
  if (trades.length === 0) {
    return (
      <Panel title="CLOSED TRADES" className="h-full">
        <EmptyState message="— no trades —" hint="strategy produced no fills on this series" />
      </Panel>
    );
  }

  return (
    <Panel
      title={`CLOSED TRADES (${trades.length})`}
      className="h-full"
      info="Every simulated trade the backtest took: fills at the next bar's open, commission and slippage included, worst-case assumed when stop and target hit in the same bar."
    >
      <div style={{ overflow: 'auto', height: '100%' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-xs)' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
              <th style={thLeft}>#</th>
              <th style={thLeft}>SIDE</th>
              <th style={thLeft}>ENTRY DATE</th>
              <th style={th}>ENTRY</th>
              <th style={thLeft}>EXIT DATE</th>
              <th style={th}>EXIT</th>
              <th style={th}>HOLD</th>
              <th style={th}>P&amp;L%</th>
              <th style={{ ...th, textAlign: 'center' }}>EXIT VIA</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => {
              const badge = exitReasonBadge(t.exitReason);
              const pnlColor = t.pnlPct >= 0 ? 'var(--color-up)' : 'var(--color-down)';
              return (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '2px 8px', color: 'var(--text-muted)' }}>{i + 1}</td>
                  <td
                    style={{
                      padding: '2px 8px',
                      color: t.side === 'long' ? 'var(--color-up)' : 'var(--color-down)',
                      fontWeight: 700,
                    }}
                  >
                    {t.side.toUpperCase()}
                  </td>
                  <td style={{ padding: '2px 8px' }}>{t.entryTime}</td>
                  <td style={{ padding: '2px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {t.entryPrice.toFixed(2)}
                  </td>
                  <td style={{ padding: '2px 8px' }}>{t.exitTime}</td>
                  <td style={{ padding: '2px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {t.exitPrice.toFixed(2)}
                  </td>
                  <td style={{ padding: '2px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {t.holdingBars}d
                  </td>
                  <td
                    style={{
                      padding: '2px 8px',
                      textAlign: 'right',
                      color: pnlColor,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%
                  </td>
                  <td style={{ padding: '2px 8px', textAlign: 'center', color: badge.color }}>
                    {badge.text}
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
