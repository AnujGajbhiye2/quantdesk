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
- **Adapters** (`core/data/providers/`): isolated, provider-specific logic only. Yahoo is the first; adding a second provider means one new adapter file + one registry line, zero changes elsewhere.
- **Strategies** (`core/strategy/examples/`): small pure modules. Engine structurally enforces no-look-ahead via a frozen context.
- **Backtest engine** (`core/backtest/engine.ts`): iterates bars front-to-back, fills at next bar's open, applies commission + slippage, produces metrics.
- **Indicators** (`core/indicators/`): wrapped registry with uniform signature. Outputs left-padded with NaN during warm-up so index `i` always maps to bar `i`.
- **DB** (`core/db/`): SQLite schema handles symbols, bars, strategies, signals, paper trades. Migrations run on startup.
- **UI** (`src/app/`, `src/components/`): panels read from DB; no direct provider or strategy knowledge.

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
- SQLite via `better-sqlite3`. Never commit `data/quantdesk.db`. Never hardcode API keys —
  document each in `.env.local.example`.

## Definition of done for any phase
`npm run build` passes, the phase's specified Vitest tests pass, and the spec's Definition
of Done for that phase is demonstrably met. If tests don't pass, the phase is not done.

## Style
- Use hyphens, not em dashes, in all generated code comments, UI text, and docs.
- Keep the UI dense, dark, monospace, keyboard-driven — a terminal, not a marketing page.
- Surface the "research tool, not financial advice, results are hypothetical" disclaimer
  persistently in the UI.

## Out of scope (do not build unless explicitly asked)
Real-money order routing, auto-trading, in-app YouTube transcription, user accounts /
multi-tenant. This is a single-user local research tool.

## Common development patterns

**TypeScript strict mode:**
- No `any` allowed in core contracts: `types.ts`, adapters, engine, strategy interface.
- Adapters and strategies must validate outputs with zod before returning.
- Use `readonly` arrays for bars passed to strategies (enforces no-mutation).

**Adding a new data provider:**
1. Copy `providers/_template.ts` to `providers/new-provider.ts`.
2. Implement the three methods: `getHistory()`, `toProviderSymbol()`, and optionally `getQuote()`, `search()`.
3. Add the API key to `.env.local.example`.
4. Register in `registry.ts` (one line).
5. Run `npm run build` to verify.

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
