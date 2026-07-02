import 'server-only';

/**
 * Telegram Bot API notifier.
 *
 * Setup (documented in .env.local.example):
 * 1. Create a bot with @BotFather, copy the token into TELEGRAM_BOT_TOKEN.
 * 2. Message the bot once, then read your chat id from
 *    https://api.telegram.org/bot<token>/getUpdates - put it in TELEGRAM_CHAT_ID.
 *
 * When either env var is missing every send is a silent no-op (one warning
 * per process) so the monitor can run unconfigured without crashing.
 */

let warnedUnconfigured = false;

export function telegramConfigured(): boolean {
  // Second independent guard: local dev pointed at the shared Turso DB must not
  // send/receive Telegram traffic even if the tokens happen to be set locally.
  if (process.env.LOCAL_DEV_MODE === '1') return false;
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export interface SendTelegramOpts {
  /** Pass 'HTML' to enable <b>/<i>/<code> formatting. Default: plain text. */
  parseMode?: 'HTML';
}

/**
 * Escape the handful of characters Telegram's HTML parse_mode treats as
 * markup. Only escape what HTML actually reserves - do not over-escape
 * quotes/apostrophes, which are safe in text nodes.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Strip a bot token out of any string before logging it. The Telegram Bot
 * API only supports auth via the URL path (`/bot<token>/method`), so the
 * token has to be in the request URL - and node's fetch embeds the full
 * request URL in network-error messages/stacks (not just in a successful
 * response body). Without this, a transient network failure could leak the
 * live bot token into application logs.
 */
export function redactToken(s: string, token: string): string {
  return token ? s.split(token).join('[redacted]') : s;
}

/** Send a message. Returns true when Telegram accepted it. */
export async function sendTelegram(text: string, opts: SendTelegramOpts = {}): Promise<boolean> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    if (!warnedUnconfigured) {
      console.warn('[telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set - notifications disabled');
      warnedUnconfigured = true;
    }
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id: chatId,
        text,
        ...(opts.parseMode ? { parse_mode: opts.parseMode } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error('[telegram] send failed:', res.status, redactToken(body, token));
      return false;
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[telegram] send failed:', redactToken(msg, token));
    return false;
  }
}
