# QuantDesk — Build Specification for Claude Code

> **Read this entire document before writing any code.** This is the single source of
> truth for building QuantDesk, a self-hosted, Bloomberg-terminal-style swing-trading
> research platform. Build it in the phases described, in order. Do not skip ahead.
> At the end of every phase there is a **Definition of Done** and a **STOP** checkpoint
> — stop, verify, and let the user confirm before starting the next phase.

---

## 0. Project intent (the "why", so you make good judgement calls)

The user is a senior frontend/full-stack engineer (React, TypeScript, Next.js, Node).
They want a **personal trading research terminal**, not a brokerage and not an
auto-trading bot. The system must:

1. **Look and feel like a Bloomberg / terminal dashboard** — dense, dark, multi-panel,
   monospace, keyboard-driven, fast.
2. **Ingest market data from any provider** behind a swappable adapter interface. Today:
   Yahoo Finance (free). Tomorrow: Dhan (India), a forex API, a gold/commodities API, or
   a paid tier (Polygon, Alpha Vantage). Adding a provider must mean writing **one new
   adapter file** and zero changes anywhere else.
3. **Compute many technical indicators** exposed through one uniform registry so any
   strategy can plug-and-play them.
4. **Run user-defined strategies** (authored as small TypeScript modules) against
   historical data — a **backtest engine** that reports % return, win rate, drawdown,
   number of trades, etc.
5. **Generate current swing-trade signals** for a watchlist using any strategy.
6. **Paper-trade**: simulate "if I buy X today, what happens over N days", track open and
   closed paper positions, and maintain a **trade book** showing how many trades were
   winners, which strategies worked, and at what hit-rate against the live market.

### Critical correctness rules (these prevent the system from lying to the user)
- **NO LOOK-AHEAD BIAS.** A strategy evaluating bar `i` may only see bars `0..i`. Never
  let it peek at bar `i+1` or use the current bar's close to decide the current bar's
  entry. Enforce this structurally in the engine (pass a sliced/most-recent-bar view),
  not by convention. This is the #1 way home-built backtesters produce fake profits.
- **Survivorship bias awareness.** Document in the UI that backtests on a hand-picked
  current watchlist overstate returns (delisted losers are missing). Don't hide it.
- **Trade on confirmed/closed bars.** Signals fire on bar close, fills happen at the
  next bar's open (configurable), never at the same bar's close.
- **Realistic costs.** Backtests and paper trades must support commission + slippage
  parameters and apply them. Default slippage 0.05%, commission configurable.
- **This is not financial advice.** Surface a persistent disclaimer in the UI footer.

---

## 1. Tech stack (use exactly these unless a Definition of Done can't be met)

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js 15 (App Router)** + React 19 + TypeScript (strict) | User knows this stack well |
| Styling | **Tailwind CSS** | Terminal theme via CSS variables |
| Charts | **lightweight-charts v5** (TradingView, Apache-2.0) | See API note below — v5 changed the series API |
| Indicators | **`@ixjb94/indicators`** (pure TS, zero-dep, fast, MIT) | 100+ indicators; do not pull anything needing the `canvas` native dep |
| Local datastore | **SQLite** via `better-sqlite3` | Synchronous, fast, perfect for a single-user local app |
| Data fetch (Yahoo) | **`yahoo-finance2`** npm package | Wraps Yahoo endpoints; treat as unofficial/may break |
| Scheduling | **node-cron** for in-process EOD refresh | Plus a manual "Refresh now" button |
| Validation | **zod** | Validate adapter outputs and strategy configs |
| Testing | **Vitest** | Unit-test indicators and the backtest engine especially |
| Package manager | npm | Match the user's existing tooling |

