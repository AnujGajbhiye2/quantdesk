/**
 * Shared Telegram message builders for the auto-trade engines.
 *
 * Goal: one money format, one set of readable strategy/market names, plain
 * English instead of cryptic bracket tags. All builders are pure functions
 * (no I/O) so they're trivial to unit test and reuse between the intraday
 * and daily engines.
 *
 * Uses Telegram HTML parse_mode (see telegram.ts `escapeHtml` /
 * `SendTelegramOpts.parseMode`) - callers must pass `{ parseMode: 'HTML' }`
 * to `sendTelegram` when sending the strings these builders return.
 */
import { fmtMoney } from '@/core/format/currency';
import { escapeHtml } from '@/core/notify/telegram';

// ---------------------------------------------------------------------------
// Readable name lookups
// ---------------------------------------------------------------------------

const STRATEGY_NAMES: Record<string, string> = {
  'rsi-reversion':        'RSI reversion',
  'bollinger-reversion':  'Bollinger reversion',
  'stoch-reversal':       'Stochastic reversal',
};

/** Strategy id -> readable name; falls back to the raw id for unknown ones. */
export function strategyName(id: string): string {
  return STRATEGY_NAMES[id] ?? id;
}

const MARKET_NAMES: Record<string, string> = {
  sp500:     'US',
  nse:       'India',
  eu:        'Europe',
  commodity: 'Commodities',
  intraday:  'US intraday',
};

/** Market bucket id -> readable label; falls back to the raw id, uppercased. */
export function marketName(market: string): string {
  return MARKET_NAMES[market.toLowerCase()] ?? market.toUpperCase();
}

// ---------------------------------------------------------------------------
// Entry alert
// ---------------------------------------------------------------------------

export interface EntryAlertInput {
  /** Market bucket id, e.g. 'sp500', 'nse', 'eu', or 'intraday'. */
  market:       string;
  symbol:       string;
  side:         'long' | 'short';
  currency?:    string;
  entryPrice:   number;
  stopPrice:    number;
  targetPrice:  number;
  qty:          number;
  riskAmount:   number;
  /** Risk as a fraction of equity, e.g. 0.015 for 1.5%. Optional label only. */
  riskPct?:     number;
  rr:           number;
  agreeCount:   number;
  totalStrats:  number;
  strategyIds:  string[];
  /** false when this is a dry-run "intended" alert, not a real fill. */
  live:         boolean;
}

