/**
 * Alpaca environment/plan configuration - single source of truth for every
 * Alpaca-related env flag (data feed, rate budget, trading endpoint, mirror
 * gating).
 *
 * Plan-upgrade contract: moving from the free tier to Algo Trader Plus must
 * be an env-only change. Set ALPACA_PLAN=plus (and swap keys) and the feed
 * switches iex -> sip and the rate budget 200 -> 10000 req/min with zero
 * code changes. Individual overrides (ALPACA_FEED, ALPACA_RATE_LIMIT_PER_MIN)
 * win over plan defaults.
 *
 * All values are read at call time - matches the existing env-gating pattern
 * (AUTO_TRADE_ENABLED etc.) so tests and runtime flag flips behave predictably.
 */

export type AlpacaPlan = 'free' | 'plus';
export type AlpacaFeed = 'iex' | 'sip';

export interface AlpacaEnvConfig {
  keyId: string | null;
  secretKey: string | null;
  /** ALPACA_PLAN - 'free' (default) or 'plus' (Algo Trader Plus). */
  plan: AlpacaPlan;
  /** Data feed: ALPACA_FEED override, else plan default (free -> iex, plus -> sip). */
  feed: AlpacaFeed;
  /** Requests/min budget: ALPACA_RATE_LIMIT_PER_MIN override, else 200 (free) / 10000 (plus). */
  rateLimitPerMin: number;
  /** Trading API base URL from ALPACA_ENDPOINT, normalized (no trailing slash, no /v2). */
  tradingBaseUrl: string;
  /** Data provider registration gate: ALPACA_ENABLED=1 plus both keys present. */
  dataEnabled: boolean;
  /** Trade mirroring gate - see mirrorEnabled() logic below. */
  mirrorEnabled: boolean;
  /** ALPACA_ALLOW_LIVE_TRADING=1 - required before a non-paper endpoint is accepted. */
  allowLiveTrading: boolean;
}

const PAPER_ENDPOINT = 'https://paper-api.alpaca.markets';

const PLAN_DEFAULTS: Record<AlpacaPlan, { feed: AlpacaFeed; rateLimitPerMin: number }> = {
  free: { feed: 'iex', rateLimitPerMin: 200 },
  plus: { feed: 'sip', rateLimitPerMin: 10_000 },
};

/**
 * Normalize ALPACA_ENDPOINT: existing .env files carry a trailing '/v2'
 * (leftover placeholder) - strip it plus any trailing slash so the trading
 * client can append versioned paths itself.
 */
export function normalizeTradingBaseUrl(raw: string | undefined): string {
  let url = (raw ?? '').trim();
  if (!url) return PAPER_ENDPOINT;
  url = url.replace(/\/+$/, '');
  if (url.endsWith('/v2')) url = url.slice(0, -3).replace(/\/+$/, '');
  return url || PAPER_ENDPOINT;
}

/** True when the trading base URL points at Alpaca's paper endpoint. */
export function isPaperEndpoint(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).host === 'paper-api.alpaca.markets';
  } catch {
    return false;
  }
}

/** Read the full Alpaca env config. Call at use time, never cache across requests. */
export function alpacaEnv(): AlpacaEnvConfig {
  const keyId     = process.env.ALPACA_KEY_ID?.trim() || null;
  const secretKey = process.env.ALPACA_SECRET_KEY?.trim() || null;
  const hasKeys   = Boolean(keyId && secretKey);

  const plan: AlpacaPlan = process.env.ALPACA_PLAN === 'plus' ? 'plus' : 'free';
  const defaults = PLAN_DEFAULTS[plan];

  const feedRaw = process.env.ALPACA_FEED?.trim();
  const feed: AlpacaFeed = feedRaw === 'sip' || feedRaw === 'iex' ? feedRaw : defaults.feed;

  const rateRaw = Number(process.env.ALPACA_RATE_LIMIT_PER_MIN);
  const rateLimitPerMin =
    Number.isFinite(rateRaw) && rateRaw > 0 ? Math.floor(rateRaw) : defaults.rateLimitPerMin;

  // Mirror gate: explicit flag + keys, and never from a LOCAL_DEV_MODE laptop
  // unless deliberately overridden - the prod EC2 box is the single writer and
  // the only place that should touch the shared Alpaca paper account.
  const localDev   = process.env.LOCAL_DEV_MODE === '1';
  const allowLocal = process.env.ALPACA_MIRROR_ALLOW_LOCAL === '1';
  const mirrorEnabled =
    process.env.ALPACA_MIRROR_ENABLED === '1' && hasKeys && (!localDev || allowLocal);

  return {
    keyId,
    secretKey,
    plan,
    feed,
    rateLimitPerMin,
    tradingBaseUrl: normalizeTradingBaseUrl(process.env.ALPACA_ENDPOINT),
    dataEnabled: process.env.ALPACA_ENABLED === '1' && hasKeys,
    mirrorEnabled,
    allowLiveTrading: process.env.ALPACA_ALLOW_LIVE_TRADING === '1',
  };
}
