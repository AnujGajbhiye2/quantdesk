import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let flagStore: Record<string, string> = {};
const mockSetHalt   = vi.fn();
const mockClearHalt = vi.fn();
const mockIsHalted  = vi.fn(() => ({ halted: false }));
const mockSendTg    = vi.fn(async () => true);

vi.mock('@/core/db/flags', () => ({
  getFlag:    (key: string) => flagStore[key] ?? null,
  setFlag:    (key: string, value: string) => { flagStore[key] = value; },
  deleteFlag: (key: string) => { delete flagStore[key]; },
}));

vi.mock('@/core/paper/halt', () => ({
  isTradingHalted: () => mockIsHalted(),
  setTradingHalt:  (...args: unknown[]) => mockSetHalt(...args),
  clearTradingHalt: () => mockClearHalt(),
}));

vi.mock('./telegram', () => ({
  telegramConfigured: () => true,
  sendTelegram: (...args: unknown[]) => mockSendTg(...args),
}));

vi.mock('@/core/paper/account', () => ({
  computeCashAccount:  () => null,
  buildAccountSummary: () => ({ equity: 10_000, startingBalance: 10_000 }),
}));

vi.mock('@/core/paper/broker', () => ({
  markOpenTrades: () => [],
}));

vi.mock('@/core/db/paper', () => ({
  getPaperTrades: () => [],
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MY_CHAT_ID = '9999';
const OTHER_CHAT_ID = '1111';

function makeUpdate(updateId: number, chatId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      message_id: 1,
      chat: { id: chatId },
      date: Date.now() / 1000,
      text,
    },
  };
}

function mockFetch(updates: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, result: updates }),
    text: async () => '',
  })));
}

beforeEach(() => {
  flagStore = {};
  vi.clearAllMocks();
  process.env.TELEGRAM_BOT_TOKEN = 'fake-token';
  process.env.TELEGRAM_CHAT_ID   = MY_CHAT_ID;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { pollTelegramCommands } from './commands';

describe('pollTelegramCommands - /halt command', () => {
  it('sets halt flag when /halt from the configured chat id', async () => {
    mockFetch([makeUpdate(100, parseInt(MY_CHAT_ID), '/halt market crash')]);
    await pollTelegramCommands();
    expect(mockSetHalt).toHaveBeenCalledWith('market crash');
    expect(mockSendTg).toHaveBeenCalledWith(expect.stringContaining('HALT SET'));
  });

  it('ignores /halt from a different chat id', async () => {
    mockFetch([makeUpdate(101, parseInt(OTHER_CHAT_ID), '/halt hacker')]);
    await pollTelegramCommands();
    expect(mockSetHalt).not.toHaveBeenCalled();
  });
});

describe('pollTelegramCommands - /resume command', () => {
  it('clears halt when /resume from the configured chat id', async () => {
    mockFetch([makeUpdate(102, parseInt(MY_CHAT_ID), '/resume')]);
    await pollTelegramCommands();
    expect(mockClearHalt).toHaveBeenCalled();
    expect(mockSendTg).toHaveBeenCalledWith(expect.stringContaining('HALT CLEARED'));
  });
});

describe('pollTelegramCommands - offset advancement', () => {
  it('advances the offset to max(update_id) + 1', async () => {
    mockFetch([
      makeUpdate(200, parseInt(MY_CHAT_ID), '/status'),
      makeUpdate(205, parseInt(MY_CHAT_ID), '/status'),
    ]);
    await pollTelegramCommands();
    expect(flagStore['telegram_update_offset']).toBe('206');
  });

  it('uses the stored offset as the getUpdates offset parameter', async () => {
    flagStore['telegram_update_offset'] = '300';
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: [] }),
      text: async () => '',
    }));
    vi.stubGlobal('fetch', fetchSpy);
    await pollTelegramCommands();
    const url = (fetchSpy.mock.calls[0][0] as string);
    expect(url).toContain('offset=300');
  });
});

describe('pollTelegramCommands - /status command', () => {
  it('sends a status reply', async () => {
    mockIsHalted.mockReturnValue({ halted: false });
    mockFetch([makeUpdate(300, parseInt(MY_CHAT_ID), '/status')]);
    await pollTelegramCommands();
    expect(mockSendTg).toHaveBeenCalledWith(expect.stringContaining('[STATUS]'));
  });
});
