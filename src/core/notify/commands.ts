import 'server-only';

/**
 * Telegram inbound command poller.
 *
 * Polls getUpdates every monitor-cron tick (15 min). Accepts commands only
 * from the configured TELEGRAM_CHAT_ID - all other senders are silently
 * ignored (single-user trust boundary, no bot-token exposure needed).
 *
 * Supported commands:
 *   /halt [reason]  - activate the manual trading halt switch
 *   /resume         - clear the halt switch
 *   /status         - reply with current halt state, open count, drawdown
 *
 * Latency to act on /halt is <= 15 min (one monitor cron tick). No port
 * exposed, no webhook - polling fits the existing architecture.
 *
 * All failures are non-fatal and logged to stderr; never throws into the
 * cron that calls it.
 */

import { getFlag, setFlag } from '@/core/db/flags';
import { isTradingHalted, setTradingHalt, clearTradingHalt } from '@/core/paper/halt';
import { sendTelegram, telegramConfigured } from './telegram';
import { computeCashAccount, buildAccountSummary } from '@/core/paper/account';
import { markOpenTrades } from '@/core/paper/broker';
import { getPaperTrades } from '@/core/db/paper';

const OFFSET_KEY = 'telegram_update_offset';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string };
    chat: { id: number };
    date: number;
    text?: string;
  };
}

interface GetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

async function buildStatusText(): Promise<string> {
  const halt       = isTradingHalted();
  const cashAcc    = computeCashAccount();
  const openTrades = getPaperTrades({ status: 'open' });

  let ddLine: string;
  if (cashAcc) {
    const marks = markOpenTrades();
    const unrealized = marks.reduce((s, m) => s + m.unrealizedPnl, 0);
    const acc = buildAccountSummary(cashAcc, unrealized);
    const ddPct = ((cashAcc.startingBalance - acc.equity) / cashAcc.startingBalance) * 100;
    const haltPct = Number(process.env.RISK_HALT_DRAWDOWN_PCT ?? 12);
    ddLine = `DD: ${ddPct.toFixed(1)}% (halt at -${haltPct}% of $${cashAcc.startingBalance.toFixed(0)})`;
  } else {
    ddLine = 'DD breaker: INACTIVE - no budget set';
  }

  const haltLine = halt.halted
    ? `HALT ACTIVE: ${halt.reason}`
    : 'Halt: clear - entries allowed';

  return [
    '[STATUS]',
    haltLine,
    `Open positions: ${openTrades.length}`,
    ddLine,
  ].join('\n');
}

/** Poll Telegram for new commands and execute any found. Non-throwing. */
export async function pollTelegramCommands(): Promise<void> {
  if (!telegramConfigured()) return;

  const token  = process.env.TELEGRAM_BOT_TOKEN!;
  const chatId = process.env.TELEGRAM_CHAT_ID!;

  const offsetStr = getFlag(OFFSET_KEY);
  const offset    = offsetStr ? parseInt(offsetStr, 10) : 0;

  let updates: TelegramUpdate[];
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=0&limit=100`,
    );
    if (!res.ok) {
      console.error('[telegram-commands] getUpdates failed:', res.status, await res.text());
      return;
    }
    const body = await res.json() as GetUpdatesResponse;
    if (!body.ok) {
      console.error('[telegram-commands] getUpdates not ok:', body);
      return;
    }
    updates = body.result;
  } catch (err) {
    console.error('[telegram-commands] getUpdates error:', err);
    return;
  }

  if (updates.length === 0) return;

  let maxUpdateId = offset - 1;

  for (const upd of updates) {
    maxUpdateId = Math.max(maxUpdateId, upd.update_id);

    const msg = upd.message;
    if (!msg?.text) continue;

    // Security: only accept commands from the configured chat
    if (String(msg.chat.id) !== chatId) continue;

    const text = msg.text.trim();

    if (text.startsWith('/halt')) {
      const reason = text.slice(5).trim() || 'remote halt via Telegram';
      try {
        setTradingHalt(reason);
        await sendTelegram(`[HALT SET] Trading halted.\nReason: ${reason}\nSend /resume to lift.`);
        console.log('[telegram-commands] trading halted via /halt command:', reason);
      } catch (err) {
        console.error('[telegram-commands] /halt failed:', err);
      }
    } else if (text.startsWith('/resume')) {
      try {
        clearTradingHalt();
        await sendTelegram('[HALT CLEARED] Trading resumed. New entries allowed.');
        console.log('[telegram-commands] halt cleared via /resume command');
      } catch (err) {
        console.error('[telegram-commands] /resume failed:', err);
      }
    } else if (text.startsWith('/status')) {
      try {
        const statusText = await buildStatusText();
        await sendTelegram(statusText);
      } catch (err) {
        console.error('[telegram-commands] /status failed:', err);
      }
    }
    // All other messages silently ignored
  }

  // Advance the offset so we don't re-process these updates
  setFlag(OFFSET_KEY, String(maxUpdateId + 1));
}
