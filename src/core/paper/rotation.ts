import 'server-only';

/**
 * Capital rotation: when the book is full (risk ceiling / trade-count cap /
 * cash exhausted) and a new signal has strictly higher conviction than the
 * weakest currently-held position, close the weak one to make room.
 *
 * Off by default (ROTATION_ENABLED=1 to opt in). Guarded against churn by a
 * minimum hold period and a daily rotation cap. Never picks a holding to
 * close that is younger than the minimum hold, and among equally-weak
 * holdings prefers the one with the worst unrealized P&L (drop the laggard).
 *
 * Pure-ish: reads/writes via broker + flags, no scanning/sizing logic here.
 */
import { getPaperTrades } from '@/core/db/paper';
import { closePaperTrade, markOpenTrades } from '@/core/paper/broker';
import { getFlag, setFlag } from '@/core/db/flags';
import type { PaperTrade } from '@/core/types';

export interface RotationConfig {
  enabled:        boolean;
  minHoldBars:    number;
  maxPerDay:      number;
}

export function loadRotationConfig(): RotationConfig {
  return {
    enabled:     process.env.ROTATION_ENABLED === '1',
    minHoldBars: parseInt(process.env.ROTATION_MIN_HOLD_BARS ?? '3', 10),
    maxPerDay:   parseInt(process.env.ROTATION_MAX_PER_DAY ?? '2', 10),
  };
}

/** Parses "consensus=2/3" out of the notes string written by the auto-trade engines. */
export function parseConviction(notes: string | undefined): { agree: number; total: number } | null {
  if (!notes) return null;
  const m = /consensus=(\d+)\/(\d+)/.exec(notes);
  if (!m) return null;
  return { agree: Number(m[1]), total: Number(m[2]) };
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function rotationCountKey(scope: string): string {
  return `rotation_count_${scope}_${todayUTC()}`;
}

function rotationsUsedToday(scope: string): number {
  return Number(getFlag(rotationCountKey(scope)) ?? '0');
}

function recordRotation(scope: string): void {
  setFlag(rotationCountKey(scope), String(rotationsUsedToday(scope) + 1));
}

/** Trading-day age of a trade, counted from calendar days since entry (bar-agnostic proxy). */
function ageDays(trade: PaperTrade): number {
  const entered = new Date(trade.entryTime).getTime();
  if (!isFinite(entered)) return Infinity;
  return Math.floor((Date.now() - entered) / 86_400_000);
}

export interface RotationCandidate {
  symbol:     string;
  agreeCount: number;
}

export interface RotationResult {
  closed:        PaperTrade;
  closedAgree:   number;
  closedPnlPct:  number | null;
}

/**
 * If rotation is enabled and a slot is worth freeing, close the weakest
 * eligible open position and return it. Returns null when rotation is
 * disabled, no eligible holding exists, or the daily cap is hit.
 *
 * `scope` groups the daily rotation cap and candidate pool - pass the market
 * bucket ('sp500', 'nse', 'eu', ...) for the daily engine, or 'intraday' for
 * the untagged intraday engine.
 */
export function maybeRotateForCandidate(
  candidate: RotationCandidate,
  scope: string,
  openTradesInScope: PaperTrade[],
): RotationResult | null {
  const cfg = loadRotationConfig();
  if (!cfg.enabled) return null;
  if (rotationsUsedToday(scope) >= cfg.maxPerDay) return null;
  if (openTradesInScope.length === 0) return null;

  // Eligible holdings: held at least minHoldBars (days, as a bar-agnostic
  // proxy - both intraday and daily engines call this at most a few times
  // a day, so calendar days approximates bar count closely enough here).
  const eligible = openTradesInScope.filter((t) => ageDays(t) >= cfg.minHoldBars);
  if (eligible.length === 0) return null;

  // Score each eligible holding by conviction; find the weakest.
  const scored = eligible.map((t) => ({
    trade: t,
    conviction: parseConviction(t.notes)?.agree ?? 0,
  }));
  const marks = new Map(markOpenTrades().map((m) => [m.trade.id, m.unrealizedPnlPct]));

  scored.sort((a, b) => {
    if (a.conviction !== b.conviction) return a.conviction - b.conviction;
    // Tie-break: worse unrealized P&L rotates out first.
    return (marks.get(a.trade.id) ?? 0) - (marks.get(b.trade.id) ?? 0);
  });
  const weakest = scored[0];

  // Only rotate when the candidate is strictly more convincing than the
  // weakest holding - never rotate to make room for an equal/weaker signal.
  if (candidate.agreeCount <= weakest.conviction) return null;

  const pnlPct = marks.get(weakest.trade.id) ?? null;
  const closed = closePaperTrade(weakest.trade.id, {
    exitPrice:  weakest.trade.entryPrice, // sweep already marks fresh; closePaperTrade re-derives fill from this
    exitTime:   new Date().toISOString(),
    exitReason: 'rotation',
  });

  recordRotation(scope);

  return { closed, closedAgree: weakest.conviction, closedPnlPct: pnlPct };
}

/** Open trades for a given scope: market-tagged trades for daily, all untagged for intraday. */
export function openTradesForScope(scope: string): PaperTrade[] {
  const open = getPaperTrades({ status: 'open' });
  if (scope === 'intraday') return open.filter((t) => !t.market);
  return open.filter((t) => t.market === scope);
}
