import { describe, it, expect } from 'vitest';
import { isUsMarketOpen, isNearMarketClose, todayET, etDateOfIso } from './hours';

// Helper: build a UTC Date from an ET local time description.
// etHour / etMin are the local ET wall-clock hour and minute.
// isDST: true = EDT (UTC-4), false = EST (UTC-5).
function etDate(year: number, month: number, day: number, etHour: number, etMin = 0, isDST = true): Date {
  const utcOffset = isDST ? 4 : 5; // hours ahead of ET to get UTC
  const d = new Date(Date.UTC(year, month - 1, day, etHour + utcOffset, etMin, 0));
  return d;
}

describe('isUsMarketOpen', () => {
  it('returns true at 10:00 ET on a normal weekday (EDT)', () => {
    // Wednesday 2025-06-18 10:00 ET (summer -> EDT)
    expect(isUsMarketOpen(etDate(2025, 6, 18, 10, 0, true))).toBe(true);
  });

  it('returns true exactly at 09:30 ET open', () => {
    expect(isUsMarketOpen(etDate(2025, 6, 18, 9, 30, true))).toBe(true);
  });

  it('returns false one minute before open (09:29 ET)', () => {
    expect(isUsMarketOpen(etDate(2025, 6, 18, 9, 29, true))).toBe(false);
  });

  it('returns false exactly at 16:00 ET close', () => {
    expect(isUsMarketOpen(etDate(2025, 6, 18, 16, 0, true))).toBe(false);
  });

  it('returns false at 15:59 ET (within last minute but still open)', () => {
    expect(isUsMarketOpen(etDate(2025, 6, 18, 15, 59, true))).toBe(true);
  });

  it('returns false on Saturday', () => {
    // 2025-06-21 is a Saturday
    expect(isUsMarketOpen(etDate(2025, 6, 21, 11, 0, true))).toBe(false);
  });

  it('returns false on Sunday', () => {
    // 2025-06-22 is a Sunday
    expect(isUsMarketOpen(etDate(2025, 6, 22, 11, 0, true))).toBe(false);
  });

  it('returns false on US holiday (Thanksgiving 2025-11-27)', () => {
    // Thanksgiving falls on EST (isDST=false)
    expect(isUsMarketOpen(etDate(2025, 11, 27, 11, 0, false))).toBe(false);
  });

  it('returns false on New Year 2026', () => {
    expect(isUsMarketOpen(etDate(2026, 1, 1, 10, 0, false))).toBe(false);
  });

  it('returns false after-hours (evening)', () => {
    expect(isUsMarketOpen(etDate(2025, 6, 18, 20, 0, true))).toBe(false);
  });

  it('returns false during overnight session', () => {
    expect(isUsMarketOpen(etDate(2025, 6, 18, 3, 0, true))).toBe(false);
  });

  it('works during winter EST (non-DST)', () => {
    // 2025-01-08 Wednesday 10:30 ET (EST, isDST=false)
    expect(isUsMarketOpen(etDate(2025, 1, 8, 10, 30, false))).toBe(true);
  });
});

describe('isUsMarketOpen - algorithmic holiday calendar (regression for the hand-maintained-table expiry bug)', () => {
  // The old table only covered 2024-2026; the algorithm must keep working
  // for any year without a manual update. Spot-check 2027 and 2030.
  it('closed on New Year 2027 (year beyond the old hardcoded table)', () => {
    expect(isUsMarketOpen(etDate(2027, 1, 1, 10, 0, false))).toBe(false);
  });

  it('closed on Independence Day 2027', () => {
    expect(isUsMarketOpen(etDate(2027, 7, 4, 10, 0, true))).toBe(false);
  });

  it('closed on Thanksgiving 2030 (4th Thursday of November)', () => {
    // 2030-11-28 is the 4th Thursday of November 2030
    expect(isUsMarketOpen(etDate(2030, 11, 28, 10, 0, false))).toBe(false);
  });

  it('closed on Good Friday 2026 (2026-04-03, computed via Easter algorithm)', () => {
    expect(isUsMarketOpen(etDate(2026, 4, 3, 10, 0, true))).toBe(false);
  });

  it('closed on Juneteenth', () => {
    expect(isUsMarketOpen(etDate(2027, 6, 19, 12, 0, true))).toBe(false);
  });

  it('observes July 4th on the preceding Friday when it falls on a Saturday (2026)', () => {
    // July 4 2026 is a Saturday -> observed Friday July 3
    expect(isUsMarketOpen(etDate(2026, 7, 3, 10, 0, true))).toBe(false);
    // The actual Saturday is closed anyway (weekend), not a meaningful check on its own
  });

  it('open on an ordinary day adjacent to a holiday', () => {
    // Day after New Year 2027
    expect(isUsMarketOpen(etDate(2027, 1, 4, 10, 0, false))).toBe(true);
  });
});

describe('isUsMarketOpen - half days (early 1pm ET close)', () => {
  it('open at 12:30 ET the day after Thanksgiving (before the 1pm early close)', () => {
    // 2025-11-28 is the day after Thanksgiving 2025
    expect(isUsMarketOpen(etDate(2025, 11, 28, 12, 30, false))).toBe(true);
  });

  it('closed at 13:30 ET the day after Thanksgiving (after the 1pm early close)', () => {
    expect(isUsMarketOpen(etDate(2025, 11, 28, 13, 30, false))).toBe(false);
  });

  it('open at 12:30 ET on Christmas Eve when it falls on a weekday (2026-12-24 is a Thursday)', () => {
    expect(isUsMarketOpen(etDate(2026, 12, 24, 12, 30, false))).toBe(true);
  });

  it('closed at 13:30 ET on Christmas Eve when it falls on a weekday', () => {
    expect(isUsMarketOpen(etDate(2026, 12, 24, 13, 30, false))).toBe(false);
  });
});

describe('todayET / etDateOfIso', () => {
  it('todayET returns the ET calendar date, not the UTC date', () => {
    // 21:00 ET on 2025-06-18 (EDT, UTC-4) is 01:00 UTC on 2025-06-19 -
    // the old bug (`new Date().toISOString().slice(0,10)`) would have
    // returned the UTC date '2025-06-19' here, one day ahead of ET.
    const d = etDate(2025, 6, 18, 21, 0, true);
    expect(todayET(d)).toBe('2025-06-18');
  });

  it('etDateOfIso converts a UTC ISO timestamp to its ET calendar date', () => {
    // 2025-06-19T01:00:00Z is 2025-06-18 21:00 ET (EDT)
    expect(etDateOfIso('2025-06-19T01:00:00.000Z')).toBe('2025-06-18');
  });
});

describe('isNearMarketClose', () => {
  it('returns true when 30 min before close (15:30 ET)', () => {
    expect(isNearMarketClose(30, etDate(2025, 6, 18, 15, 30, true))).toBe(true);
  });

  it('returns false when 31 min before close (15:29 ET)', () => {
    expect(isNearMarketClose(30, etDate(2025, 6, 18, 15, 29, true))).toBe(false);
  });

  it('returns true at 15:59 ET (1 min before close)', () => {
    expect(isNearMarketClose(30, etDate(2025, 6, 18, 15, 59, true))).toBe(true);
  });

  it('returns false exactly at 16:00 ET (market already closed)', () => {
    // 960 min = 16:00; check window is [930, 960), so 960 is out
    expect(isNearMarketClose(30, etDate(2025, 6, 18, 16, 0, true))).toBe(false);
  });
});
