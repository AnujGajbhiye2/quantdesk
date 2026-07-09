/**
 * Sliding-window rate limiter shared across all Alpaca callers.
 *
 * The Alpaca account has ONE request budget (200/min free, 10000/min plus)
 * spanning both the Data API and the Trading API - so the data provider and
 * the trading client must draw from the same limiter instance.
 *
 * acquire() resolves immediately while under budget, otherwise waits until
 * the oldest timestamp in the window ages out. FIFO fairness via a simple
 * promise chain.
 */

import { alpacaEnv } from './alpaca-env';

export class SlidingWindowLimiter {
  private readonly maxPerMinute: number;
  private readonly windowMs = 60_000;
  private timestamps: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(maxPerMinute: number) {
    if (!Number.isFinite(maxPerMinute) || maxPerMinute < 1) {
      throw new Error(`SlidingWindowLimiter: invalid maxPerMinute ${maxPerMinute}`);
    }
    this.maxPerMinute = Math.floor(maxPerMinute);
  }

  /** Resolve when a request slot is available. Callers await before each API call. */
  acquire(): Promise<void> {
    const next = this.chain.then(() => this.waitForSlot());
    // Keep the chain alive even if a caller's downstream work rejects.
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
      if (this.timestamps.length < this.maxPerMinute) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0];
      const wait = Math.max(this.windowMs - (now - oldest), 10);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// Process-wide singleton sized from env at first use. Re-created only if the
// budget changes (env flip mid-process, mainly relevant in tests).
let _limiter: SlidingWindowLimiter | null = null;
let _limiterBudget = 0;

export function alpacaLimiter(): SlidingWindowLimiter {
  const budget = alpacaEnv().rateLimitPerMin;
  if (!_limiter || _limiterBudget !== budget) {
    _limiter = new SlidingWindowLimiter(budget);
    _limiterBudget = budget;
  }
  return _limiter;
}