### lightweight-charts v5 API note (IMPORTANT — your training data is likely stale)
v5 **removed** `addCandlestickSeries()`. Use the unified `addSeries()` form:
```ts
import { createChart, CandlestickSeries, HistogramSeries, ColorType } from 'lightweight-charts';
const chart = createChart(container, { layout: { background: { type: ColorType.Solid, color: '#0a0e14' }, textColor: '#c9d1d9' } });
const candles = chart.addSeries(CandlestickSeries, { upColor: '#26a641', downColor: '#f85149', borderVisible: false, wickUpColor: '#26a641', wickDownColor: '#f85149' });
candles.setData([{ time: '2026-05-20', open: 1, high: 2, low: 0.5, close: 1.5 }]);
```
Markers moved to a primitive: import `createSeriesMarkers` instead of `series.setMarkers()`.
The library is **client-side only** — initialise charts inside `useEffect`, never on the server.

---

## 2. Repository layout (create this skeleton first, in Phase 1)

```
quantdesk/
├─ package.json
├─ tsconfig.json                  # strict: true
├─ next.config.ts
├─ .env.local.example             # documents every supported API key var
├─ README.md
├─ data/
│  └─ quantdesk.db                # SQLite (gitignored)
├─ src/
│  ├─ app/                        # Next.js App Router
│  │  ├─ layout.tsx
│  │  ├─ globals.css              # terminal theme tokens
│  │  ├─ page.tsx                 # main terminal dashboard
│  │  ├─ backtest/page.tsx
│  │  ├─ paper/page.tsx
│  │  └─ api/                     # route handlers (server-side)
│  │     ├─ scan/route.ts
│  │     ├─ backtest/route.ts
│  │     ├─ ingest/route.ts
│  │     ├─ paper/route.ts
│  │     └─ symbols/route.ts
│  ├─ core/
│  │  ├─ types.ts                 # Bar, Symbol, Signal, Trade, etc. (shared contracts)
│  │  ├─ db/
│  │  │  ├─ schema.sql
│  │  │  └─ client.ts             # better-sqlite3 singleton + migrations
│  │  ├─ data/
│  │  │  ├─ DataProvider.ts       # the adapter INTERFACE — the heart of extensibility
│  │  │  ├─ registry.ts           # maps provider id -> adapter instance
│  │  │  └─ providers/
│  │  │     ├─ yahoo.ts           # first concrete adapter
│  │  │     └─ _template.ts       # copy-me stub for new providers
│  │  ├─ indicators/
│  │  │  ├─ registry.ts           # name -> indicator fn, uniform signature
│  │  │  └─ index.ts
│  │  ├─ strategy/
│  │  │  ├─ Strategy.ts           # the strategy INTERFACE
│  │  │  ├─ registry.ts
│  │  │  ├─ context.ts            # safe per-bar view passed to strategies
│  │  │  └─ examples/
│  │  │     ├─ rsi-reversion.ts
│  │  │     ├─ ma-crossover.ts
│  │  │     └─ macd-momentum.ts
│  │  ├─ backtest/
│  │  │  ├─ engine.ts             # the no-look-ahead simulator
│  │  │  └─ metrics.ts            # return %, win rate, Sharpe, max drawdown, etc.
│  │  ├─ paper/
│  │  │  ├─ broker.ts             # paper fills, positions, mark-to-market
│  │  │  └─ tradebook.ts          # aggregate stats per strategy
│  │  └─ scan/
│  │     └─ scanner.ts            # run a strategy across the watchlist -> signals
│  └─ components/                 # terminal UI panels (see Phase 6)
└─ scripts/
   ├─ ingest.ts                   # CLI: bulk-download history for a universe
   └─ refresh.ts                  # CLI: incremental EOD update
```

---

## 3. Core data contracts (`src/core/types.ts`) — define these FIRST

Everything else depends on these. Keep them provider-agnostic.

