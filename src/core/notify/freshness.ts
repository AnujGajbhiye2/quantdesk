/**
 * Data-freshness classifier.
 *
 * Determines whether the latest bar in the DB is fresh or stale relative
 * to the current time and the expected bar interval. A stale result during
 * market hours indicates Yahoo Finance rate-limiting or a failed ingest -
 * the heartbeat surfaces this so silence is not the only failure signal.
 *
 * Pure (no DB calls here) - callers pass in the latest bar time and the
 * reference clock so this is unit-testable without mocking.
 */

export interface BarFreshness {
  latestBarTime: string | null; // ISO date string ('YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm:ss')
  ageMinutes: number;           // minutes since latestBarTime; Infinity when null
  stale: boolean;               // true when older than expectedIntervalMinutes behind now
  label: string;                // human-readable for heartbeat / logging
}

/**
 * Classify freshness of a single bar timestamp.
 *
 * @param latestBarTime - Latest stored bar time (ISO); null if no bars exist.
 * @param now           - Reference clock (default: real wall clock).
 * @param expectedIntervalMinutes - Max acceptable age. Default 1440 (24h for daily bars).
 */
export function classifyFreshness(
  latestBarTime: string | null,
  now: Date = new Date(),
  expectedIntervalMinutes = 1440,
): BarFreshness {
  if (!latestBarTime) {
    return {
      latestBarTime: null,
      ageMinutes: Infinity,
      stale: true,
      label: 'no data',
    };
  }

  const barMs    = new Date(latestBarTime).getTime();
  const ageMs    = now.getTime() - barMs;
  const ageMinutes = ageMs / 60_000;
  const stale    = ageMinutes > expectedIntervalMinutes;

  const ageLabel = ageMinutes < 120
    ? `${ageMinutes.toFixed(0)}m ago`
    : `${(ageMinutes / 60).toFixed(1)}h ago`;

  return {
    latestBarTime,
    ageMinutes,
    stale,
    label: stale ? `STALE (${ageLabel})` : `fresh (${ageLabel})`,
  };
}

/**
 * Classify freshness across a set of symbols, returning the worst (oldest) bar.
 * Used by the heartbeat to report the max staleness across the universe.
 */
export function worstFreshness(
  barTimes: Array<string | null>,
  now: Date = new Date(),
  expectedIntervalMinutes = 1440,
): BarFreshness {
  if (barTimes.length === 0) {
    return classifyFreshness(null, now, expectedIntervalMinutes);
  }

  let worst: BarFreshness = classifyFreshness(barTimes[0] ?? null, now, expectedIntervalMinutes);
  for (const t of barTimes.slice(1)) {
    const f = classifyFreshness(t ?? null, now, expectedIntervalMinutes);
    if (f.ageMinutes > worst.ageMinutes) worst = f;
  }
  return worst;
}
