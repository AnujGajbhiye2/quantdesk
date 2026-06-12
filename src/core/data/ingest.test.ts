import { describe, it, expect } from 'vitest';
import { refreshWindow } from './ingest';

// Provider range ends are exclusive (verified against Yahoo chart):
// period2 = today returns bars only up to yesterday. The window math below is
// what keeps the DB from sitting permanently 1-2 days behind.

describe('refreshWindow', () => {
  it('ends the day AFTER today so the exclusive range end includes today', () => {
    const { to } = refreshWindow('2026-06-10', '2026-06-11');
    expect(to).toBe('2026-06-12');
  });

  it('starts at the latest stored day itself to finalize a partial bar', () => {
    const { from } = refreshWindow('2026-06-10', '2026-06-11');
    expect(from).toBe('2026-06-10');
  });

  it('latest stored = today still yields a non-empty window (refetch today)', () => {
    const { from, to } = refreshWindow('2026-06-11', '2026-06-11');
    expect(from).toBe('2026-06-11');
    expect(to).toBe('2026-06-12');
    expect(from < to).toBe(true);
  });

  it('falls back to full history start when nothing is stored', () => {
    const { from } = refreshWindow(null, '2026-06-11');
    expect(from).toBe('2015-01-01');
  });

  it('handles month and year boundaries in the exclusive end', () => {
    expect(refreshWindow('2026-06-29', '2026-06-30').to).toBe('2026-07-01');
    expect(refreshWindow('2026-12-30', '2026-12-31').to).toBe('2027-01-01');
  });
});
