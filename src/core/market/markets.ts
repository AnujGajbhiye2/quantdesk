/**
 * Market classifier.
 *
 * Derives a display-level Market bucket from a SymbolMeta.
 * Pure function - no I/O, no DB access.
 *
 * Rules (checked in order):
 *   1. assetClass === 'forex'     -> FOREX
 *   2. assetClass === 'crypto'    -> CRYPTO
 *   3. assetClass === 'commodity' -> GOLD  (gold/metals are the primary commodity class here)
 *   4. symbol ends with '.NS'     -> NSE   (NSE India via Yahoo Finance)
 *   5. symbol ends with '.BO'     -> BSE   (BSE India via Yahoo Finance)
 *   6. exchange in EU list        -> EU
 *   7. default                    -> US
 */

import type { SymbolMeta } from '@/core/types';

export type Market = 'US' | 'EU' | 'NSE' | 'BSE' | 'FOREX' | 'GOLD' | 'CRYPTO';

/** EU exchange codes as reported by Yahoo Finance / provider metadata. */
const EU_EXCHANGES = new Set([
  'LSE', 'XLON',                  // London
  'EPA', 'XPAR',                  // Euronext Paris
  'EBR', 'XBRU',                  // Euronext Brussels
  'ELI', 'XLIS',                  // Euronext Lisbon
  'AEX', 'AMS', 'XAMS',           // Euronext Amsterdam (AEX is Yahoo-reported code)
  'XETRA', 'ETR', 'XETR', 'XFRA', // Deutsche Boerse / Frankfurt (XETRA used in universe files)
  'STO', 'XSTO', 'OMX',           // Stockholm (OMX used in universe files)
  'CPH', 'XCOP',                  // Copenhagen
  'OSL', 'XOSL',                  // Oslo
  'HEL', 'XHEL',                  // Helsinki
  'VIE', 'XWBO',                  // Vienna
  'MCE', 'XMCE', 'BME',           // Madrid (BME used in universe files)
  'MIL', 'XMIL', 'BIT',           // Milan (BIT used in universe files)
  'SWX', 'XSWX', 'SIX',           // Switzerland (SIX used in universe files)
  'ATH', 'XATH', 'ATHEX',         // Athens
  'BDP', 'XBUD',                  // Budapest
  'WSE', 'XWAR',                  // Warsaw
  'PRG', 'XPRA',                  // Prague
  'ISE',                           // Dublin (Ireland)
  'LUX',                           // Luxembourg
]);

/**
 * Classify a symbol into a Market bucket.
 * Pass the SymbolMeta row from the DB (already has assetClass, exchange, symbol).
 */
export function marketOf(meta: Pick<SymbolMeta, 'symbol' | 'assetClass' | 'exchange'>): Market {
  if (meta.assetClass === 'forex')     return 'FOREX';
  if (meta.assetClass === 'crypto')    return 'CRYPTO';
  if (meta.assetClass === 'commodity') return 'GOLD';

  if (meta.symbol.endsWith('.NS'))     return 'NSE';
  if (meta.symbol.endsWith('.BO'))     return 'BSE';

  if (meta.exchange && EU_EXCHANGES.has(meta.exchange.toUpperCase())) return 'EU';

  return 'US';
}

/** All possible market buckets in display order. */
export const ALL_MARKETS: Market[] = ['US', 'EU', 'NSE', 'BSE', 'FOREX', 'GOLD', 'CRYPTO'];
