import 'server-only';

/**
 * Earnings blackout gate: block a new entry within N days of a symbol's next
 * known earnings date. A strategy's technical thesis (RSI oversold, band
 * touch, etc.) has no bearing on an earnings-driven gap - a stop sized for
 * normal daily range can be blown through overnight.
 *
 * Data source: Fundamentals.nextEarningsDate, fetched via the Yahoo adapter's
 * calendarEvents module and cached in fundamentals_cache (core/db/research.ts,
 * getCachedFundamentals). That cache is populated lazily when a symbol's
 * dossier is viewed - NOT proactively for the whole auto-trade universe - so
 * for most symbols this will have no data yet and the gate fails open (does
 * not block). Making this gate reliably effective needs a proactive fetch
 * job for the trading universe, which is out of scope here.
 *
 * Unevaluated: unlike the ADX and realized-vol regime gates, this cannot be
 * walk-forward tested without a free historical point-in-time earnings
 * calendar, which does not exist - Yahoo's calendarEvents only exposes the
 * NEXT upcoming date, not history. Ships as an opt-in gate on trust, not
 * backtest evidence.
 */

/** Days between two 'YYYY-MM-DD' date strings (b - a). */
function daysBetween(a: string, b: string): number {
  const msPerDay = 86_400_000;
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / msPerDay);
}

/**
 * True when `today` falls within `blackoutDays` of `nextEarningsDate`
 * (inclusive, and does not block AFTER the earnings date already passed -
 * only blocks entries taken shortly BEFORE it).
 */
export function isWithinEarningsBlackout(
  nextEarningsDate: string | null,
  today: string,
  blackoutDays: number,
): boolean {
  if (nextEarningsDate == null || blackoutDays <= 0) return false;
  const daysUntil = daysBetween(today, nextEarningsDate);
  return daysUntil >= 0 && daysUntil <= blackoutDays;
}

export function earningsBlackoutConfigFromEnv(): { blackoutDays: number } | null {
  if (process.env.EARNINGS_BLACKOUT_ENABLED !== '1') return null;
  return { blackoutDays: Number(process.env.EARNINGS_BLACKOUT_DAYS ?? 3) };
}
