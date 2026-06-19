/**
 * US market hours gate.
 *
 * Checks whether US equity regular trading hours (RTH) are open:
 *   09:30 - 16:00 US/Eastern, Monday-Friday, excluding major US holidays.
 *
 * Intentionally dependency-free - uses only Date math.
 * No external API calls; suitable for tight cron loops.
 */

// ---------------------------------------------------------------------------
// US federal market holidays (NYSE observed dates).
// Add the current year's dates as needed; the list is small and stable.
// Format: 'YYYY-MM-DD' in US/Eastern local date.
// ---------------------------------------------------------------------------
const MARKET_HOLIDAYS_2024 = [
  '2024-01-01', // New Year's Day
  '2024-01-15', // MLK Day
  '2024-02-19', // Presidents Day
  '2024-03-29', // Good Friday
  '2024-05-27', // Memorial Day
  '2024-06-19', // Juneteenth
  '2024-07-04', // Independence Day
  '2024-09-02', // Labor Day
  '2024-11-28', // Thanksgiving
  '2024-11-29', // Black Friday (early close - treat as holiday for simplicity)
  '2024-12-25', // Christmas
];

const MARKET_HOLIDAYS_2025 = [
  '2025-01-01', // New Year's Day
  '2025-01-09', // National Day of Mourning (Jimmy Carter)
  '2025-01-20', // MLK Day + Inauguration Day
  '2025-02-17', // Presidents Day
  '2025-04-18', // Good Friday
  '2025-05-26', // Memorial Day
  '2025-06-19', // Juneteenth
  '2025-07-04', // Independence Day
  '2025-09-01', // Labor Day
  '2025-11-27', // Thanksgiving
  '2025-11-28', // Black Friday (early close)
  '2025-12-25', // Christmas
];

const MARKET_HOLIDAYS_2026 = [
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed, 4th is Saturday)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-11-27', // Black Friday
  '2026-12-25', // Christmas
];

const HOLIDAY_SET = new Set([
  ...MARKET_HOLIDAYS_2024,
  ...MARKET_HOLIDAYS_2025,
  ...MARKET_HOLIDAYS_2026,
]);

// US/Eastern UTC offset in minutes:
//   EST = UTC-5 (Nov -> Mar)  -> -300
//   EDT = UTC-4 (Mar -> Nov)  -> -240
// We approximate DST using the IANA 2nd-Sunday-in-March / 1st-Sunday-in-November rule.
function etOffsetMinutes(d: Date): number {
  const year = d.getUTCFullYear();

  // DST start: 2nd Sunday in March at 02:00 ET
  const dstStart = nthSundayOfMonth(year, 2 /* March */, 2);
  dstStart.setUTCHours(7, 0, 0, 0); // 02:00 ET = 07:00 UTC during EST

  // DST end: 1st Sunday in November at 02:00 ET
  const dstEnd = nthSundayOfMonth(year, 10 /* November */, 1);
  dstEnd.setUTCHours(6, 0, 0, 0); // 02:00 ET = 06:00 UTC during EDT

  return d >= dstStart && d < dstEnd ? -240 : -300; // EDT vs EST
}

function nthSundayOfMonth(year: number, month: number, n: number): Date {
  // month: 0-indexed (2=March, 10=November)
  const d = new Date(Date.UTC(year, month, 1));
  const firstSunday = (7 - d.getUTCDay()) % 7;
  return new Date(Date.UTC(year, month, 1 + firstSunday + (n - 1) * 7));
}

/**
 * Convert a UTC Date to a US/Eastern local date string 'YYYY-MM-DD'.
 */
function etDateString(d: Date): string {
  const offset = etOffsetMinutes(d);
  const local  = new Date(d.getTime() + offset * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Return the total ET minutes-since-midnight for a given UTC Date.
 */
function etMinuteOfDay(d: Date): number {
  const offset = etOffsetMinutes(d);
  const local  = new Date(d.getTime() + offset * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/**
 * Returns true when US equity regular trading hours are open.
 *
 * RTH = Monday-Friday, 09:30-16:00 US/Eastern, excluding NYSE holidays.
 *
 * @param now - Point in time to test. Defaults to current system time.
 */
export function isUsMarketOpen(now: Date = new Date()): boolean {
  // Weekend check (ET)
  const offset  = etOffsetMinutes(now);
  const localMs = now.getTime() + offset * 60_000;
  const localDow = new Date(localMs).getUTCDay(); // 0=Sun, 6=Sat
  if (localDow === 0 || localDow === 6) return false;

  // Holiday check
  const dateStr = etDateString(now);
  if (HOLIDAY_SET.has(dateStr)) return false;

  // Time-of-day check: 09:30 (570 min) - 16:00 (960 min)
  const minOfDay = etMinuteOfDay(now);
  return minOfDay >= 570 && minOfDay < 960;
}

/**
 * Returns true when we are within `minutesBefore` minutes of the 16:00 ET close.
 * Used to block new entries too close to the bell.
 */
export function isNearMarketClose(minutesBefore = 30, now: Date = new Date()): boolean {
  const minOfDay = etMinuteOfDay(now);
  return minOfDay >= (960 - minutesBefore) && minOfDay < 960;
}

/**
 * Returns ET local time as 'HH:MM' for display.
 */
export function etTimeString(now: Date = new Date()): string {
  const offset = etOffsetMinutes(now);
  const local  = new Date(now.getTime() + offset * 60_000);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
