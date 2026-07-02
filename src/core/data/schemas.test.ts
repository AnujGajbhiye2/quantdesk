import { describe, it, expect, vi } from 'vitest';
import { validateBars } from './schemas';

function goodBar(overrides: Record<string, unknown> = {}) {
  return {
    time: '2024-01-02',
    open: 100,
    high: 105,
    low: 99,
    close: 103,
    volume: 1000,
    ...overrides,
  };
}

describe('validateBars', () => {
  it('keeps all bars when every bar is valid', () => {
    const bars = [goodBar(), goodBar({ time: '2024-01-03' })];
    expect(validateBars(bars)).toHaveLength(2);
  });

  it('quarantines a single malformed bar instead of aborting the whole batch', () => {
    // Previously a single bad bar (e.g. a provider glitch) threw and dropped
    // the entire symbol for that ingest run. Now it should just be skipped.
    const bars = [
      goodBar({ time: '2024-01-01' }),
      { time: '2024-01-02', open: 'not-a-number', high: 105, low: 99, close: 103, volume: 1000 },
      goodBar({ time: '2024-01-03' }),
    ];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = validateBars(bars);
    warnSpy.mockRestore();

    expect(result).toHaveLength(2);
    expect(result.map((b) => b.time)).toEqual(['2024-01-01', '2024-01-03']);
  });

  it('drops a bar with high < low', () => {
    const bars = [goodBar({ high: 90, low: 99 })];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = validateBars(bars);
    warnSpy.mockRestore();
    expect(result).toHaveLength(0);
  });

  it('logs the provided context alongside quarantine warnings', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    validateBars([{ time: 'bad-date', open: 1, high: 2, low: 0, close: 1, volume: 1 }], 'AAPL/1d');
    const logged = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    warnSpy.mockRestore();
    expect(logged).toContain('AAPL/1d');
  });

  it('returns an empty array (not a throw) when all bars are malformed', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => validateBars([{ time: 'nope' }])).not.toThrow();
    const result = validateBars([{ time: 'nope' }]);
    warnSpy.mockRestore();
    expect(result).toEqual([]);
  });
});
