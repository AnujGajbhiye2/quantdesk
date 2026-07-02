import { describe, it, expect, vi, beforeEach } from 'vitest';

const flagStore = new Map<string, string>();

vi.mock('./flags', () => ({
  getFlag:    (key: string) => flagStore.get(key) ?? null,
  setFlag:    (key: string, value: string) => { flagStore.set(key, value); },
  deleteFlag: (key: string) => { flagStore.delete(key); },
}));

const { acquireLock, releaseLock } = await import('./lock');

beforeEach(() => {
  flagStore.clear();
});

describe('acquireLock / releaseLock', () => {
  it('acquires a free lock', () => {
    expect(acquireLock('tick')).toBe(true);
  });

  it('refuses to acquire a lock already held (not stale)', () => {
    expect(acquireLock('tick')).toBe(true);
    expect(acquireLock('tick')).toBe(false);
  });

  it('acquires again after release', () => {
    expect(acquireLock('tick')).toBe(true);
    releaseLock('tick');
    expect(acquireLock('tick')).toBe(true);
  });

  it('treats a lock older than staleMs as free (recovers from a crashed tick)', () => {
    flagStore.set('lock:tick', String(Date.now() - 20 * 60_000)); // held 20 min ago
    expect(acquireLock('tick', 10 * 60_000)).toBe(true); // staleMs = 10 min
  });

  it('different keys do not contend with each other', () => {
    expect(acquireLock('tick-a')).toBe(true);
    expect(acquireLock('tick-b')).toBe(true);
  });

  it('releasing a never-held lock is a safe no-op', () => {
    expect(() => releaseLock('never-held')).not.toThrow();
  });
});
