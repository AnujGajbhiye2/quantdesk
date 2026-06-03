import 'server-only';
import { getAllSymbols, getBars } from '@/core/db/bars';
import { compute } from '@/core/indicators/registry';
import type { Timeframe, SymbolMeta } from '@/core/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MacdState = 'bullish' | 'bearish' | 'unknown';
export type MaCross   = 'golden' | 'death' | 'none' | 'unknown';

export interface MarketRow {
  symbol:     string;
  name:       string;
  assetClass: SymbolMeta['assetClass'];
  currency:   string;
  last:       number;
  prevClose:  number;
  changePct:  number;    // (last - prevClose) / prevClose * 100
  volume:     number;
  spark:      number[];  // last 20 closes (oldest first)
  rsi14:      number;    // NaN if insufficient bars
  macdState:  MacdState;
  maCross:    MaCross;
}

export interface SnapshotOpts {
  symbols?:   string[];
  timeframe?: Timeframe;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPARK_LEN    = 20;
const MA_GOLDEN    = 200; // requires this many bars at minimum
const MA_DEATH     = 200; // same
const MA50         = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastFinite(arr: number[]): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (isFinite(arr[i])) return arr[i];
  }
  return NaN;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Build a MarketRow for every symbol (or the given subset) from the local DB.
 * Skips symbols with fewer than 2 bars (can't compute % change).
 * All computation uses the local SQLite data - no network calls.
 */
export function getMarketSnapshot(opts: SnapshotOpts = {}): MarketRow[] {
  const { timeframe = '1d' } = opts;

  const allMeta  = getAllSymbols();
  const filtered = opts.symbols?.length
    ? allMeta.filter((m) => opts.symbols!.includes(m.symbol))
    : allMeta;

  const rows: MarketRow[] = [];

  for (const meta of filtered) {
    try {
      const bars = getBars(meta.symbol, timeframe);
      if (bars.length < 2) continue;

      const last     = bars[bars.length - 1];
      const prev     = bars[bars.length - 2];
      const changePct = prev.close !== 0
        ? (last.close - prev.close) / prev.close * 100
        : 0;

      // Spark: last SPARK_LEN closes (oldest first)
      const spark = bars.slice(-SPARK_LEN).map((b) => b.close);

      // RSI(14)
      let rsi14 = NaN;
      try {
        const rsiArr = compute('rsi', bars, { period: 14 }) as number[];
        rsi14 = lastFinite(rsiArr);
      } catch { /* not enough bars - leave NaN */ }

      // MACD state: line vs signal at last bar
      let macdState: MacdState = 'unknown';
      try {
        const macdOut = compute('macd', bars, {}) as Record<string, number[]>;
        const macdLine   = lastFinite(macdOut.macd);
        const signalLine = lastFinite(macdOut.signal);
        if (isFinite(macdLine) && isFinite(signalLine)) {
          macdState = macdLine > signalLine ? 'bullish' : 'bearish';
        }
      } catch { /* not enough bars */ }

      // MA cross: 50 vs 200
      let maCross: MaCross = 'unknown';
      if (bars.length >= MA_GOLDEN) {
        try {
          const ma50arr  = compute('sma', bars, { period: MA50 })  as number[];
          const ma200arr = compute('sma', bars, { period: MA_DEATH }) as number[];
          const ma50     = lastFinite(ma50arr);
          const ma200    = lastFinite(ma200arr);
          if (isFinite(ma50) && isFinite(ma200)) {
            if (ma50 > ma200) maCross = 'golden';
            else if (ma50 < ma200) maCross = 'death';
            else maCross = 'none';
          }
        } catch { /* not enough bars */ }
      } else {
        maCross = 'unknown';
      }

      rows.push({
        symbol:    meta.symbol,
        name:      meta.name,
        assetClass: meta.assetClass,
        currency:  meta.currency,
        last:      last.close,
        prevClose: prev.close,
        changePct,
        volume:    last.volume,
        spark,
        rsi14,
        macdState,
        maCross,
      });
    } catch {
      // Skip symbols with DB errors (missing bars table row, etc.)
    }
  }

  return rows;
}