```ts
// A single OHLCV bar. time is a UTC ISO date string 'YYYY-MM-DD' for daily,
// or full ISO timestamp for intraday. Always store/compute in UTC; only format
// to the user's timezone (Europe/Dublin) at the view layer.
export interface Bar {
  time: string;      // ISO; daily = 'YYYY-MM-DD'
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type AssetClass = 'equity' | 'forex' | 'crypto' | 'commodity' | 'index';
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1d' | '1wk';

export interface SymbolMeta {
  symbol: string;        // canonical internal id, e.g. 'NVDA', 'EURUSD', 'XAUUSD'
  providerSymbol: string;// what the provider calls it (mapping lives in the adapter)
  name: string;
  assetClass: AssetClass;
  currency: string;
  exchange?: string;
  providerId: string;    // which adapter owns this symbol
}

export interface Signal {
  symbol: string;
  time: string;
  side: 'long' | 'short' | 'flat';
  strength?: number;     // optional 0..1 conviction
  reason: string;        // human-readable, e.g. 'RSI(14)=28 < 30 oversold'
  strategyId: string;
}

export type TradeStatus = 'open' | 'closed';
export interface PaperTrade {
  id: string;
  strategyId: string;
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  entryTime: string; entryPrice: number;
  exitTime?: string;  exitPrice?: number;
  stopPrice?: number; targetPrice?: number;
  status: TradeStatus;
  pnl?: number; pnlPct?: number;
  costs: number;         // commission + slippage applied
  notes?: string;
}
```

---

## 4. PHASES

> Build phase by phase. Each phase ends with a **Definition of Done** and a **STOP**.
> Write tests as specified. Run `npm run build` and `npm test` before declaring a phase done.

### PHASE 1 — Skeleton, DB, and the terminal shell
**Goal:** an empty but running Bloomberg-style shell with a working SQLite layer.

Tasks:
1. Scaffold Next.js 15 + TS (strict) + Tailwind. Configure path alias `@/` -> `src/`.
2. Create `src/core/types.ts` exactly as in §3.
3. Set up `better-sqlite3` singleton in `db/client.ts` with a migration runner that
   executes `schema.sql` on first run. Schema (minimum):
   - `symbols(symbol PK, provider_symbol, name, asset_class, currency, exchange, provider_id)`
   - `bars(symbol, timeframe, time, open, high, low, close, volume, PRIMARY KEY(symbol,timeframe,time))`
   - `strategies(id PK, name, config_json, source_path, created_at)`
   - `paper_trades(...)` matching `PaperTrade`
   - `signals(...)` matching `Signal`
   - Add indexes on `bars(symbol, timeframe, time)`.
