import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { redactToken, sendTelegram } from './telegram';

describe('redactToken', () => {
  it('replaces every occurrence of the token with a placeholder', () => {
    const token = '123456:ABC-DEF';
    const s = `https://api.telegram.org/bot${token}/sendMessage failed, retried bot${token}/sendMessage again`;
    const result = redactToken(s, token);
    expect(result).not.toContain(token);
    expect(result).toContain('[redacted]');
  });

  it('is a no-op when the token is empty', () => {
    expect(redactToken('hello world', '')).toBe('hello world');
  });

  it('leaves strings without the token unchanged', () => {
    expect(redactToken('no secrets here', 'sometoken')).toBe('no secrets here');
  });
});

describe('sendTelegram - token never reaches console.error', () => {
  const originalFetch = global.fetch;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'secret-token-123';
    process.env.TELEGRAM_CHAT_ID = 'chat-1';
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    errorSpy.mockRestore();
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  it('redacts the token from a non-ok response body before logging', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized: bot secret-token-123 is invalid',
    }) as unknown as typeof fetch;

    await sendTelegram('hello');

    const logged = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toContain('secret-token-123');
  });

  it('redacts the token from a network error message before logging (the real leak vector)', async () => {
    // node's fetch embeds the full request URL - including the token - in
    // network-error messages. This is the case telegram.ts:62's old
    // `console.error('[telegram] send failed:', err)` did not guard against.
    global.fetch = vi.fn().mockRejectedValue(
      new TypeError(`fetch failed: https://api.telegram.org/botsecret-token-123/sendMessage`),
    ) as unknown as typeof fetch;

    await sendTelegram('hello');

    const logged = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toContain('secret-token-123');
  });
});
