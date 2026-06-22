import 'server-only';

/**
 * Daily operational heartbeat.
 *
 * Fires once per EOD refresh cycle (cron or manual script). Sends a single
 * Telegram message reporting system health, data freshness, and trading
 * state. The message fires on EVERY trading day - its ABSENCE is the primary
 * failure signal.
 *
 * A dead process, expired Telegram token, or failed cron cannot send this
 * message -> watch for absence, not for a "something broke" reply.
 *
 * Failure modes and coverage:
 *   - process crashed/not running : message absent (by design)
 *   - cron misconfigured          : message absent (by design)
 *   - Telegram token revoked      : message absent (send fails silently)
 *   - Yahoo rate-limited/partial  : stale data-freshness line flags it
 *   - SQLite write failure        : DB section shows 'ERROR' on throw
 */

import { getFlag, setFlag } from '@/core/db/flags';
import { sendTelegram, telegramConfigured } from './telegram';
import { computeCashAccount, buildAccountSummary } from '@/core/paper/account';
import { markOpenTrades } from '@/core/paper/broker';
import { getPaperTrades } from '@/core/db/paper';
import { getAllSymbols, getLatestBarTime } from '@/core/db/bars';
import { isTradingHalted } from '@/core/paper/halt';
import { worstFreshness } from './freshness';
import type { PostRefreshSummary } from '@/core/data/post-refresh';

const SEQ_KEY = 'heartbeat_seq';

export interface HeartbeatStats {
  /** Total new bars ingested this cycle across all symbols. */
  totalBars: number;
  /** Number of symbols checked in this refresh. */
  symbolCount: number;
  /** Number of symbols that returned errors during refresh. */
  refreshErrors: number;
  /** PostRefreshSummary from the same cycle, for signal count and sweep results. */
  post: PostRefreshSummary;
  /** Reference clock for age calculations (default: Date.now()). */
  now?: Date;
}

/** Build the heartbeat Telegram message. Pure - no network or DB calls. */
export function buildHeartbeatText(
  stats: HeartbeatStats,
  opts: {
    seq: number;
    haltState: ReturnType<typeof isTradingHalted>;
    openCount: number;
    openedToday: number;
    closedToday: number;
    ddLine: string;
    freshLabel: string;
    signalCount: number;
    sweepLine: string;
    refreshTime: string;
  },
): string {
  const lines: string[] = [
    `[HEARTBEAT #${opts.seq}] ${opts.refreshTime} ET`,
    '',
    `Data refresh: ${stats.totalBars} bars / ${stats.symbolCount} symbols` +
      (stats.refreshErrors > 0 ? ` | ${stats.refreshErrors} ERROR(S)` : ''),
    `Data freshness: ${opts.freshLabel}`,
    `Scanner signals: ${opts.signalCount}`,
    `${opts.sweepLine}`,
    '',
    `Open positions: ${opts.openCount}`,
    `Opened today: ${opts.openedToday}  |  Closed today: ${opts.closedToday}`,
    opts.ddLine,
    opts.haltState.halted
      ? `HALT ACTIVE: ${opts.haltState.reason}`
      : 'Halt switch: clear',
    '',
    'Cron: alive (this message confirms the scheduler ran)',
  ];
  return lines.join('\n');
}

/**
 * Compute derived fields and send the heartbeat Telegram message.
 * All DB/network errors are caught; never throws into the refresh path.
 */
