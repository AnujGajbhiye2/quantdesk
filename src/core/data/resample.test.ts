import { describe, it, expect } from 'vitest';
import { toWeekly } from './resample';
import type { Bar } from '@/core/types';

function makeBar(time: string, open: number, high: number, low: number, close: number, volume = 1000): Bar {
  return { time, open, high, low, close, volume };
}

describe('toWeekly', () => {
  it('returns empty array for empty input', () => {
    expect(toWeekly([])).toEqual([]);
  });

  it('single bar becomes one weekly bar', () => {
    const bars = [makeBar('2024-01-02', 100, 105, 98, 102)];
    const weekly = toWeekly(bars);
    expect(weekly.length).toBe(1);
    expect(weekly[0].open).toBe(100);
    expect(weekly[0].close).toBe(102);
  });

  it('5 bars in same week aggregate correctly', () => {
    // Week of 2024-01-01 (Mon Jan 1 - Fri Jan 5)
    const bars = [
      makeBar('2024-01-02', 100, 110, 98,  102, 1000), // Tue
      makeBar('2024-01-03', 102, 108, 100, 105, 2000), // Wed
      makeBar('2024-01-04', 105, 112, 103, 107, 1500), // Thu
      makeBar('2024-01-05', 107, 115, 105, 110, 3000), // Fri
    ];
    const weekly = toWeekly(bars);
    expect(weekly.length).toBe(1);
    const w = weekly[0];
    expect(w.open).toBe(100);      // first bar open
    expect(w.close).toBe(110);     // last bar close
    expect(w.high).toBe(115);      // max high
    expect(w.low).toBe(98);        // min low
    expect(w.volume).toBe(7500);   // sum
    expect(w.time).toBe('2024-01-02'); // first bar's time
  });

  it('bars across two weeks produce two weekly bars', () => {
    const bars = [
      makeBar('2024-01-02', 100, 110, 98,  102),  // week 1
      makeBar('2024-01-03', 102, 105, 100, 103),  // week 1
      makeBar('2024-01-08', 103, 108, 101, 106),  // week 2
      makeBar('2024-01-09', 106, 109, 104, 107),  // week 2
    ];
    const weekly = toWeekly(bars);
    expect(weekly.length).toBe(2);
    expect(weekly[0].time).toBe('2024-01-02');
    expect(weekly[1].time).toBe('2024-01-08');
    expect(weekly[0].close).toBe(103);
    expect(weekly[1].close).toBe(107);
  });

  it('output is sorted ascending', () => {
    // Provide in order; verify output still sorted
    const bars = [
      makeBar('2024-01-15', 100, 105, 98, 102),
      makeBar('2024-01-16', 102, 108, 100, 104),
      makeBar('2024-01-08', 90,  95,  88,  92),
      makeBar('2024-01-09', 92,  96,  90,  94),
    ];
    const weekly = toWeekly(bars);
    expect(weekly.length).toBe(2);
    expect(weekly[0].time < weekly[1].time).toBe(true);
  });
});
