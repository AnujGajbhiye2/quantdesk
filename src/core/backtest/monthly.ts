import type { EquityPoint } from './engine';

/**
 * Monthly returns derived from an equity curve. Pure - no DB, no I/O.
 * Return for month M = lastEquity(M) / lastEquity(M-1) - 1.
 * The first month (no prior month-end baseline; uses the curve's first point)
 * and the in-progress final month are flagged partial.
 */

export interface MonthlyReturn {
  year: number;
  /** 1..12 */
  month: number;
  returnPct: number;
  partial: boolean;
}

export function monthlyReturns(equityCurve: readonly EquityPoint[]): MonthlyReturn[] {
  if (equityCurve.length === 0) return [];

  // Last equity value per calendar month, in chronological order
  const monthKeys: string[] = [];
  const lastEquity = new Map<string, number>();
  for (const p of equityCurve) {
    const key = p.time.slice(0, 7); // 'YYYY-MM'
    if (!lastEquity.has(key)) monthKeys.push(key);
    lastEquity.set(key, p.equity);
  }

  const firstEquity = equityCurve[0].equity;
  const out: MonthlyReturn[] = [];

  for (let m = 0; m < monthKeys.length; m++) {
    const key  = monthKeys[m];
    const base = m === 0 ? firstEquity : lastEquity.get(monthKeys[m - 1])!;
    const end  = lastEquity.get(key)!;
    const returnPct = base !== 0 ? (end / base - 1) * 100 : 0;
    out.push({
      year:  Number(key.slice(0, 4)),
      month: Number(key.slice(5, 7)),
      returnPct,
      // First month is measured from mid-month entry; last month is in progress
      partial: m === 0 || m === monthKeys.length - 1,
    });
  }

  return out;
}