export async function sendDailyHeartbeat(stats: HeartbeatStats): Promise<void> {
  if (!telegramConfigured()) return;

  const now = stats.now ?? new Date();

  // Advance sequence counter
  const prevSeqStr = getFlag(SEQ_KEY);
  const seq = prevSeqStr ? parseInt(prevSeqStr, 10) + 1 : 1;
  try { setFlag(SEQ_KEY, String(seq)); } catch { /* non-fatal */ }

  // Halt state
  let haltState: ReturnType<typeof isTradingHalted>;
  try { haltState = isTradingHalted(); } catch { haltState = { halted: false }; }

  // Trade counts (today = UTC date string)
  const today = now.toISOString().slice(0, 10);
  let openCount = 0;
  let openedToday = 0;
  let closedToday = 0;
  let ddLine = 'DB: ERROR reading account';
  try {
    const allTrades = getPaperTrades();
    openCount   = allTrades.filter((t) => t.status === 'open').length;
    openedToday = allTrades.filter((t) => t.entryTime.slice(0, 10) === today).length;
    closedToday = allTrades.filter(
      (t) => t.status === 'closed' && t.exitTime?.slice(0, 10) === today,
    ).length;

    const cashAcc = computeCashAccount();
    if (cashAcc) {
      const openTrades = markOpenTrades();
      const unrealized = openTrades.reduce((s, m) => s + m.unrealizedPnl, 0);
      const acc        = buildAccountSummary(cashAcc, unrealized);
      const ddPct      = ((cashAcc.startingBalance - acc.equity) / cashAcc.startingBalance) * 100;
      const haltPct    = Number(process.env.RISK_HALT_DRAWDOWN_PCT ?? 12);
      ddLine = `DD: ${ddPct.toFixed(1)}% | breaker at -${haltPct}% of $${cashAcc.startingBalance.toFixed(0)}`;
    } else {
      ddLine = 'DD breaker: INACTIVE - no budget set';
    }
  } catch { /* ddLine stays 'DB: ERROR reading account' */ }

  // Data freshness: worst (oldest) bar across the 1d universe
  let freshLabel = 'unknown';
  try {
    const symbols  = getAllSymbols();
    const barTimes = symbols.map((s) => getLatestBarTime(s.symbol, '1d'));
    const f        = worstFreshness(barTimes, now, 1440); // 24h threshold for daily bars
    freshLabel     = f.label;
  } catch { /* freshLabel stays 'unknown' */ }

  // Signal count from scan result
  const signalCount = stats.post.scan.result?.signals.length ?? 0;

  // Sweep summary
  let sweepLine = 'Sweep: no data';
  try {
    const sweep  = stats.post.sweep.results;
    const closed = sweep.filter((r) => r.action !== 'still-open');
    sweepLine = closed.length === 0
      ? `Sweep: ${sweep.length} open checked, none closed`
      : `Sweep: closed ${closed.length} trade(s) ` +
        `(${closed.filter((r) => r.action === 'stopped').length} stopped, ` +
        `${closed.filter((r) => r.action === 'targeted').length} targeted, ` +
        `${closed.filter((r) => r.action === 'expired').length} expired)`;
    if (stats.post.sweep.error) sweepLine = `Sweep: ERROR - ${stats.post.sweep.error}`;
  } catch { /* sweepLine stays 'Sweep: no data' */ }

  // Refresh timestamp in ET (approximate: UTC offset)
  const etOffsetMs = isDstUs(now) ? -4 * 3_600_000 : -5 * 3_600_000;
  const etTime     = new Date(now.getTime() + etOffsetMs);
  const refreshTime = etTime.toISOString().replace('T', ' ').slice(0, 16) + ' ET';

  const text = buildHeartbeatText(stats, {
    seq,
    haltState,
    openCount,
    openedToday,
    closedToday,
    ddLine,
    freshLabel,
    signalCount,
    sweepLine,
    refreshTime,
  });

  try {
    await sendTelegram(text);
  } catch (err) {
    console.error('[heartbeat] sendTelegram failed:', err);
  }
}

/**
 * Approximate US DST check (second Sunday March to first Sunday November).
 * Enough for ET offset labelling; not used in trading logic.
 */
function isDstUs(d: Date): boolean {
  const jan  = new Date(d.getFullYear(), 0, 1).getTimezoneOffset();
  const jul  = new Date(d.getFullYear(), 6, 1).getTimezoneOffset();
  return d.getTimezoneOffset() < Math.max(jan, jul);
}
