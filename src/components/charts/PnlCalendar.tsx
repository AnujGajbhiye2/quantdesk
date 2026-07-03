'use client';

import Panel from '@/components/primitives/Panel';
import type { DailyPnl } from '@/core/paper/account';

interface Props {
  dailyPnl: DailyPnl[];
  /** How many trailing months to show (default 3). */
  months?: number;
}

// Layout constants - dense monospace grid, one row per month, one cell per day.
const CELL = 26;

function monthKey(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * Daily realized P&L calendar for the live paper account - the "did today
 * make money" view every backtest heatmap already has, but for real fills.
 * Green = positive day, red = negative, dim = no closed trades.
 */
export default function PnlCalendar({ dailyPnl, months = 3 }: Props) {
  const byDate = new Map(dailyPnl.map((d) => [d.date, d]));

  // Trailing month list ending at the current month
  const now = new Date();
  const monthList: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthList.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const monthTotal = (ym: string): number =>
    dailyPnl.filter((d) => monthKey(d.date) === ym).reduce((s, d) => s + d.pnl, 0);

  return (
    <Panel
      title="DAILY P&L"
      className="h-full"
      info="Realized P&L per calendar day from closed paper trades. Green made money, red lost, dim no exits. The month total is on the right."
    >
      <div style={{ padding: 8, overflowX: 'auto' }}>
        {monthList.map((ym) => {
          const total = monthTotal(ym);
          return (
            <div key={ym} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 56, color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', flexShrink: 0 }}>
                {ym}
              </span>
              <div style={{ display: 'flex', gap: 2 }}>
                {Array.from({ length: daysInMonth(ym) }, (_, i) => {
                  const date = `${ym}-${String(i + 1).padStart(2, '0')}`;
                  const d = byDate.get(date);
                  const bg = !d
                    ? 'var(--bg-panel-header)'
                    : d.pnl >= 0
                      ? '#26a641'
                      : '#f85149';
                  return (
                    <div
                      key={date}
                      title={d ? `${date}: ${d.pnl >= 0 ? '+' : ''}$${d.pnl.toFixed(2)} (${d.trades} trade${d.trades === 1 ? '' : 's'})` : date}
                      style={{
                        width: CELL,
                        height: CELL,
                        background: bg,
                        opacity: d ? 0.9 : 0.35,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 9,
                        color: d ? '#0a0e14' : 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {i + 1}
                    </div>
                  );
                })}
              </div>
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 'var(--fs-xs)',
                  color: total > 0 ? '#26a641' : total < 0 ? '#f85149' : 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {total >= 0 ? '+' : ''}${total.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
