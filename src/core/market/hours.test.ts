import { describe, it, expect } from 'vitest';
import { isUsMarketOpen, isNearMarketClose } from './hours';

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
