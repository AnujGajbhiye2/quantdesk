import 'server-only';
import { markOpenTradesWithQuotes } from '@/core/paper/broker';
import { withEstHold } from '@/core/paper/hold';
import { getAlertState, setAlertState, clearAlertState, type AlertLevel, type AlertState } from '@/core/db/alerts';
import { sendTelegram, telegramConfigured } from './telegram';
import { fmtMoney } from '@/core/format/currency';
import type { PaperTrade } from '@/core/types';

/**
 * Open-trade stop/target proximity monitor.
 *
 * Runs on MONITOR_CRON (instrumentation.ts). For every open paper trade with
 * a stop or target, marks it against the latest provider quote and sends a
 * Telegram alert when price comes within ALERT_PROXIMITY_PCT of a level or
 * crosses it. Dedupe with hysteresis: one alert per state change, re-armed
 * only after price retreats past 1.5x the proximity band.
 */

const DEFAULT_PROXIMITY_PCT = 2;
/** Price must retreat past proximity * this factor before a 'near' re-arms. */
const REARM_FACTOR = 1.5;

// ---------------------------------------------------------------------------
// Pure core - testable without DB or network
// ---------------------------------------------------------------------------

export interface LevelCheck {
  /** Absolute distance from price to level, as % of the level. */
  distancePct: number;
  /** Price at or beyond the level (in the direction that closes the trade). */
  hit: boolean;
}

/**
 * Distance and hit state for one level of one trade.
 * 'hit' is directional: a long's target is hit from below, its stop from above.
 */
export function checkLevel(
  side:  'long' | 'short',
  level: AlertLevel,
  levelPrice: number,
  price: number,
): LevelCheck {
  const distancePct = Math.abs(price - levelPrice) / levelPrice * 100;
  let hit: boolean;
  if (side === 'long') {
    hit = level === 'target' ? price >= levelPrice : price <= levelPrice;
  } else {
    hit = level === 'target' ? price <= levelPrice : price >= levelPrice;
  }
  return { distancePct, hit };
}

export interface AlertDecision {
  /** State to persist; null = clear the row (re-armed). */
  nextState: AlertState | null;
  /** Send a notification this tick. */
  send: boolean;
}

/**
 * State machine per (trade, level):
 *   none -> near (send) -> hit (send, terminal while open)
 *   near -> none only after price retreats past proximity * REARM_FACTOR
 */
export function decideAlert(
  prev: AlertState | null,
  check: LevelCheck,
  proximityPct: number,
): AlertDecision {
  if (check.hit) {
    return { nextState: 'hit', send: prev !== 'hit' };
  }
  if (check.distancePct <= proximityPct) {
    // 'hit' falling back to 'near' (price re-crossed) should not re-spam
    if (prev === 'hit') return { nextState: 'hit', send: false };
    return { nextState: 'near', send: prev !== 'near' };
  }
  if (prev === 'near' && check.distancePct > proximityPct * REARM_FACTOR) {
    return { nextState: null, send: false };
  }
  return { nextState: prev, send: false };
}

// ---------------------------------------------------------------------------
// Impure outer - DB + quotes + Telegram
// ---------------------------------------------------------------------------

export interface MonitorSummary {
  checked: number;
  alertsSent: number;
  configured: boolean;
  errors: string[];
}

function alertText(
  trade: PaperTrade & { estHold?: { earliest: string; latest: string } | null },
  level: AlertLevel,
  levelPrice: number,
  price: number,
  check: LevelCheck,
): string {
  const cur = trade.currency ?? 'USD';
  const head = check.hit
    ? `${trade.symbol} ${trade.side} ${level.toUpperCase()} HIT`
    : `${trade.symbol} ${trade.side} near ${level}`;
  const line = check.hit
    ? `price ${fmtMoney(price, cur)} crossed ${level} ${fmtMoney(levelPrice, cur)}`
    : `price ${fmtMoney(price, cur)}, ${level} ${fmtMoney(levelPrice, cur)} is ${check.distancePct.toFixed(1)}% away`;
  const opened = `opened ${trade.entryTime.slice(0, 10)} @ ${fmtMoney(trade.entryPrice, cur)}`;
  const hold = trade.estHold
    ? `, est exit ${trade.estHold.earliest} - ${trade.estHold.latest}`
    : '';
  return `${head}\n${line}\n${opened}${hold}\nPaper trade - research tool, not financial advice.`;
}

/** Check all open trades against live quotes; send proximity/hit alerts. */
export async function checkOpenTrades(): Promise<MonitorSummary> {
  const summary: MonitorSummary = {
    checked: 0,
    alertsSent: 0,
    configured: telegramConfigured(),
    errors: [],
  };
  if (!summary.configured) return summary;

  const proximityPct = Number(process.env.ALERT_PROXIMITY_PCT ?? DEFAULT_PROXIMITY_PCT);

  let marks;
  try {
    marks = await markOpenTradesWithQuotes();
  } catch (err) {
    summary.errors.push(err instanceof Error ? err.message : String(err));
    return summary;
  }

  const withHold = new Map(
    withEstHold(marks.map((m) => m.trade)).map((t) => [t.id, t]),
  );

  for (const mark of marks) {
    const trade = withHold.get(mark.trade.id) ?? mark.trade;
    const price = mark.markPrice;
    if (!isFinite(price) || price <= 0) continue;
    summary.checked += 1;

    const levels: Array<{ level: AlertLevel; levelPrice: number | undefined }> = [
      { level: 'stop',   levelPrice: trade.stopPrice },
      { level: 'target', levelPrice: trade.targetPrice },
    ];

    for (const { level, levelPrice } of levels) {
      if (levelPrice == null || !isFinite(levelPrice) || levelPrice <= 0) continue;

      const check    = checkLevel(trade.side, level, levelPrice, price);
      const prev     = getAlertState(trade.id, level);
      const decision = decideAlert(prev, check, proximityPct);

      if (decision.send) {
        const ok = await sendTelegram(alertText(trade, level, levelPrice, price, check));
        if (!ok) {
          // Leave the stored state untouched so the alert retries next tick
          summary.errors.push(`telegram send failed for ${trade.symbol} ${level}`);
          continue;
        }
        summary.alertsSent += 1;
      }

      if (decision.nextState === null) clearAlertState(trade.id, level);
      else if (decision.nextState !== prev) setAlertState(trade.id, level, decision.nextState);
    }
  }

  return summary;
}