4. Build the **terminal theme** in `globals.css`: dark bg (#0a0e14 base, #0d1117 panels),
   green (#26a641) up, red (#f85149) down, amber accents, monospace font stack
   (`'JetBrains Mono', 'SF Mono', Menlo, monospace`). Define CSS variables so themes
   are swappable.
5. Build the dashboard shell `app/page.tsx`: a CSS-grid of empty bordered **panels**
   with title bars, matching the reference layout — top status bar, a momentum/scan
   panel, gainers/losers, a signal dashboard, recent trades, and a market-summary
   footer strip with a clock showing **Europe/Dublin** time + market session status.
6. Add a persistent footer disclaimer: "Research tool. Not financial advice. Backtests
   are hypothetical and subject to survivorship and look-ahead error."

**Definition of Done:** `npm run dev` shows the dark multi-panel shell with a live
Dublin clock; the SQLite file is created with all tables; `npm run build` passes.
**STOP. Show the user a screenshot-equivalent description and confirm before Phase 2.**

---

### PHASE 2 — The data provider abstraction (the extensibility core)
**Goal:** ingest from Yahoo today, swap to anything tomorrow by adding one file.

Design `DataProvider.ts` as the contract every adapter implements:
```ts
export interface DataProvider {
  readonly id: string;                      // 'yahoo', 'dhan', 'oanda', 'metals-api'
  readonly assetClasses: AssetClass[];
  // Map a canonical symbol to this provider's symbol (and back).
  toProviderSymbol(symbol: string): string;
  // Pull historical bars. MUST return ascending by time, UTC, gaps allowed.
  getHistory(symbol: string, timeframe: Timeframe, from: string, to: string): Promise<Bar[]>;
  // Optional: latest quote/snapshot for live-ish marks.
  getQuote?(symbol: string): Promise<{ price: number; time: string } | null>;
  // Optional: search/lookup symbols supported by the provider.
  search?(query: string): Promise<SymbolMeta[]>;
}
```
Rules for adapters:
- Adapters **only** translate provider responses into `Bar`/`SymbolMeta`. No business
  logic, no DB writes. Validate output with zod before returning.
- Rate-limit and retry **inside** the adapter (configurable). Document each provider's
  free-tier limits in a comment header (e.g. Alpha Vantage 25 req/day; Finnhub 60/min;
  yahoo-finance2 unofficial/no SLA).
- `registry.ts` reads enabled providers from env and returns the right instance by id.
- Provide `_template.ts`: a fully commented stub a future dev (or Claude) copies to add
  Dhan/forex/gold. The template's header must list the steps: implement the 3 required
  methods, add API key to `.env.local.example`, register in `registry.ts`. **That's it.**

Implement `providers/yahoo.ts` using `yahoo-finance2` (`chart()`/`historical()` for bars,
`quote()` for snapshots, `search()` for lookup). Normalise to UTC `'YYYY-MM-DD'` daily.

Build `scripts/ingest.ts` (CLI): given a universe (a JSON/CSV list of symbols + provider),
fetch full daily history and upsert into `bars` + `symbols`. Bulk first, then incremental.
Build `scripts/refresh.ts`: pull only bars newer than the latest stored `time` per symbol.
Wire `node-cron` to run refresh after US close (21:00 Europe/Dublin ≈ 16:00 ET; make the
cron expression and timezone configurable) and expose `POST /api/ingest` for manual runs.

**Definition of Done:** `npm run ingest -- --universe sp500-sample.json` populates the DB;
re-running `refresh` only adds new bars; a Vitest proves the yahoo adapter normalises a
mocked response into valid `Bar[]`; swapping in a dummy second provider requires touching
only its own file + registry. **STOP and confirm before Phase 3.**

---

### PHASE 3 — Indicator registry
**Goal:** one uniform way to compute any indicator, so strategies plug-and-play.

- Wrap `@ixjb94/indicators` behind `indicators/registry.ts`. Each entry has a uniform
  shape: `{ id, label, params: ZodSchema, compute(bars: Bar[], params): number[] | Record<string, number[]> }`.
  Outputs are aligned to the input bar array (left-pad with `NaN` for warm-up periods so
  index `i` always maps to bar `i` — this alignment is essential for no-look-ahead).
- Ship at minimum: SMA, EMA, WMA, RSI, MACD (line/signal/histogram), Bollinger Bands,
  ATR, Stochastic, StochRSI, ADX, OBV, VWAP, ROC, Williams %R, and a `crossover`/
  `crossunder` helper, plus golden/death-cross detection (50/200 MA).
- Expose `listIndicators()` so the UI and strategy authors can discover what exists.
- **Vitest:** validate at least RSI, MACD, and SMA against known fixture values (use a
  small hand-checked series; document the expected numbers).

**Definition of Done:** registry returns aligned arrays; tests pass; `listIndicators()`
returns the full catalogue. **STOP and confirm before Phase 4.**

---

### PHASE 4 — Strategy interface + backtest engine (the most important phase)
**Goal:** author a strategy as a small TS module; backtest it honestly.

Strategy contract (`strategy/Strategy.ts`):
```ts
export interface StrategyContext {
  // ONLY bars 0..i are accessible. Implemented as a frozen slice/proxy so a strategy
  // CANNOT read the future even by accident.
  bars: ReadonlyArray<Bar>;     // bars[bars.length-1] is the current (just-closed) bar
  i: number;                    // current index
  indicator(id: string, params?: object): number[] | Record<string, number[]>; // cached, aligned
  position: 'long' | 'short' | 'flat';
}
export interface StrategyDecision {
  action: 'enter_long' | 'enter_short' | 'exit' | 'hold';
  stopPct?: number; targetPct?: number; sizePct?: number; reason?: string;
}
export interface Strategy {
  id: string; name: string; description: string;
  params: import('zod').ZodSchema;
  // Called once per bar with a no-look-ahead context. Pure: no I/O, no Date.now().
  onBar(ctx: StrategyContext, params: any): StrategyDecision;
}
```
Engine (`backtest/engine.ts`) requirements:
- Iterate bars front-to-back. For each bar `i`, build a context exposing only `0..i`.
- A signal decided on bar `i`'s close is **filled at bar `i+1`'s open** (default;
  allow `fillOn: 'next_open' | 'close'`). The final bar can't open a position.
- Apply commission + slippage to every fill. Honour stops/targets intrabar using the
  next bars' high/low (be explicit and conservative: if both stop and target are hit in
  the same bar, assume the worse outcome).
- Track equity curve, per-trade records, and produce `metrics.ts`: total return %,
  CAGR, win rate, avg win/avg loss, profit factor, max drawdown %, Sharpe (rf=0),
  exposure, number of trades, avg holding days.
- Output a typed `BacktestResult { trades, equityCurve, metrics, params, symbol, range }`.

Write the three example strategies (RSI reversion, MA crossover, MACD momentum) against
this interface. They double as templates the user will clone when converting a YouTube
strategy into code.

**Tests (mandatory):**
- A deterministic synthetic price series where the correct P&L is hand-calculable; assert
  the engine reproduces it to the cent.
- A **look-ahead trap test**: a malicious strategy that tries to read `ctx.bars[ctx.i+1]`
  must throw or get `undefined`, never the future bar.

**Definition of Done:** all engine tests pass; running a backtest on a stored symbol
returns sensible metrics. **STOP and confirm before Phase 5.**

---

### PHASE 5 — Scanner, paper broker, and trade book
**Goal:** turn strategies into live signals and a tracked paper-trading record.

1. **Scanner** (`scan/scanner.ts` + `POST /api/scan`): given a strategy + watchlist,
   run `onBar` on the **latest** stored bar of each symbol and collect `Signal`s
   (where action != hold). This powers the "Top Momentum / Signal Dashboard" panels.
   Must scan thousands of symbols against the local DB in well under a few seconds.
2. **Paper broker** (`paper/broker.ts`): open/close paper positions from signals or
   manually. Mark-to-market against the latest stored/quoted price. Persist to
   `paper_trades`. Support the user's "if I buy X, in N days what's the result" question
   via a `projectTrade(symbol, entryDate, holdingDays, strategy?)` that replays history
   (if the date is in the past) or tracks forward (if today) and reports the outcome.
3. **Trade book** (`paper/tradebook.ts`): aggregate stats — total trades, open vs closed,
   win rate overall and **per strategy**, total/avg P&L %, best/worst trade, current open
   exposure. This is the "which strategies actually worked, at what %" view.

**Definition of Done:** scanning the watchlist returns signals; opening a paper trade,
advancing time/refreshing, and closing it updates the trade book correctly; per-strategy
win rates compute. Tests cover broker P&L math and tradebook aggregation.
**STOP and confirm before Phase 6.**

---

### PHASE 6 — The Bloomberg-style UI (wire the panels to real data)
**Goal:** the dense terminal in the reference image, fully live against local data.

Panels (each a `components/` file, all dark/monospace/keyboard-friendly):
- **Top status bar:** command input (e.g. `scan --strategy=rsi-reversion --market=US`),
  "Analysis complete / scanned N symbols in Xs", thread/df-feed indicators.
- **Top Momentum / Scan results table:** symbol, name, price, % change, volume, and a
  20-bar sparkline (lightweight-charts mini line series).
- **Top Gainers / Top Losers** split panel.
- **Signal Dashboard:** per symbol RSI(14), MACD state (bullish/bearish), MA(50/200)
  golden/death cross, and the resulting BUY/SELL/HOLD from the selected strategy.
- **Recent / Paper Trades:** date, symbol, side, price, qty, P&L, P&L %, notes,
  colour-coded.
- **Market Summary footer:** index/forex/commodity tiles (S&P, Nasdaq, VIX, 10Y, BTC,
  EURUSD, XAUUSD — whatever's in the DB) each with a sparkline.
- **Detail view / `backtest` page:** a full candlestick chart (lightweight-charts v5,
  see §1 API note) with indicator overlays, entry/exit markers from a backtest, and the
  metrics panel (return %, win rate, drawdown, equity curve).
- **`paper` page:** the trade book with per-strategy performance.

Interaction: vim-style keyboard nav (`j/k` rows, `/` command, `g` go-to-symbol), a status
bar showing latency/feed/clock, and a global symbol switcher. Keep everything fast and
information-dense; avoid whitespace-heavy "marketing" styling.

**Definition of Done:** the dashboard renders live local data across all panels; running a
scan from the command bar populates the tables; clicking a symbol opens the chart with a
backtest overlay; the paper page shows the trade book. `npm run build` passes.
**STOP and confirm before Phase 7.**

---

### PHASE 7 — Strategy authoring workflow + polish
**Goal:** make "YouTube video → my strategy" smooth, and harden the app.

1. **Strategy authoring guide** (`docs/AUTHORING_STRATEGIES.md`): document the `Strategy`
   interface with two worked examples, the list of available indicators, and the rule
   that `onBar` must be pure and never look ahead. Explain the intended workflow: the user
   transcribes a YouTube strategy in a **separate** Claude session, pastes the resulting
   `onBar` logic into a new file under `strategy/examples/`, registers it, and backtests.
   (QuantDesk does not itself call YouTube/transcription APIs — keep that decoupled. If
   the user later wants in-app import, it's a clean future adapter, not core.)
2. **Strategy validation:** when a new strategy file loads, run it through the look-ahead
   trap and a smoke backtest; reject and report if it misbehaves.
3. **Config & secrets:** finalise `.env.local.example` documenting every provider key.
   Never hardcode keys. Never commit `data/quantdesk.db`.
4. **README:** quickstart (install, set env, `npm run ingest`, `npm run dev`), architecture
   overview, "how to add a data provider", "how to add a strategy", and the risk disclaimer.
5. **Error/empty states** in the UI (no data yet, provider rate-limited, backtest with too
   few bars). 

**Definition of Done:** a brand-new strategy can be added and backtested by creating one
file and one registry line; README lets a fresh clone reach a working dashboard.

---

## 5. Guardrails for you, Claude Code, throughout
- Honour every **STOP** checkpoint. Do not build later phases before earlier ones pass.
- TypeScript `strict` on; no `any` in core contracts (engine/types/adapters).
- Write the specified tests; a phase isn't done if its tests don't pass.
- Keep adapters and strategies as the only "pluggable" surfaces — resist leaking provider-
  or strategy-specific logic into the engine, DB, or UI.
- When unsure about a financial-correctness decision (fills, costs, drawdown), choose the
  **conservative** option and leave a code comment explaining the choice.
- Use hyphens, not em dashes, in any generated text/UI/docs.
- Re-verify the lightweight-charts v5 API (§1) before writing chart code; do not use the
  removed `addCandlestickSeries()` method.
- Surface the "not financial advice / hypothetical results" disclaimer persistently.

## 6. Out of scope (do NOT build unless asked later)
- Real-money order routing or live brokerage execution.
- Auto-trading / unattended order placement.
- In-app YouTube transcription (kept as a separate manual step by design).
- User accounts / multi-tenant (this is a single-user local app).