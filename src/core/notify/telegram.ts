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
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/** Send a plain-text message. Returns true when Telegram accepted it. */
export async function sendTelegram(text: string): Promise<boolean> {
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
      body:    JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      console.error('[telegram] send failed:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('[telegram] send failed:', err);
    return false;
  }
}
