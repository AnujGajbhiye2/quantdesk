import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { alpacaEnv, normalizeTradingBaseUrl, isPaperEndpoint } from './alpaca-env';

const ENV_KEYS = [
  'ALPACA_KEY_ID',
  'ALPACA_SECRET_KEY',
  'ALPACA_PLAN',
  'ALPACA_FEED',
  'ALPACA_RATE_LIMIT_PER_MIN',
  'ALPACA_ENDPOINT',
  'ALPACA_ENABLED',
  'ALPACA_MIRROR_ENABLED',
  'ALPACA_MIRROR_ALLOW_LOCAL',
  'ALPACA_ALLOW_LIVE_TRADING',
  'LOCAL_DEV_MODE',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('alpacaEnv plan defaults', () => {
  it('defaults to free plan: iex feed, 200 req/min', () => {
    const cfg = alpacaEnv();
    expect(cfg.plan).toBe('free');
    expect(cfg.feed).toBe('iex');
    expect(cfg.rateLimitPerMin).toBe(200);
  });

  it('ALPACA_PLAN=plus flips feed to sip and budget to 10000', () => {
    process.env.ALPACA_PLAN = 'plus';
    const cfg = alpacaEnv();
    expect(cfg.plan).toBe('plus');
    expect(cfg.feed).toBe('sip');
    expect(cfg.rateLimitPerMin).toBe(10_000);
  });

  it('ALPACA_FEED overrides plan default', () => {
    process.env.ALPACA_PLAN = 'plus';
    process.env.ALPACA_FEED = 'iex';
    expect(alpacaEnv().feed).toBe('iex');
  });

  it('ALPACA_RATE_LIMIT_PER_MIN overrides plan default', () => {
    process.env.ALPACA_RATE_LIMIT_PER_MIN = '500';
    expect(alpacaEnv().rateLimitPerMin).toBe(500);
  });

  it('ignores invalid feed and rate overrides', () => {
    process.env.ALPACA_FEED = 'bogus';
    process.env.ALPACA_RATE_LIMIT_PER_MIN = '-5';
    const cfg = alpacaEnv();
    expect(cfg.feed).toBe('iex');
    expect(cfg.rateLimitPerMin).toBe(200);
  });
});

describe('trading base URL normalization', () => {
  it('defaults to the paper endpoint when unset', () => {
    expect(alpacaEnv().tradingBaseUrl).toBe('https://paper-api.alpaca.markets');
  });

  it('strips a trailing /v2 (existing .env format)', () => {
    expect(normalizeTradingBaseUrl('https://paper-api.alpaca.markets/v2')).toBe(
      'https://paper-api.alpaca.markets',
    );
  });

  it('strips trailing slashes', () => {
    expect(normalizeTradingBaseUrl('https://paper-api.alpaca.markets/')).toBe(
      'https://paper-api.alpaca.markets',
    );
    expect(normalizeTradingBaseUrl('https://paper-api.alpaca.markets/v2/')).toBe(
      'https://paper-api.alpaca.markets',
    );
  });

  it('isPaperEndpoint detects paper vs live hosts', () => {
    expect(isPaperEndpoint('https://paper-api.alpaca.markets')).toBe(true);
    expect(isPaperEndpoint('https://api.alpaca.markets')).toBe(false);
    expect(isPaperEndpoint('not a url')).toBe(false);
  });
});

describe('gating flags', () => {
  it('dataEnabled requires flag + both keys', () => {
    process.env.ALPACA_ENABLED = '1';
    expect(alpacaEnv().dataEnabled).toBe(false);
    process.env.ALPACA_KEY_ID = 'k';
    process.env.ALPACA_SECRET_KEY = 's';
    expect(alpacaEnv().dataEnabled).toBe(true);
  });

  it('mirrorEnabled requires flag + keys', () => {
    process.env.ALPACA_MIRROR_ENABLED = '1';
    expect(alpacaEnv().mirrorEnabled).toBe(false);
    process.env.ALPACA_KEY_ID = 'k';
    process.env.ALPACA_SECRET_KEY = 's';
    expect(alpacaEnv().mirrorEnabled).toBe(true);
  });

  it('mirrorEnabled is blocked by LOCAL_DEV_MODE unless ALPACA_MIRROR_ALLOW_LOCAL=1', () => {
    process.env.ALPACA_MIRROR_ENABLED = '1';
    process.env.ALPACA_KEY_ID = 'k';
    process.env.ALPACA_SECRET_KEY = 's';
    process.env.LOCAL_DEV_MODE = '1';
    expect(alpacaEnv().mirrorEnabled).toBe(false);
    process.env.ALPACA_MIRROR_ALLOW_LOCAL = '1';
    expect(alpacaEnv().mirrorEnabled).toBe(true);
  });

  it('allowLiveTrading defaults off', () => {
    expect(alpacaEnv().allowLiveTrading).toBe(false);
    process.env.ALPACA_ALLOW_LIVE_TRADING = '1';
    expect(alpacaEnv().allowLiveTrading).toBe(true);
  });
});
