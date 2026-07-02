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
// US federal market holidays (NYSE observed dates), computed algorithmically.
//
// Previously this was a hand-maintained table covering only 2024-2026, which
// would silently stop blocking holiday trading once the table ran out (the
// auto-trade loop would fire into a closed market on New Year's Day 2027).
// Rules below are fixed by NYSE calendar convention and don't need yearly
// maintenance. One irreducibly manual case: Good Friday (not a fixed-offset
// holiday - it's the Friday before Easter, itself computed via the
// anonymous Gregorian algorithm below).
//
// Ad-hoc one-off closures (e.g. 2025's National Day of Mourning for a former
// president) are NOT covered - those are unpredictable by rule. If the venue
// announces one, add it to EXTRA_HOLIDAYS below.
// ---------------------------------------------------------------------------

/** One-off closures that can't be derived by rule (unpredictable in advance). */
const EXTRA_HOLIDAYS = new Set<string>([
  '2025-01-09', // National Day of Mourning (Jimmy Carter)
]);

function toDateStr(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** nth (1-indexed) weekday-of-week `dow` (0=Sun..6=Sat) in a given month. month is 1-indexed. */
function nthWeekday(year: number, month: number, dow: number, n: number): { m: number; d: number } {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = first.getUTCDay();
  const offset = (dow - firstDow + 7) % 7;
  return { m: month, d: 1 + offset + (n - 1) * 7 };
}

/** Last weekday-of-week `dow` in a given month. month is 1-indexed. */
function lastWeekday(year: number, month: number, dow: number): { m: number; d: number } {
  const last = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day of this month
  const lastDow = last.getUTCDay();
  const back = (lastDow - dow + 7) % 7;
  return { m: month, d: last.getUTCDate() - back };
}

/** Easter Sunday (Gregorian) via the anonymous algorithm. Returns {m, d}, month 1-indexed. */
function easterSunday(year: number): { m: number; d: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}

/** If a fixed-date holiday falls on a weekend, NYSE observes the nearest weekday. */
function observedWeekday(year: number, month: number, day: number): { m: number; d: number } {
  const dt = new Date(Date.UTC(year, month - 1, day));
  const dow = dt.getUTCDay();
  if (dow === 6) { // Saturday -> observed Friday before
    const shifted = new Date(Date.UTC(year, month - 1, day - 1));
    return { m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
  }
  if (dow === 0) { // Sunday -> observed Monday after
    const shifted = new Date(Date.UTC(year, month - 1, day + 1));
    return { m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
  }
  return { m: month, d: day };
}

/** Compute the full set of NYSE holiday date strings for a given year. */
function nyseHolidaysForYear(year: number): string[] {
  const dates: { m: number; d: number }[] = [];

  dates.push(observedWeekday(year, 1, 1));           // New Year's Day
  dates.push(nthWeekday(year, 1, 1, 3));              // MLK Day: 3rd Monday of January
  dates.push(nthWeekday(year, 2, 1, 3));              // Presidents Day: 3rd Monday of February
  const easter = easterSunday(year);
  const goodFriday = new Date(Date.UTC(year, easter.m - 1, easter.d - 2));
  dates.push({ m: goodFriday.getUTCMonth() + 1, d: goodFriday.getUTCDate() }); // Good Friday
  dates.push(lastWeekday(year, 5, 1));                // Memorial Day: last Monday of May
  dates.push(observedWeekday(year, 6, 19));           // Juneteenth (since 2022)
  dates.push(observedWeekday(year, 7, 4));            // Independence Day
  dates.push(nthWeekday(year, 9, 1, 1));               // Labor Day: 1st Monday of September
  dates.push(nthWeekday(year, 11, 4, 4));              // Thanksgiving: 4th Thursday of November

  const xmas = observedWeekday(year, 12, 25);
  dates.push(xmas);                                    // Christmas

  return dates.map((x) => toDateStr(year, x.m, x.d));
}

/** Memoized per-year holiday sets so the algorithm doesn't re-run on every call. */
const holidayCache = new Map<number, Set<string>>();

function holidaySetForYear(year: number): Set<string> {
  let set = holidayCache.get(year);
  if (!set) {
    set = new Set(nyseHolidaysForYear(year));
    holidayCache.set(year, set);
  }
  return set;
}

function isMarketHoliday(dateStr: string): boolean {
  const year = Number(dateStr.slice(0, 4));
  if (holidaySetForYear(year).has(dateStr)) return true;
  return EXTRA_HOLIDAYS.has(dateStr);
}

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
 * NYSE half-days (1:00pm ET early close instead of 4:00pm): the day after
 * Thanksgiving (always), and Christmas Eve when it falls on a business day.
 * Previously the holiday table just treated the day-after-Thanksgiving as a
 * full closure "for simplicity" - wrong: the market is open in the morning.
 */
function isHalfDay(dateStr: string): boolean {
  const year = Number(dateStr.slice(0, 4));
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  const dayAfter = new Date(Date.UTC(year, thanksgiving.m - 1, thanksgiving.d + 1));
  if (toDateStr(year, dayAfter.getUTCMonth() + 1, dayAfter.getUTCDate()) === dateStr) return true;

  const xmasEve = new Date(Date.UTC(year, 11, 24));
  const dow = xmasEve.getUTCDay();
  if (dow !== 0 && dow !== 6 && toDateStr(year, 12, 24) === dateStr) return true;

  return false;
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
 * RTH = Monday-Friday, 09:30-16:00 US/Eastern (09:30-13:00 on half-days),
 * excluding NYSE holidays. Holidays are computed algorithmically (see
 * nyseHolidaysForYear) so this does not silently stop working in a future
 * year the way a hand-maintained table did.
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
  if (isMarketHoliday(dateStr)) return false;

  // Time-of-day check: 09:30 (570 min) - 16:00 (960 min), or 13:00 (780 min) on half-days
  const minOfDay = etMinuteOfDay(now);
  const closeMin = isHalfDay(dateStr) ? 780 : 960;
  return minOfDay >= 570 && minOfDay < closeMin;
}

/**
 * Returns true when we are within `minutesBefore` minutes of the market close
 * (16:00 ET, or 13:00 ET on a half-day). Used to block new entries too close
 * to the bell.
 */
export function isNearMarketClose(minutesBefore = 30, now: Date = new Date()): boolean {
  const dateStr = etDateString(now);
  const closeMin = isHalfDay(dateStr) ? 780 : 960;
  const minOfDay = etMinuteOfDay(now);
  return minOfDay >= (closeMin - minutesBefore) && minOfDay < closeMin;
}

/**
 * Today's date in US/Eastern local time as 'YYYY-MM-DD'. Correct ET
 * conversion (accounts for DST) - NOT the UTC date, which would be wrong for
 * roughly 19-20 hours of every trading day.
 */
export function todayET(now: Date = new Date()): string {
  return etDateString(now);
}

/**
 * ET local date 'YYYY-MM-DD' for an arbitrary ISO timestamp string (e.g. a
 * stored entryTime/exitTime, which are UTC). Use this - not
 * `isoString.slice(0, 10)` - when comparing a trade's date to todayET():
 * slicing a UTC ISO string gives the UTC date, which disagrees with the ET
 * date for most of the trading day.
 */
export function etDateOfIso(isoString: string): string {
  return etDateString(new Date(isoString));
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
