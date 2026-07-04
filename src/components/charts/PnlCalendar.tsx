'use client';

import { useState, type CSSProperties } from 'react';
import Panel from '@/components/primitives/Panel';
import type { DailyPnl } from '@/core/paper/account';

interface Props {
  dailyPnl: DailyPnl[];
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}
function firstWeekday(y: number, m: number): number {
  return new Date(y, m, 1).getDay();
}

const navBtnStyle: CSSProperties = {
  background:   'var(--bg-panel)',
  border:       '1px solid var(--border)',
  color:        'var(--color-accent)',
  fontFamily:   'var(--font-mono)',
  fontSize:     'var(--fs-xs)',
  padding:      '2px 10px',
  cursor:       'pointer',
};

/**
 * Daily realized P&L calendar for the live paper account, one month at a
 * time with prev/next nav - the "did today make money" view every backtest
 * heatmap already has, but for real fills. Green = positive day, red =
 * negative, dim = no closed trades.
 */
export default function PnlCalendar({ dailyPnl }: Props) {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed

  const byDate = new Map(dailyPnl.map((d) => [d.date, d]));
  const ym = `${year}-${String(month + 1).padStart(2, '0')}`;
  const total = dailyPnl
    .filter((d) => d.date.slice(0, 7) === ym)
    .reduce((s, d) => s + d.pnl, 0);

  function shift(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 0)  { m = 11; y -= 1; }
    if (m > 11) { m = 0;  y += 1; }
    setMonth(m);
    setYear(y);
  }

  const numDays  = daysInMonth(year, month);
  const startDow = firstWeekday(year, month);
  const cells: (number | null)[] = [
    ...Array.from({ length: startDow }, () => null),
    ...Array.from({ length: numDays }, (_, i) => i + 1),
  ];

  return (
    <Panel
      title="DAILY P&L"
      className="h-full"
      info="Realized P&L per calendar day from closed paper trades. Green made money, red lost, dim no exits."
    >
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button type="button" onClick={() => shift(-1)} style={navBtnStyle}>{'<'}</button>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-primary)' }}>
            {new Date(year, month, 1).toLocaleString('en-US', { month: 'long' })} {year}
          </span>
          <button type="button" onClick={() => shift(1)} style={navBtnStyle}>{'>'}</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {WEEKDAYS.map((w, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              {w}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day == null) return <div key={`empty-${i}`} />;
            const date = `${ym}-${String(day).padStart(2, '0')}`;
            const d = byDate.get(date);
            const bg = !d
              ? 'var(--bg-panel-header)'
              : d.pnl >= 0 ? '#26a641' : '#f85149';
            return (
              <div
                key={date}
                title={d ? `${date}: ${d.pnl >= 0 ? '+' : ''}$${d.pnl.toFixed(2)} (${d.trades} trade${d.trades === 1 ? '' : 's'})` : date}
                style={{
                  aspectRatio: '1',
                  background: bg,
                  opacity: d ? 0.9 : 0.35,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'var(--fs-xs)',
                  color: d ? '#0a0e14' : 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {day}
              </div>
            );
          })}
        </div>

        <div
          style={{
            textAlign: 'center',
            fontSize: 'var(--fs-sm)',
            fontWeight: 700,
            color: total > 0 ? '#26a641' : total < 0 ? '#f85149' : 'var(--text-muted)',
          }}
        >
          {total >= 0 ? '+' : ''}${total.toFixed(2)}
        </div>
      </div>
    </Panel>
  );
}
