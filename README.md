# QuantDesk

A self-hosted Bloomberg-terminal-style swing-trading research platform. Dense,
dark, monospace, keyboard-driven. Local SQLite. No cloud. No auto-trading.

> **Research tool. Not financial advice. Backtest results are hypothetical and
> subject to survivorship bias, look-ahead error, and other limitations. Past
> performance does not predict future results.**

---

## Usage guide

See **[`docs/USAGE.md`](docs/USAGE.md)** for the complete step-by-step guide:
install, build the database, scan strategies, read trade ideas, take paper trades,
run EOD refresh for auto-close on stop/target, review the tradebook.

---

## Quickstart

```bash
# 1. Install
npm install

# 2. Configure
cp .env.local.example .env.local
# Edit .env.local if you want future providers (Yahoo needs no key)

# 3. Validate symbol universes, then build the DB incrementally
npm run validate-universe
npm run poll -- --universe scripts/universe/sp500.json
npm run poll -- --universe scripts/universe/nifty200.json

# 4. Start
npm run dev
# Open http://localhost:3000
```

The dashboard populates once the DB has bars. Run `npm run refresh` any time to
pull the latest EOD bars. The dashboard overlays current quotes for displayed
prices when the provider returns a newer quote than the stored daily bar.

---

## Scripts

| Script                                          | Purpose                                        |
|-------------------------------------------------|------------------------------------------------|
| `npm run dev`                                   | Next.js dev server on port 3000                |
| `npm run build`                                 | TypeScript check + production build            |
| `npm run test`                                  | Run all Vitest unit tests                      |
| `npm run test:watch -- <file>`                  | Single test file in watch mode                 |
| `npm run ingest -- --universe <universe.json>`  | Bulk-download history for a universe           |
| `npm run refresh`                               | Incremental EOD update + paper trade stop/target sweep |
| `npm run poll -- --universe <universe.json>`    | Rate-limited resumable poller (run daily to build DB) |
| `npm run build-universe`                        | Regenerate sp500.json / nifty200.json from live sources |
| `npm run validate-universe`                     | Verify S&P/NIFTY universe counts and required benchmarks |

---

## Architecture

```
src/core/
  types.ts              - Bar, SymbolMeta, Signal, PaperTrade (shared contracts)
  db/                   - better-sqlite3 singleton + schema migrations
  data/
    DataProvider.ts     - adapter interface (the extensibility contract)
    registry.ts         - maps provider id -> adapter instance
    providers/
      yahoo.ts          - Yahoo Finance adapter (active)
      _template.ts      - copy-paste stub for new providers
  indicators/
    registry.ts         - uniform compute(id, bars, params) + listIndicators()
  strategy/
    Strategy.ts         - Strategy interface (StrategyContext, StrategyDecision)
    registry.ts         - register() + list() + get()
    validate.ts         - look-ahead probe + smoke backtest (dev/test auto-runs)
    context.ts          - makeContext(): frozen bars[0..i], no-look-ahead guarantee
    examples/           - rsi-reversion, ma-crossover, macd-momentum
  backtest/
    engine.ts           - bar-by-bar simulator (fills at next bar open, no look-ahead)
    metrics.ts          - return %, CAGR, win rate, Sharpe, max drawdown, etc.
  paper/
    broker.ts           - open/close paper positions, mark-to-market
    tradebook.ts        - aggregate stats per strategy
  scan/
    scanner.ts          - run a strategy across the watchlist -> signals

src/app/
  page.tsx              - main dashboard (scan results, signals, trades, market strip)
  backtest/page.tsx     - candlestick chart + backtest metrics
  paper/page.tsx        - trade book with per-strategy performance
  api/                  - route handlers (scan, backtest, ingest, paper, bars, strategies, market)

src/components/         - terminal UI panels (all dark/monospace)
```

**Key invariants:**
- Adapters (`core/data/providers/`) and strategies (`core/strategy/examples/`) are
  the only places provider- or strategy-specific logic lives. The engine, DB,
  indicators, and UI have no knowledge of any specific provider or strategy.
- `ctx.bars` is a frozen slice `bars[0..i]`. A strategy evaluating bar `i` cannot
  read bar `i+1` - it is structurally inaccessible.
- Indicator outputs are left-padded with NaN during warm-up so `output[i]` always
  maps to `bars[i]`.

---

## How to add a data provider

1. Copy `src/core/data/providers/_template.ts` to `providers/new-provider.ts`.
2. Implement three methods: `getHistory()`, `toProviderSymbol()`, and optionally
   `getQuote()` and `search()`.
3. Add the API key to `.env.local.example` (and `.env.local`).
4. Register in `src/core/data/registry.ts` - one line.
5. Run `npm run build` to verify.

That is all. The engine, scanner, and UI require zero changes.

---

## How to add a strategy

See [`docs/AUTHORING_STRATEGIES.md`](docs/AUTHORING_STRATEGIES.md) for the full
guide including worked examples, the indicator catalogue, and the checklist.

Short version:
1. Create `src/core/strategy/examples/my-strategy.ts` implementing `Strategy`.
2. Register in `src/core/strategy/registry.ts` - one line.
3. Run `npm run build && npm run test` - validation runs automatically.

---

## Environment variables

See `.env.local.example` for the full list. Yahoo Finance requires no key and is
active by default. All other providers are stubs for future use.

---

## Out of scope

Real-money order routing, auto-trading, user accounts, multi-tenant, in-app
YouTube transcription. This is a single-user local research tool.
