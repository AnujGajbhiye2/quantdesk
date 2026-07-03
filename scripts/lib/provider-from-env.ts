/**
 * Construct a provider directly from its env keys (not via the registry) so
 * scripts work regardless of the app's *_ENABLED flags. Shared by
 * reconcile-providers.ts and migrate-provider.ts. New adapters get one case
 * here (IMPROVEMENT_PLAN.md WS1 recipe step 6).
 */
import { YahooProvider } from '../../src/core/data/providers/yahoo';
import { AlpacaProvider } from '../../src/core/data/providers/alpaca';
import { TwelveDataProvider } from '../../src/core/data/providers/twelve-data';
import type { DataProvider } from '../../src/core/data/DataProvider';

export function providerFromEnv(id: string): DataProvider {
  switch (id) {
    case 'yahoo':
      return new YahooProvider();
    case 'alpaca': {
      const keyId = process.env.ALPACA_KEY_ID;
      const secretKey = process.env.ALPACA_SECRET_KEY;
      if (!keyId || !secretKey) {
        throw new Error(`provider '${id}' needs ALPACA_KEY_ID + ALPACA_SECRET_KEY`);
      }
      return new AlpacaProvider({ keyId, secretKey });
    }
    case 'twelve-data': {
      const apiKey = process.env.TWELVE_DATA_API_KEY;
      if (!apiKey) throw new Error(`provider '${id}' needs TWELVE_DATA_API_KEY`);
      return new TwelveDataProvider({ apiKey });
    }
    default:
      throw new Error(
        `Unknown provider id '${id}'. Known: yahoo, alpaca, twelve-data. ` +
        `Add a case to providerFromEnv() when a new adapter lands.`,
      );
  }
}
