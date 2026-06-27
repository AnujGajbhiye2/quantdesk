import type { DataProvider } from './DataProvider';
import { YahooProvider } from './providers/yahoo';
import { TwelveDataProvider } from './providers/twelve-data';
import { AlpacaProvider } from './providers/alpaca';

/**
 * Global provider registry.
 *
 * To add a new data provider:
 * 1. Copy providers/_template.ts -> providers/your-provider.ts
 * 2. Implement the DataProvider interface.
 * 3. Add one line below: register(new YourProvider()).
 * 4. Add any API key to .env.local.example.
 * That is it - nothing else changes.
 */

const _registry = new Map<string, DataProvider>();

/** Register a provider instance. Overwrites any existing entry with the same id. */
export function register(provider: DataProvider): void {
  _registry.set(provider.id, provider);
}

/** Retrieve a provider by id. Throws if not registered. */
export function get(id: string): DataProvider {
  const p = _registry.get(id);
  if (!p) {
    throw new Error(
      `DataProvider '${id}' not registered. Check registry.ts and provider env flags.`,
    );
  }
  return p;
}

/**
 * Retrieve a provider by id, falling back to the default (yahoo) when the
 * requested provider is not registered. Safe to call even when optional
 * providers (Alpaca, TwelveData) are disabled.
 */
export function getOrDefault(id: string): DataProvider {
  return _registry.get(id) ?? _registry.get('yahoo')!;
}

/** List all registered provider ids. */
export function list(): string[] {
  return Array.from(_registry.keys());
}

// -----------------------------------------------------------------------
// Seed built-in providers based on env flags.
// Yahoo Finance needs no API key; enabled by default.
// -----------------------------------------------------------------------
register(new YahooProvider());

// Twelve Data - free API key at twelvedata.com (800 req/day, 8 req/min)
if (process.env.TWELVE_DATA_API_KEY) {
  register(new TwelveDataProvider({ apiKey: process.env.TWELVE_DATA_API_KEY }));
}

// Alpaca Markets - disabled; set ALPACA_ENABLED=1 to re-enable when needed.
// Requires ALPACA_KEY_ID + ALPACA_SECRET_KEY + ALPACA_ENABLED=1.
if (process.env.ALPACA_ENABLED === '1' && process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY) {
  register(new AlpacaProvider({
    keyId:     process.env.ALPACA_KEY_ID,
    secretKey: process.env.ALPACA_SECRET_KEY,
  }));
}

// Future example:
// if (process.env.POLYGON_API_KEY) {
//   register(new PolygonProvider({ apiKey: process.env.POLYGON_API_KEY }));
// }
