# Authoring Trading Strategies for QuantDesk

This guide explains how to turn a trading idea - from a YouTube video, a book, or
your own research - into a testable QuantDesk strategy.

> **Research tool. Not financial advice. Backtest results are hypothetical.**

---

## Workflow

1. **Transcribe** the strategy logic in a separate Claude session (QuantDesk does not
   call YouTube or transcription APIs - this step is deliberately external).
2. **Create** a new file: `src/core/strategy/examples/my-strategy.ts`.
3. **Implement** the `Strategy` interface (see below). Clone `rsi-reversion.ts` as a
   starting point.
4. **Register** in `src/core/strategy/registry.ts` - one line:
   ```ts
   register(new MyStrategy());
   ```
5. **Run** `npm run build && npm run test` - the registry auto-validates your strategy
   in dev/test and will throw a clear report if anything is wrong.
6. **Backtest** at `/backtest` or via `POST /api/backtest`.

That is the entire process.

---

## The Strategy interface

```ts
// src/core/strategy/Strategy.ts

export interface StrategyContext {
  readonly bars: ReadonlyArray<Bar>;   // bars[0..i] only - frozen slice
  readonly i: number;                  // current bar index
  readonly position: 'long' | 'short' | 'flat';
  indicator(id: string, params?: object): IndicatorOutput;
}

export interface StrategyDecision {
  action: 'enter_long' | 'enter_short' | 'exit' | 'hold';
  stopPct?:   number;   // stop-loss distance as fraction of entry, e.g. 0.05 = 5%
  targetPct?: number;   // profit-target distance as fraction of entry
  sizePct?:   number;   // fraction of equity to allocate (0..1], default 1.0
  reason?:    string;   // shown in trade records and signal UI
}

export interface Strategy {
  readonly id:          string;
  readonly name:        string;
  readonly description: string;
  readonly params:      z.ZodTypeAny;   // Zod schema; every field MUST have .default()
  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision;
}
```

---

## Hard rules

### 1. `onBar` must be pure

- No `fetch`, no `Date.now()`, no `Math.random()`, no file reads, no global mutation.
- Same inputs must always produce the same output.
- The engine calls `onBar` thousands of times per backtest; I/O will make it unusable.

### 2. Never look ahead

`ctx.bars` is a **frozen slice of bars[0..i]**. The current bar is `ctx.bars[ctx.i]`
(= `ctx.bars[ctx.bars.length - 1]`). There is no `ctx.bars[i+1]` - it is
structurally inaccessible.

The registry validation also runs an active look-ahead probe: it wraps `ctx.bars` in
a `Proxy` that **throws** if your strategy reads any future bar. You will see the
error at import time in dev/test, not silently at production.

### 3. All param fields must have `.default()`

```ts
// Correct - paramsSchema.parse({}) succeeds, engine can call with empty params
const paramsSchema = z.object({
  period:   z.number().int().positive().default(14),
  oversold: z.number().positive().default(30),
});

// Wrong - paramsSchema.parse({}) will throw, strategy fails validation
const paramsSchema = z.object({
  period: z.number().int().positive(),  // no .default()!
});
```

---

## Available indicators

Call `ctx.indicator(id, params)` inside `onBar`. All outputs are **NaN-padded during
warm-up** so `output[i]` always maps to `bars[i]`. Guard with `Number.isFinite()`
before using a value.

| id        | label                                    | key params (with defaults)                                  | output shape              |
|-----------|------------------------------------------|-------------------------------------------------------------|---------------------------|
| `sma`     | Simple Moving Average                    | `period=20`                                                 | `number[]`                |
| `ema`     | Exponential Moving Average               | `period=20`                                                 | `number[]`                |
| `wma`     | Weighted Moving Average                  | `period=20`                                                 | `number[]`                |
| `rsi`     | Relative Strength Index                  | `period=14`                                                 | `number[]`                |
| `macd`    | MACD                                     | `short=12, long=26, signal=9`                               | `{ macd, signal, histogram }` |
| `bbands`  | Bollinger Bands                          | `period=20, stddev=2`                                       | `{ lower, middle, upper }` |
| `atr`     | Average True Range                       | `period=14`                                                 | `number[]`                |
| `stoch`   | Stochastic Oscillator                    | `kperiod=14, kslow=3, dperiod=3`                            | `{ k, d }`                |
| `stochrsi`| Stochastic RSI                           | `period=14`                                                 | `number[]`                |
| `adx`     | Average Directional Index                | `period=14`                                                 | `number[]`                |
| `obv`     | On-Balance Volume                        | _(none)_                                                    | `number[]`                |
| `vwap`    | Volume-Weighted Average Price (rolling)  | `period=14`                                                 | `number[]`                |
| `roc`     | Rate of Change                           | `period=12`                                                 | `number[]`                |
| `willr`   | Williams %R                              | `period=14`                                                 | `number[]`                |

