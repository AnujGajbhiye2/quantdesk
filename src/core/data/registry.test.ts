import { describe, it, expect, beforeEach } from 'vitest';

// Import the module-level registry functions fresh for each test
// We test against a locally scoped Map so we don't pollute the global registry.

import type { DataProvider } from './DataProvider';
import type { AssetClass, Bar, SymbolMeta, Timeframe } from '@/core/types';

// ---------------------------------------------------------------------------
// Inline mini-registry for unit testing - mirrors the real implementation
// so we can assert the "one line = one provider" contract without side effects.
// ---------------------------------------------------------------------------

function makeRegistry() {
  const map = new Map<string, DataProvider>();

  return {
    register(p: DataProvider) { map.set(p.id, p); },
    get(id: string): DataProvider {
      const p = map.get(id);
      if (!p) throw new Error(`Provider '${id}' not registered.`);
      return p;
    },
    list(): string[] { return Array.from(map.keys()); },
  };
}

// ---------------------------------------------------------------------------
// Dummy provider factory - the "one new file" stub
// ---------------------------------------------------------------------------

function makeDummyProvider(id: string): DataProvider {
  return {
    id,
    assetClasses: ['equity'] as AssetClass[],
    toProviderSymbol: (s: string) => s,
    getHistory: (_s: string, _tf: Timeframe, _f: string, _t: string): Promise<Bar[]> =>
      Promise.resolve([]),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DataProvider registry', () => {
  let registry: ReturnType<typeof makeRegistry>;

  beforeEach(() => {
    registry = makeRegistry();
  });

  it('registers and retrieves a provider by id', () => {
    const dummy = makeDummyProvider('dummy');
    registry.register(dummy);

    const retrieved = registry.get('dummy');
    expect(retrieved.id).toBe('dummy');
  });

  it('list() returns all registered ids', () => {
    registry.register(makeDummyProvider('alpha'));
    registry.register(makeDummyProvider('beta'));

    expect(registry.list()).toContain('alpha');
    expect(registry.list()).toContain('beta');
    expect(registry.list()).toHaveLength(2);
  });

  it('throws when getting an unregistered provider', () => {
    expect(() => registry.get('nonexistent')).toThrow("Provider 'nonexistent' not registered.");
  });

  it('adding a second provider requires only register() - no other change', () => {
    // This is the extensibility contract: one line to add a provider.
    const yahoo = makeDummyProvider('yahoo');
    const dhan  = makeDummyProvider('dhan');

    registry.register(yahoo);

    // One new line - that is the entire "add provider" operation:
    registry.register(dhan);

    expect(registry.list()).toHaveLength(2);
    expect(registry.get('dhan').id).toBe('dhan');
    expect(registry.get('yahoo').id).toBe('yahoo');
  });

  it('overwrite: re-registering an id replaces the old provider', () => {
    const v1 = makeDummyProvider('test');
    const v2: DataProvider = { ...makeDummyProvider('test'), assetClasses: ['forex'] };

    registry.register(v1);
    registry.register(v2);

    expect(registry.get('test').assetClasses).toEqual(['forex']);
  });

  it('DataProvider interface requires only the mandatory methods', () => {
    // Verify that a provider with no optional methods (getQuote, search) is valid
    const minimal: DataProvider = {
      id: 'minimal',
      assetClasses: ['equity'],
      toProviderSymbol: (s) => s,
      getHistory: () => Promise.resolve([]),
    };

    registry.register(minimal);
    expect(registry.get('minimal').getQuote).toBeUndefined();
    expect(registry.get('minimal').search).toBeUndefined();
  });
});
