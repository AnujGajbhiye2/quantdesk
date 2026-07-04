'use client';

import { useMemo, useState, type CSSProperties } from 'react';
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

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Daily realized P&L calendar for the live paper account, one month at a
 * time with prev/next nav. Same visual language as MonthlyReturnsHeatmap -
 * intensity-scaled rgba background rather than flat blocks, so a -$400 day
 * reads darker than a -$4 one instead of both just being "red".
 */
export default function PnlCalendar({ dailyPnl }: Props) {
  const now = new Date();
  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed

  const byDate = new Map(dailyPnl.map((d) => [d.date, d]));
  const ym = `${year}-${String(month + 1).padStart(2, '0')}`;

  const { total, maxAbs } = useMemo(() => {
    const inMonth = dailyPnl.filter((d) => d.date.slice(0, 7) === ym);
    return {
      total: inMonth.reduce((s, d) => s + d.pnl, 0),
      maxAbs: inMonth.reduce((m, d) => Math.max(m, Math.abs(d.pnl)), 0),
    };
  }, [dailyPnl, ym]);

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
  const today = todayISO();

  return (
    <Panel
      title="DAILY P&L"
      className="h-full"
      info="Realized P&L per calendar day from closed paper trades. Shading intensity scales with the size of the day's P&L within this month; dim = no closed trades."
    >
      <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button type="button" onClick={() => shift(-1)} style={navBtnStyle}>{'<'}</button>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-primary)' }}>
            {new Date(year, month, 1).toLocaleString('en-US', { month: 'long' })} {year}
          </span>
          <button type="button" onClick={() => shift(1)} style={navBtnStyle}>{'>'}</button>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-xs)', tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              {WEEKDAYS.map((w, i) => (
                <th key={i} style={{ padding: '2px 0', fontWeight: 400 }}>{w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.ceil(cells.length / 7) }, (_, row) => (
              <tr key={row}>
                {cells.slice(row * 7, row * 7 + 7).map((day, ci) => {
                  if (day == null) return <td key={`e${ci}`} style={{ padding: 2 }} />;
                  const date = `${ym}-${String(day).padStart(2, '0')}`;
                  const d = byDate.get(date);
                  const intensity = d && maxAbs > 0 ? Math.abs(d.pnl) / maxAbs : 0;
                  const base = d && d.pnl >= 0 ? '38, 166, 65' : '248, 81, 73';
                  return (
                    <td
                      key={date}
                      title={d ? `${date}: ${d.pnl >= 0 ? '+' : ''}$${d.pnl.toFixed(2)} (${d.trades} trade${d.trades === 1 ? '' : 's'})` : date}
                      style={{
                        padding: '4px 0',
                        textAlign: 'center',
                        fontVariantNumeric: 'tabular-nums',
                        background: d ? `rgba(${base}, ${(0.12 + 0.55 * intensity).toFixed(2)})` : 'var(--bg-panel-header)',
                        color: 'var(--text-primary)',
                        border: date === today ? '1px dotted var(--color-accent)' : '1px solid var(--bg-panel)',
                        opacity: d ? 1 : 0.5,
                      }}
                    >
                      {day}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

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
