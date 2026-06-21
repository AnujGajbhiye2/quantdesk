import 'server-only';
import { getFlag, setFlag, deleteFlag } from '@/core/db/flags';

/**
 * Manual trading halt switch.
 *
 * Persists across process restarts via SQLite (app_flags table, key
 * 'trading_halt'). When set, new paper trade entries are blocked at two
 * enforcement points:
 *   1. auto-trade.ts - entry loop skips all consensus signals.
 *   2. broker.ts openPaperTrade - throws RiskCheckError('manual-halt')
 *      as a backstop for any other caller (UI, API routes, etc.).
 *
 * Exits/sweeps are intentionally NOT blocked - open positions continue to
 * be managed (stops, targets, time-stops) regardless of halt state. Closing
 * positions manually remains possible at any time.
 */

const HALT_KEY = 'trading_halt';

export interface HaltState {
  halted: boolean;
  reason?: string;
}

export function isTradingHalted(): HaltState {
  const value = getFlag(HALT_KEY);
  if (!value) return { halted: false };
  return { halted: true, reason: value };
}

/**
 * Activate the halt switch. `reason` is stored verbatim and surfaced in
 * Telegram status messages so the operator knows why trading is stopped.
 */
export function setTradingHalt(reason: string): void {
  const ts = new Date().toISOString();
  setFlag(HALT_KEY, `${reason} [set ${ts}]`);
}

/** Clear the halt switch. New entries are allowed again immediately. */
export function clearTradingHalt(): void {
  deleteFlag(HALT_KEY);
}
