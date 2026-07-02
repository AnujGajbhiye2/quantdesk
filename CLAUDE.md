# CLAUDE.md — QuantDesk

## How to work on this project
- The single source of truth is **`QUANTDESK_BUILD_SPEC.md`** in this repo root. Read it
  before doing anything. Do not improvise outside it.
- Build **phase by phase, in order** (Phase 1 → 7). Never start a later phase before the
  earlier one's **Definition of Done** is met and the user has confirmed.
- Honour every **STOP** checkpoint in the spec. At a STOP: summarise what you built, show
  how the Definition of Done is satisfied, then wait for the user. Do not continue.
- Default to **plan mode** at the start of each phase: present the plan for *that phase
  only*, get approval, then implement. One phase per session where possible — start a
  fresh session for the next phase to keep context clean.

## Commands (npm scripts and common tasks)
- `npm run dev` — start Next.js dev server (port 3000)
- `npm run build` — typecheck and build; blocks if TS errors or tests fail
- `npm run test` — run all Vitest tests (phase-specific tests must pass)
- `npm run test:watch -- <file>` — single test file in watch mode
- `node scripts/ingest.ts -- --universe <json>` — bulk-load historical data into DB
- `node scripts/refresh.ts` — incremental EOD update (new bars since last run)

To verify a phase is **done**:
1. Run `npm run build` (passes)
2. Run `npm run test` (phase tests pass)
3. Check against Definition of Done in the spec
4. Get user confirmation before next phase

## Architecture snapshot (the mental model)
- **Adapters** (`core/data/providers/`): isolated, provider-specific logic only. Yahoo is default; Alpaca added for intraday + real-time quotes. Adding a third provider = one new adapter file + one registry line, zero changes elsewhere.
- **Strategies** (`core/strategy/examples/`): small pure modules. Engine structurally enforces no-look-ahead via a frozen context.
- **Backtest engine** (`core/backtest/engine.ts`): iterates bars front-to-back, fills at next bar's open, applies commission + slippage, produces metrics.
- **Indicators** (`core/indicators/`): wrapped registry with uniform signature. Outputs left-padded with NaN during warm-up so index `i` always maps to bar `i`.
- **DB** (`core/db/`): Turso (libSQL) embedded-replica schema handles symbols, bars, strategies, signals, paper trades. Migrations run on startup.
- **UI** (`src/app/`, `src/components/`): panels read from DB; no direct provider or strategy knowledge.
- **Auto-trade engine** (`core/paper/auto-trade.ts`): `runAutoTrade()` called by intraday cron every 15 min. Reuses scanner, broker, risk, recommend, Telegram - no new primitives. Gated by `AUTO_TRADE_ENABLED=1`.
- **Intraday ingest** (`core/data/intraday-ingest.ts`): `ingestIntraday(timeframe)` fetches 15m bars via Alpaca batch endpoint for the auto-trade universe (S&P500 + gold). Upserts into `bars` table with intraday timeframe.
- **Market-hours gate** (`core/market/hours.ts`): `isUsMarketOpen()` - DST-aware ET, NYSE holiday list 2024-2026. Auto-trade loop checks this each tick.
- **Crons** (`src/instrumentation.ts`): three node-cron jobs started at Next.js startup - EOD refresh (21:05 Dublin), Telegram monitor (every 15 min), auto-trade loop (every 15 min 09-16 ET, gated by `AUTO_TRADE_ENABLED`).

## Non-negotiable correctness rules (from the spec — repeated because they matter most)
- **No look-ahead bias.** A strategy evaluating bar `i` may only see bars `0..i`. Enforce
  this structurally in the backtest context, not by convention. Include the look-ahead
  trap test.
- **Realistic fills & costs.** Signals fire on bar close; fills happen at the next bar's
  open by default. Always apply commission + slippage. When stop and target could both hit
  in one bar, assume the worse outcome.
- **Pluggable surfaces only.** Adapters (`core/data/providers/`) and strategies
  (`core/strategy/examples/`) are the only places provider- or strategy-specific logic may
  live. Never leak that logic into the engine, DB, indicators, or UI. Adding a data
  provider must mean **one new adapter file + one registry line** — nothing else.
- **Aligned indicator outputs.** Indicator arrays are left-padded with `NaN` during warm-up
  so index `i` always maps to bar `i`.

## Tech + environment constraints
- Next.js 15 (App Router) + React 19 + TypeScript **strict**. No `any` in core contracts
  (`types.ts`, engine, adapters).
