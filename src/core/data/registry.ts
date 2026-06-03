import type { DataProvider } from './DataProvider';
import { YahooProvider } from './providers/yahoo';
import { TwelveDataProvider } from './providers/twelve-data';

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

// Future example:
// if (process.env.POLYGON_API_KEY) {
//   register(new PolygonProvider({ apiKey: process.env.POLYGON_API_KEY }));
// }
