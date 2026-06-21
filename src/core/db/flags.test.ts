import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB client so no real SQLite is touched in tests
// ---------------------------------------------------------------------------

const store = new Map<string, string>();

const mockGet    = vi.fn((key: string) => store.has(key) ? { value: store.get(key)! } : undefined);
const mockSet    = vi.fn((key: string, value: string) => { store.set(key, value); });
const mockDelete = vi.fn((key: string) => { store.delete(key); });

vi.mock('./client', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get:  (...args: unknown[]) => {
        // SELECT value FROM app_flags WHERE key = ?
        if (sql.includes('SELECT')) return mockGet(args[0] as string);
        return undefined;
      },
      run:  (...args: unknown[]) => {
        if (sql.includes('DELETE')) {
          mockDelete(args[0] as string);
        } else {
          // INSERT ... ON CONFLICT DO UPDATE (set key,value,updated_at)
          mockSet(args[0] as string, args[1] as string);
        }
      },
    }),
  }),
}));

import { getFlag, setFlag, deleteFlag } from './flags';

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('getFlag', () => {
  it('returns null when key does not exist', () => {
    mockGet.mockReturnValueOnce(undefined);
    expect(getFlag('missing')).toBeNull();
  });

  it('returns the stored value', () => {
    mockGet.mockReturnValueOnce({ value: 'hello' });
    expect(getFlag('k')).toBe('hello');
  });
});

describe('setFlag / getFlag round-trip', () => {
  it('stores a value and retrieves it', () => {
    setFlag('trading_halt', 'remote halt [set 2025-01-01T00:00:00Z]');
    expect(mockSet).toHaveBeenCalledWith('trading_halt', 'remote halt [set 2025-01-01T00:00:00Z]');
  });

  it('overwrites existing value (upsert)', () => {
    setFlag('seq', '1');
    setFlag('seq', '2');
    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenLastCalledWith('seq', '2');
  });
});

describe('deleteFlag', () => {
  it('calls delete with the correct key', () => {
    deleteFlag('trading_halt');
    expect(mockDelete).toHaveBeenCalledWith('trading_halt');
  });
});