/** Build a plain-English entry alert (real fill or dry-run "intended"). */
export function buildEntryAlert(i: EntryAlertInput): string {
  const cur       = i.currency ?? 'USD';
  const sideEmoji = i.side === 'long' ? '\u{1F7E2}' : '\u{1F534}'; // green/red circle
  const stopPct   = pctFrom(i.entryPrice, i.stopPrice);
  const targetPct = pctFrom(i.entryPrice, i.targetPrice);
  const head       = i.live ? 'ENTRY' : 'INTENDED ENTRY (dry run)';
  const strategies = i.strategyIds.map(strategyName).join(', ');
  const riskLabel  = i.riskPct != null ? ` (${(i.riskPct * 100).toFixed(1)}% eq)` : '';

  return [
    `${sideEmoji} <b>${head} — ${escapeHtml(marketName(i.market))} · ${escapeHtml(i.symbol)} ${i.side.toUpperCase()}</b>`,
    `Entry ${fmtMoney(i.entryPrice, cur)} · Stop ${fmtMoney(i.stopPrice, cur)} (${stopPct}) · Target ${fmtMoney(i.targetPrice, cur)} (${targetPct})`,
    `Size ${i.qty.toFixed(4)} · Risk ${fmtMoney(i.riskAmount, cur)}${riskLabel} · R:R ${i.rr.toFixed(2)}`,
    `Signal: ${i.agreeCount}/${i.totalStrats} agree — ${escapeHtml(strategies)}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Exit alert
// ---------------------------------------------------------------------------

export type ExitAction = 'stopped' | 'targeted' | 'expired' | 'rotation';

export interface ExitAlertInput {
  market:     string;
  symbol:     string;
  side:       'long' | 'short';
  currency?:  string;
  action:     ExitAction;
  exitPrice?: number;
  pnl?:       number;
  pnlPct?:    number;
}

const EXIT_LABELS: Record<ExitAction, string> = {
  stopped:  'STOP HIT',
  targeted: 'TARGET HIT',
  expired:  'TIME EXIT',
  rotation: 'ROTATED OUT',
};

/** Build a plain-English exit alert (stop/target/time-stop/rotation close). */
export function buildExitAlert(i: ExitAlertInput): string {
  const cur      = i.currency ?? 'USD';
  const won      = (i.pnl ?? 0) >= 0;
  const pnlEmoji = won ? '✅' : '❌';
  const pnlStr   = i.pnl != null
    ? `${won ? '+' : ''}${fmtMoney(i.pnl, cur)} (${won ? '+' : ''}${(i.pnlPct ?? 0).toFixed(2)}%)`
    : '--';

  return [
    `${pnlEmoji} <b>${EXIT_LABELS[i.action]} — ${escapeHtml(marketName(i.market))} · ${escapeHtml(i.symbol)} ${i.side.toUpperCase()}</b>`,
    `Exit ${i.exitPrice != null ? fmtMoney(i.exitPrice, cur) : '--'} · P&amp;L ${pnlStr}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Rotation alert
// ---------------------------------------------------------------------------

export interface RotationAlertInput {
  market:        string;
  closedSymbol:  string;
  closedPnlPct?: number;
  closedAgree:   number;
  openedSymbol:  string;
  openedAgree:   number;
  totalStrats:   number;
}

/** Build the alert sent when a weak holding is closed to admit a stronger signal. */
export function buildRotationAlert(i: RotationAlertInput): string {
  const pnlStr = i.closedPnlPct != null
    ? `${i.closedPnlPct >= 0 ? '+' : ''}${i.closedPnlPct.toFixed(2)}%`
    : 'flat';
  return [
    `\u{1F504} <b>ROTATION — ${escapeHtml(marketName(i.market))}</b>`,
    `Closed ${escapeHtml(i.closedSymbol)} (${i.closedAgree}/${i.totalStrats} agree, ${pnlStr}) to make room`,
    `Opened ${escapeHtml(i.openedSymbol)} (${i.openedAgree}/${i.totalStrats} agree — higher conviction)`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Scan digest
// ---------------------------------------------------------------------------

export interface ScanDigestInput {
  market:            string;
  /** Human-readable run label, e.g. '09:45 ET' or 'EOD scan'. */
  runLabel?:         string;
  scanned?:          number;
  signals:           number;
  entries:           number;
  exits:             number;
  rotations:         number;
  skips:             number;
  openedSymbols:     string[];
  closedSymbols:     string[];
  rotatedOutSymbols: string[];
  halted:            boolean;
  haltReason?:       string;
  dryRun:            boolean;
}

/** Build one grouped end-of-run digest per market, replacing the terse "Scan complete" line. */
export function buildScanDigest(i: ScanDigestInput): string {
  const lines: string[] = [
    `\u{1F4CA} <b>${escapeHtml(marketName(i.market))} scan${i.runLabel ? ` — ${escapeHtml(i.runLabel)}` : ''}</b>`,
  ];
  const scannedStr = i.scanned != null ? `Scanned ${i.scanned} · ` : '';
  lines.push(
    `${scannedStr}Signals ${i.signals} · Entries ${i.entries} · Exits ${i.exits}` +
    `${i.rotations > 0 ? ` · Rotations ${i.rotations}` : ''} · Skipped ${i.skips}`,
  );
  if (i.openedSymbols.length > 0) lines.push(`Opened: ${escapeHtml(i.openedSymbols.join(', '))}`);
  if (i.closedSymbols.length > 0) lines.push(`Closed: ${escapeHtml(i.closedSymbols.join(', '))}`);
  if (i.rotatedOutSymbols.length > 0) lines.push(`Rotated out: ${escapeHtml(i.rotatedOutSymbols.join(', '))}`);
  if (i.halted) lines.push(`⛔ HALTED: ${escapeHtml(i.haltReason ?? 'unknown')}`);
  if (i.dryRun) lines.push('DRY RUN — no real trades opened');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Signed percent distance of `to` from `from`, formatted like "-11.2%". */
function pctFrom(from: number, to: number): string {
  if (!isFinite(from) || from === 0 || !isFinite(to)) return '--';
  const pct = ((to - from) / from) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}