Multi-output indicators return `Record<string, number[]>`. Cast accordingly:

```ts
const bb = ctx.indicator('bbands') as { lower: number[]; middle: number[]; upper: number[] };
const upper = bb.upper[ctx.i];
```

---

## Worked example 1: RSI mean reversion

Full source: `src/core/strategy/examples/rsi-reversion.ts`

```ts
const paramsSchema = z.object({
  period:    z.number().int().positive().default(14),
  oversold:  z.number().positive().default(30),
  exitLevel: z.number().positive().default(50),
  stopPct:   z.number().positive().optional(),
  targetPct: z.number().positive().optional(),
  sizePct:   z.number().positive().max(1).default(1),
});

export class RSIReversionStrategy implements Strategy {
  readonly id          = 'rsi-reversion';
  readonly name        = 'RSI Mean Reversion';
  readonly description = 'Enter long when RSI drops below oversold; exit when RSI recovers.';
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p      = paramsSchema.parse(rawParams);
    const rsi    = ctx.indicator('rsi', { period: p.period }) as number[];
    const rsiNow = rsi[ctx.i];           // current bar's RSI

    if (ctx.position === 'flat') {
      if (Number.isFinite(rsiNow) && rsiNow < p.oversold) {
        return {
          action:  'enter_long',
          stopPct: p.stopPct,
          reason:  `RSI(${p.period})=${rsiNow.toFixed(1)} < ${p.oversold} oversold`,
        };
      }
    }

    if (ctx.position === 'long') {
      if (Number.isFinite(rsiNow) && rsiNow > p.exitLevel) {
        return { action: 'exit', reason: `RSI recovered above ${p.exitLevel}` };
      }
    }

    return { action: 'hold' };
  }
}
```

Key patterns to note:
- `paramsSchema.parse(rawParams)` at the top of `onBar` - normalises and applies defaults.
- Guard `Number.isFinite(rsiNow)` before using the indicator - NaN during warm-up.
- `ctx.bars[ctx.i]` is the current bar. `ctx.bars[ctx.i - 1]` is the previous bar (safe
  if `ctx.i >= 1`). Never access `ctx.bars[ctx.i + 1]`.

---

## Worked example 2: SMA crossover

Full source: `src/core/strategy/examples/ma-crossover.ts`

```ts
onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
  const p = paramsSchema.parse(rawParams);

  if (ctx.i < 1) return { action: 'hold' };  // need 2 bars for cross detection

  const fast = ctx.indicator('sma', { period: p.fast }) as number[];
  const slow = ctx.indicator('sma', { period: p.slow }) as number[];

  // Compare bar[i-1] vs bar[i] - both within the causal slice, no look-ahead
  const f0 = fast[ctx.i - 1], f1 = fast[ctx.i];
  const s0 = slow[ctx.i - 1], s1 = slow[ctx.i];

  if (![f0, f1, s0, s1].every(Number.isFinite)) return { action: 'hold' };

  const crossedUp   = f0 <= s0 && f1 > s1;   // golden cross
  const crossedDown = f0 >= s0 && f1 < s1;   // death cross

  if (ctx.position === 'flat'  && crossedUp)   return { action: 'enter_long' };
  if (ctx.position === 'long'  && crossedDown) return { action: 'exit' };
  return { action: 'hold' };
}
```

---

## Registering your strategy

Edit `src/core/strategy/registry.ts` - add **one line** at the bottom:

```ts
import { MyStrategy } from './examples/my-strategy';

// ... existing register() calls ...
register(new MyStrategy());
```

The next `npm run dev` or `npm run test` will automatically validate `MyStrategy`
(look-ahead probe + smoke backtest). If validation fails you will see:

```
Error: Strategy 'my-strategy' failed validation:
  - look-ahead detected at bar i=5: bars[6] accessed at bar i=5 - future bar read
```

Fix the issue and re-run.

---

## Running a backtest

**UI:** Navigate to `/backtest`, enter a symbol, select your strategy, click RUN.

**API:**
```bash
curl -X POST http://localhost:3000/api/backtest \
  -H 'Content-Type: application/json' \
  -d '{"strategyId":"my-strategy","symbol":"AAPL"}'
```

Response includes `metrics` (total return %, win rate, drawdown, Sharpe) and
`trades` (every entry/exit with fill price, P&L, and reason).

---

## Checklist before submitting a strategy

- [ ] `onBar` is pure - no `fetch`, no `Date.now()`, no `Math.random()`
- [ ] All indicator values guarded with `Number.isFinite()` before use
- [ ] No `ctx.bars[ctx.i + k]` for any `k > 0`
- [ ] All `paramsSchema` fields have `.default()` values
- [ ] `npm run build` passes (TypeScript strict, no `any` in core contracts)
- [ ] `npm run test` passes (look-ahead trap + smoke backtest run in register())
