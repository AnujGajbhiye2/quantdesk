import type { DataProvider } from './DataProvider';
import { YahooProvider } from './providers/yahoo';
import { TwelveDataProvider } from './providers/twelve-data';
import { AlpacaProvider } from './providers/alpaca';
import { alpacaEnv } from '@/core/broker/alpaca-env';
import { alpacaLimiter } from '@/core/broker/rate-limiter';

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

// Default bar-source provider. Override with DEFAULT_PROVIDER when the primary
// source changes (e.g. after a paid-provider migration) - no code change needed.
const DEFAULT_PROVIDER_ID = process.env.DEFAULT_PROVIDER ?? 'yahoo';

/** The configured default provider id (DEFAULT_PROVIDER env, falls back to 'yahoo'). */
export function defaultProviderId(): string {
  return DEFAULT_PROVIDER_ID;
}

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
 * Retrieve a provider by id, falling back to the configured default when the
 * requested provider is not registered. Safe to call even when optional
 * providers (Alpaca, TwelveData) are disabled.
 */
export function getOrDefault(id: string): DataProvider {
  const p = _registry.get(id) ?? _registry.get(DEFAULT_PROVIDER_ID);
  if (!p) {
    throw new Error(
      `Neither provider '${id}' nor default '${DEFAULT_PROVIDER_ID}' is registered. ` +
      `Check DEFAULT_PROVIDER and provider env flags.`,
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

// Alpaca Markets - disabled; set ALPACA_ENABLED=1 to re-enable when needed.
// Requires ALPACA_KEY_ID + ALPACA_SECRET_KEY + ALPACA_ENABLED=1.
// Feed (iex/sip) and rate budget follow ALPACA_PLAN - see core/broker/alpaca-env.ts.
{
  const alpaca = alpacaEnv();
  if (alpaca.dataEnabled && alpaca.keyId && alpaca.secretKey) {
    register(new AlpacaProvider({
      keyId:     alpaca.keyId,
      secretKey: alpaca.secretKey,
      feed:      alpaca.feed,
      limiter:   alpacaLimiter(),
    }));
  }
}

// Future example:
// if (process.env.POLYGON_API_KEY) {
//   register(new PolygonProvider({ apiKey: process.env.POLYGON_API_KEY }));
// }

// Fail loud at boot, not at first fetch: a DEFAULT_PROVIDER that never got
// registered above (missing key / env flag) would otherwise surface as a
// confusing runtime error deep inside an ingest.
if (!_registry.has(DEFAULT_PROVIDER_ID)) {
  throw new Error(
    `DEFAULT_PROVIDER='${DEFAULT_PROVIDER_ID}' is not registered. ` +
    `Registered providers: ${Array.from(_registry.keys()).join(', ')}. ` +
    `Check its API-key env vars / enable flag.`,
  );
}
