'use client';

import { useMemo } from 'react';
import Panel from '@/components/primitives/Panel';
import EmptyState from '@/components/primitives/EmptyState';
import { monthlyReturns } from '@/core/backtest/monthly';
import type { EquityPoint } from '@/core/backtest/engine';

interface Props {
  equityCurve: EquityPoint[];
}

const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export default function MonthlyReturnsHeatmap({ equityCurve }: Props) {
  const { byYearMonth, years, maxAbs } = useMemo(() => {
    const rows = monthlyReturns(equityCurve);
    const byYearMonth = new Map<string, { returnPct: number; partial: boolean }>();
    const yearSet = new Set<number>();
    let maxAbs = 0;
    for (const r of rows) {
      byYearMonth.set(`${r.year}-${r.month}`, { returnPct: r.returnPct, partial: r.partial });
      yearSet.add(r.year);
      maxAbs = Math.max(maxAbs, Math.abs(r.returnPct));
    }
    return { byYearMonth, years: [...yearSet].sort(), maxAbs };
  }, [equityCurve]);

  if (years.length === 0) {
    return (
      <Panel title="MONTHLY RETURNS" className="h-full">
        <EmptyState message="— no equity data —" />
      </Panel>
    );
  }

  return (
    <Panel
      title="MONTHLY RETURNS"
      className="h-full"
      info="Backtest return by calendar month - shows seasonality and how long losing streaks actually run. A strategy you would abandon after three red months in a row is not a strategy you can trade."
      headerRight={<span>* = partial month</span>}
    >
      <div style={{ overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 'var(--fs-xs)' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th style={{ padding: '2px 8px', textAlign: 'left', fontWeight: 400 }}>YEAR</th>
              {MONTH_LABELS.map((m) => (
                <th key={m} style={{ padding: '2px 6px', textAlign: 'center', fontWeight: 400 }}>
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {years.map((year) => (
              <tr key={year}>
                <td style={{ padding: '2px 8px', color: 'var(--text-muted)' }}>{year}</td>
                {MONTH_LABELS.map((_, mi) => {
                  const cell = byYearMonth.get(`${year}-${mi + 1}`);
                  if (!cell) {
                    return <td key={mi} style={{ padding: '2px 6px' }} />;
                  }
                  const intensity = maxAbs > 0 ? Math.abs(cell.returnPct) / maxAbs : 0;
                  const base = cell.returnPct >= 0 ? '38, 166, 65' : '248, 81, 73';
                  return (
                    <td
                      key={mi}
                      title={`${year}-${String(mi + 1).padStart(2, '0')}: ${cell.returnPct.toFixed(2)}%${cell.partial ? ' (partial)' : ''}`}
                      style={{
                        padding: '2px 6px',
                        textAlign: 'center',
                        fontVariantNumeric: 'tabular-nums',
                        background: `rgba(${base}, ${(0.12 + 0.55 * intensity).toFixed(2)})`,
                        color: 'var(--text-primary)',
                        border: cell.partial
                          ? '1px dotted var(--text-muted)'
                          : '1px solid var(--bg-panel)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {cell.returnPct >= 0 ? '+' : ''}{cell.returnPct.toFixed(1)}{cell.partial ? '*' : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
