/**
 * TradingView symbol mapping.
 *
 * Converts QuantDesk canonical symbols (Yahoo-style suffixes) to the
 * EXCHANGE:TICKER format used by TradingView chart deep-links.
 * Pure module - no server-only, no DB, fully unit-testable.
 */

/** Map from Yahoo suffix (including the dot) to TradingView exchange prefix. */
const SUFFIX_MAP: Record<string, string> = {
  '.NS': 'NSE',
  '.BO': 'BSE',
  '.L':  'LSE',
  '.SW': 'SIX',
  '.AS': 'EURONEXT',
  '.PA': 'EURONEXT',
  '.DE': 'XETR',
  '.MI': 'MIL',
  '.HK': 'HKEX',
  '.TO': 'TSX',
  '.AX': 'ASX',
  '.SI': 'SGX',
  '.KS': 'KRX',
  '.T':  'TSE',
};

/**
 * Convert a QuantDesk symbol to a TradingView EXCHANGE:TICKER string.
 *
 * Examples:
 *   AMD       -> AMD          (US bare ticker; TV auto-resolves)
 *   ABB.NS    -> NSE:ABB
 *   GSK.L     -> LSE:GSK
 *   ZURN.SW   -> SIX:ZURN
 *   INGA.AS   -> EURONEXT:INGA
 *   FOO.XX    -> FOO          (unknown suffix - strip and fall back)
 */
export function toTradingViewSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();

  // Find the last dot to extract the suffix
  const dotIdx = upper.lastIndexOf('.');
  if (dotIdx === -1) {
    // No suffix - US equity, TV resolves bare ticker
    return upper;
  }

  const suffix = upper.slice(dotIdx);       // e.g. '.NS'
  const base   = upper.slice(0, dotIdx);   // e.g. 'ABB'
  const exchange = SUFFIX_MAP[suffix];

  if (!exchange) {
    // Unknown exchange suffix - strip it, fall back to bare base
    return base;
  }

  return `${exchange}:${base}`;
}

/**
 * Build the TradingView chart deep-link URL for a symbol.
 * Opening this URL in any browser navigates to the chart for that symbol.
 */
export function tradingViewChartUrl(symbol: string): string {
  const tvSymbol = toTradingViewSymbol(symbol);
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}`;
}
