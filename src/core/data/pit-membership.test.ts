import { describe, it, expect } from 'vitest';
import { membershipAsOf, wasMemberOn, type MembershipChange } from './pit-membership';

describe('membershipAsOf', () => {
  it('returns the current member list unchanged when asking about today', () => {
    const current = ['AAPL', 'MSFT', 'NVDA'];
    const changes: MembershipChange[] = [];
    const result = membershipAsOf(current, changes, '2026-07-02');
    expect([...result].sort()).toEqual(['AAPL', 'MSFT', 'NVDA']);
  });

  it('removes a symbol that was added after the target date (it was not a member yet)', () => {
    const current = ['AAPL', 'MSFT', 'NVDA'];
    const changes: MembershipChange[] = [
      { effectiveDate: '2024-06-01', symbol: 'NVDA', action: 'added' },
    ];
    // NVDA joined 2024-06-01; asking about 2020 should not include it
    const result = membershipAsOf(current, changes, '2020-01-01');
    expect([...result].sort()).toEqual(['AAPL', 'MSFT']);
  });

  it('re-adds a symbol that was removed after the target date (it was still a member)', () => {
    const current = ['AAPL', 'MSFT']; // GE no longer a member today
    const changes: MembershipChange[] = [
      { effectiveDate: '2018-06-26', symbol: 'GE', action: 'removed' },
    ];
    // GE was removed 2018-06-26; asking about 2017 should include it
    const result = membershipAsOf(current, changes, '2017-01-01');
    expect([...result].sort()).toEqual(['AAPL', 'GE', 'MSFT']);
  });

  it('handles a symbol added then removed after the target date - restores pre-add state', () => {
    const current = ['AAPL']; // XYZ briefly joined and left, not a current member
    const changes: MembershipChange[] = [
      { effectiveDate: '2022-01-01', symbol: 'XYZ', action: 'added' },
      { effectiveDate: '2023-01-01', symbol: 'XYZ', action: 'removed' },
    ];
    // Before either event: XYZ was never a member
    expect([...membershipAsOf(current, changes, '2021-01-01')].sort()).toEqual(['AAPL']);
    // Between add and remove: XYZ was a member
    expect([...membershipAsOf(current, changes, '2022-06-01')].sort()).toEqual(['AAPL', 'XYZ']);
    // After remove (today): XYZ not a member, matches current list
    expect([...membershipAsOf(current, changes, '2026-01-01')].sort()).toEqual(['AAPL']);
  });

  it('is a no-op for changes exactly on the target date (only changes strictly after are undone)', () => {
    const current = ['AAPL', 'NVDA'];
    const changes: MembershipChange[] = [
      { effectiveDate: '2024-06-01', symbol: 'NVDA', action: 'added' },
    ];
    const result = membershipAsOf(current, changes, '2024-06-01');
    expect(result.has('NVDA')).toBe(true);
  });
});

describe('wasMemberOn', () => {
  it('answers a single-symbol membership query', () => {
    const current = ['AAPL', 'MSFT'];
    const changes: MembershipChange[] = [
      { effectiveDate: '2018-06-26', symbol: 'GE', action: 'removed' },
    ];
    expect(wasMemberOn('GE', current, changes, '2017-01-01')).toBe(true);
    expect(wasMemberOn('GE', current, changes, '2020-01-01')).toBe(false);
    expect(wasMemberOn('AAPL', current, changes, '2010-01-01')).toBe(true);
  });
});
