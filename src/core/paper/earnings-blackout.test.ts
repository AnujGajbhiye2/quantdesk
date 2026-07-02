import { describe, it, expect } from 'vitest';
import { isWithinEarningsBlackout } from './earnings-blackout';

describe('isWithinEarningsBlackout', () => {
  it('blocks when earnings are within the blackout window', () => {
    expect(isWithinEarningsBlackout('2024-01-05', '2024-01-03', 3)).toBe(true);
  });

  it('blocks on the exact boundary day', () => {
    expect(isWithinEarningsBlackout('2024-01-06', '2024-01-03', 3)).toBe(true);
  });

  it('does not block one day past the boundary', () => {
    expect(isWithinEarningsBlackout('2024-01-07', '2024-01-03', 3)).toBe(false);
  });

  it('does not block on the earnings date itself is inclusive at 0 days out', () => {
    expect(isWithinEarningsBlackout('2024-01-03', '2024-01-03', 3)).toBe(true);
  });

  it('does not block AFTER earnings already happened', () => {
    expect(isWithinEarningsBlackout('2024-01-01', '2024-01-03', 3)).toBe(false);
  });

  it('does not block when no earnings date is known', () => {
    expect(isWithinEarningsBlackout(null, '2024-01-03', 3)).toBe(false);
  });

  it('does not block when blackoutDays is 0 or negative', () => {
    expect(isWithinEarningsBlackout('2024-01-04', '2024-01-03', 0)).toBe(false);
    expect(isWithinEarningsBlackout('2024-01-04', '2024-01-03', -1)).toBe(false);
  });
});