- Charts: **lightweight-charts v5** — use the unified `addSeries(CandlestickSeries, ...)`.
  The old `addCandlestickSeries()` was removed; do not use it. Charts are client-side only
  (init inside `useEffect`). Markers use `createSeriesMarkers`.
- Indicators: `@ixjb94/indicators` (pure TS, zero-dep). Do not pull anything requiring the
  native `canvas` dependency.
- Database: Turso (libSQL) via the `libsql` npm package's synchronous, better-sqlite3-
  compatible API (`import Database from 'libsql'` - never `@libsql/client` or
  `libsql/promise`, both async). One shared remote DB for local dev + prod EC2, connected
  in embedded-replica mode (`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`). `DB_PATH` now
  names the local replica cache file, not the source of truth — still gitignored, safe to
  delete. Unset `TURSO_DATABASE_URL` falls back to a plain standalone local file. Local dev
  should set `LOCAL_DEV_MODE=1` (see `.env.local.example`) to disable all crons against the
  shared DB — this does not block manual UI/API actions. Never hardcode API keys — document
  each in `.env.local.example`.

## Definition of done for any phase
`npm run build` passes, the phase's specified Vitest tests pass, and the spec's Definition
of Done for that phase is demonstrably met. If tests don't pass, the phase is not done.

## Style
- Use hyphens, not em dashes, in all generated code comments, UI text, and docs.
- Keep the UI dense, dark, monospace, keyboard-driven — a terminal, not a marketing page.
- Surface the "research tool, not financial advice, results are hypothetical" disclaimer
  persistently in the UI.

## Out of scope (do not build unless explicitly asked)
Real-money order routing, in-app YouTube transcription, user accounts / multi-tenant.
Auto-trading (paper-only) has been explicitly built and is in scope. Real-money execution remains out of scope.

## Common development patterns

**TypeScript strict mode:**
- No `any` allowed in core contracts: `types.ts`, adapters, engine, strategy interface.
- Adapters and strategies must validate outputs with zod before returning.
- Use `readonly` arrays for bars passed to strategies (enforces no-mutation).

**Adding a new data provider:**
1. Copy `providers/_template.ts` to `providers/new-provider.ts`.
2. Implement the three methods: `getHistory()`, `toProviderSymbol()`, and optionally `getQuote()`, `search()`, `getHistoryBatch()`.
3. Add the API key to `.env.local.example`.
4. Register in `registry.ts` (one line).
5. Run `npm run build` to verify.

**Auto-trade env vars (key ones):**
- `AUTO_TRADE_ENABLED=1` - activates intraday cron (off by default)
- `AUTO_TRADE_DRY_RUN=1` - Telegram-only mode, no DB writes (always start here)
- `AUTO_TRADE_TIMEFRAME=15m` - intraday bar timeframe
- `AUTO_TRADE_MIN_CONSENSUS=2` - strategies that must agree
- `AUTO_TRADE_MAX_TRADES_PER_DAY=5` - hard cap per day
- `AUTO_TRADE_DAILY_LOSS_HALT_PCT=0.03` - halt at -3% equity loss
- `ALPACA_KEY_ID` / `ALPACA_SECRET_KEY` - paper keys (PK...) from app.alpaca.markets

**Manual trigger (bypass market-hours for testing):**
POST `/api/paper` with `{ "action": "auto-trigger" }` or click TRIGGER NOW on `/paper` page.

**Adding a new strategy:**
1. Create `strategy/examples/my-strategy.ts` implementing `Strategy` interface.
2. `onBar(ctx, params)` receives a frozen context with `bars[0..i]` only (no future peeking).
3. Return `StrategyDecision` with `action` and optional `stopPct`, `targetPct`, `sizePct`.
4. Register in `strategy/registry.ts`.
5. Write a test that backtests it; verify no look-ahead trap fires.
6. Run `npm run build && npm run test`.

**Indicator alignment trap:**
- Indicators must pad outputs with NaN for warm-up bars so `output[i]` always maps to `bars[i]`.
- The registry handles this; adapters and strategies don't need to.
- Tests must verify alignment against a known fixture.

**Charts (lightweight-charts v5):**
- Use `addSeries(CandlestickSeries, ...)` (unified API).
- Never use the removed `addCandlestickSeries()`.
- Initialize inside `useEffect`, not at server render time.
- Markers: import and use `createSeriesMarkers`.
