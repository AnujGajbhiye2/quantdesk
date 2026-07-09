# QuantDesk

Self-hosted Bloomberg-terminal-style swing-trading research platform. Dense, dark,
monospace, keyboard-driven. Local-first (Turso/libSQL, one file). No cloud dependency
required to run.

> **Research tool. Not financial advice. Backtest results are hypothetical and subject
> to survivorship bias, look-ahead error, and other limitations. Past performance does
> not predict future results.**

This README explains the system twice over: once as an **engineer** would read it (what
code powers each screen, what pattern it uses, where the data comes from) and once as a
**trader** would read it (what decision each screen and panel supports, what you actually
do with it during a session). Every page and every panel gets both lenses.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Quickstart](#quickstart-local-dev)
3. [Pages and panels](#pages-and-panels) - the main section, every route explained twice
4. [API routes](#api-routes)
5. [Folder structure](#folder-structure) - `src/core/`, `src/components/`, `scripts/`
6. [Core contracts](#core-contracts)
7. [Backtest engine correctness rules](#backtest-engine-correctness-rules)
8. [How to add a strategy / provider](#how-to-add-a-strategy)
9. [Deployment](#production-deployment)
10. [Environment variables](#environment-variables)
11. [Scripts](#scripts)
12. [Auto-trading quick-start](#auto-trading-quick-start)
13. [Alpaca paper-trade mirroring](#alpaca-paper-trade-mirroring) - the path from paper to real money
14. [Out of scope](#out-of-scope)

---

## What it does

- **Terminal dashboard** - multi-panel UI: live quotes, market summary strip, scan
  results, signals, trade ideas, risk gauges, strategy edge verdicts
- **Backtest engine** - runs a strategy against historical OHLCV bars bar-by-bar with a
  structural no-look-ahead guarantee; reports return %, CAGR, win rate, Sharpe, max
  drawdown, trade count, profit factor
- **Cross-sectional momentum** - a second, portfolio-level backtest engine (top-N
  monthly rebalance across a universe) alongside the single-symbol engine, with
  point-in-time index membership filtering to remove survivorship bias
- **Signal scanner** - runs any strategy (or all of them) across the whole universe,
  surfaces current swing-trade signals with human-readable reasons and multi-strategy
  consensus
- **Trade ideas** - risk-sized entries with entry price, stop, target, R/R ratio, qty,
  conviction score, and backtested edge tier
- **Paper trading** - simulate entries manually or via resting limit orders, track
  open/pending/closed positions, mark-to-market against live quotes, per-strategy hit
  rates
- **Decision dossier** - one page per symbol combining technicals, strategy consensus,
  backtested edge, fundamentals, and news into an explicit bull/bear tally
- **Automated intraday paper-trading** - unattended loop: ingests 15m bars from Alpaca,
  runs multi-strategy consensus scan, applies psychology guards (daily-loss halt,
  max-trades/day, anti-revenge filter, no-late-entry, earnings blackout), risk-sizes
  entries at ~1% equity/trade, opens paper trades automatically, sweeps stops/targets,
  sends Telegram notifications
- **Multi-market** - US equities (S&P 500), Indian equities (Nifty 200), EU stocks,
  gold/commodities; pluggable adapter interface for any provider
- **Ops console** - a dedicated session page showing whether the unattended system is
  actually working: last EOD run, ingestion log, decision log, kill switch

---

## Quickstart (local dev)

```bash
npm install
cp .env.local.example .env.local   # fill in keys - see Environment variables section

# Build the database incrementally (rate-limited, resumable)
npm run poll -- --universe scripts/universe/sp500.json
npm run poll -- --universe scripts/universe/nifty200.json

npm run dev
# Open http://localhost:3000
```

Dashboard populates once the DB has bars. Run `npm run refresh` any time for latest EOD
bars.

---

## Pages and panels

Every route under `src/app/`. For each: what an engineer sees in the code, what a
trader does with the screen, and every distinct panel on it by its literal UI label.

### `/` - Dashboard (`src/app/page.tsx` → `Dashboard.tsx`)

**Engineering.** `page.tsx` is a server component: it opens the DB, calls
`getMarketSnapshot()`, `getPaperTrades()`, `getAllSymbols()`, `listStrategies()` at
request time, and passes the result as props into a client component (`Dashboard.tsx`,
the largest single UI file in the app). The client shell is a resizable, tabbed layout
(`react-resizable-panels`) with full keyboard navigation (`useKeyboardNav`): `[1/2/3]`
switch tabs, `[j/k]` move the row cursor, `[/]` opens the command bar, `[g]` opens
go-to-symbol, `[s]` runs a full scan, `[w]` toggles the watchlist sidebar, `[p]` pins a
symbol, `[i]` focuses the trade-ideas list. Tab selection, market filter, and last scan
results persist to `localStorage` via `usePersistedState` so a refresh doesn't lose your
place.

**Trading.** This is the session home screen - the "what's the market doing and what
should I look at" view. A trader typically starts here, filters to a market, scans, then
either jumps into a trade idea or drills into a symbol's dossier.

**Panels:**

| Panel | Engineering | Trading |
|---|---|---|
| Command bar | `CommandBar.tsx`, opened with `[/]` | Type a symbol or strategy to jump straight to a quick scan without touching the mouse |
| SIGNAL SCAN strategy picker | Dropdown + SCAN / SCAN ALL buttons, calls `/api/scan` or `/api/scan-all` | Pick one strategy to test right now, or fire every strategy against every symbol at once |
| Market filter tabs (ALL/US/EU/NSE/BSE...) | Filters the in-memory dataset client-side, no refetch | Narrow the whole dashboard to one market without losing session state |
| Market summary ticker | `MarketSummaryStrip.tsx`, indices/VIX/10Y/BTC/FX sparklines | Macro context check before looking at individual names - "is this a risk-on or risk-off day" |
| Paper budget strip | `AccountStrip.tsx`, reads/writes account settings | Live account equity, cash, and budget at a glance, always visible |
| **Tab 1: SCAN** | `ScanResultsPanel.tsx` (virtualized table) + `GainersLosersPanel.tsx` | Daily "what's moving" screen - price, %chg, volume, sparkline per symbol, click a row to open its backtest |
| **Tab 2: SIGNALS & IDEAS** | `SignalDashboardPanel.tsx` + `TradeIdeasPanel.tsx`, `[i]`-focused keyboard nav, Enter opens `QuickTradeConfirm` | The actionable screen - RSI/MACD/MA-cross state, strategy consensus, and risk-sized entries with stop/target/R:R/conviction ready to fire into a resting paper order |
| **Tab 3: RISK & TRADES** | `RiskPanel.tsx` + `StrategyEdgePanel.tsx` + `TradesPanel.tsx` | Before adding a new position: check concentration/open-risk/correlation gauges, check which strategies are actually trustworthy (TRUST/WATCH/AVOID), review current book |
| Go-to-symbol overlay | `GoToSymbolOverlay.tsx`, `[g]` | Fast jump to any symbol's dossier |
| Watchlist sidebar | `WatchlistSidebar.tsx`, `[w]` | Pinned names you're actively monitoring, always one glance away |

### `/backtest` (`src/app/backtest/page.tsx`)

**Engineering.** Client page (`Suspense`-wrapped for `useSearchParams`). Symbol +
strategy + timeframe pickers call `POST /api/backtest`, which runs `runBacktest()` from
`core/backtest/engine.ts` - the same deterministic, no-look-ahead simulator used
everywhere else in the app. Raw bars for the chart come from a separate `GET /api/bars`
call. Chart is `lightweight-charts` v5, dynamically imported with `ssr: false` and
initialized inside `useEffect`.

**Trading.** This is where you validate a strategy's historical edge on one specific
symbol before trusting its live signal. You're answering: "if I had run this exact rule
on this exact name for the last N years, would I have made money, and how bumpy was the
ride."

**Panels:**

| Panel | Engineering | Trading |
|---|---|---|
| Symbol/strategy/timeframe selector | With a DOSSIER deep-link | Set up the test; jump to the dossier for context |
| Price chart | `PriceChart.tsx`, candles + entry/stop/target lines + trade markers | See exactly where the strategy entered and exited on real price action |
| Metrics panel | `MetricsPanel.tsx` - return%, win rate, Sharpe, max DD, trade count | The headline numbers: is this edge real and is the drawdown survivable |
| Exit projection | `ExitProjection.tsx`, shown when a live signal exists | If the strategy fired today, here's where it would stop/target |
| Signal history timeline | `SignalTimeline.tsx` - every stored signal across all strategies | See how often this symbol has fired signals historically, from any strategy |
| Trades table + equity curve | `TradesTable.tsx` + `EquityCurveChart.tsx`, side by side | Every simulated trade and the compounding curve it produced |
| Monthly returns heatmap | `MonthlyReturnsHeatmap.tsx` | Spot seasonality or a few outsized months carrying the whole result |

### `/compare` (`src/app/compare/page.tsx`)

**Engineering.** Client page. One symbol input drives `POST /api/compare`, which runs
**every** registered strategy as a backtest on that symbol with identical cost
assumptions, returns a sortable `DataTable` plus an S&P 500 buy-and-hold benchmark for
the same date range.

**Trading.** "Which of my strategies actually works on this name" - a strategy-selection
screen per symbol, not a symbol-selection screen. Columns: STRATEGY, RETURN%, WIN RATE,
SHARPE, MAX DD, TRADES, P-FACTOR, each with a glossary tooltip (`InfoTip`). Row click
opens that pairing in `/backtest`.

### `/paper` (`src/app/paper/page.tsx`)

**Engineering.** The largest client page in the app. Fetches four things in parallel via
`POST /api/paper` with different `action` values: `list`, `tradebook`, `mark`,
`account`, `performance`. No SWR - manual `fetch`/`useState` orchestration with a
`loadData` callback re-run after every mutation.

**Trading.** This is the actual trading blotter - where you manage every open, pending,
and closed paper position, close things manually, and watch real P&L develop against
what the backtest implied.

**Panels:**

| Panel | Engineering | Trading |
|---|---|---|
| Paper budget strip | `AccountStrip.tsx` | Cash/equity/budget, same as dashboard |
| Auto-trade status | `AutoTradePanel.tsx` - enabled/dry-run state, today's count, daily P&L, manual trigger | Is the unattended engine on, and can I force a tick right now for testing |
| New trade form | `NewPaperTrade.tsx` | Manual order entry: symbol, side, entry, stop, target, qty |
| Overall stats grid | Computed client-side from the trade list | TOTAL/OPEN/PENDING/CLOSED trades, WIN RATE, TOTAL P&L, OPEN MTM, AVG P&L%, EXPOSURE, BEST/WORST TRADE at a glance |
| `[ PERFORMANCE BY STRATEGY ]` | Table, grouped client-side | Which strategy is actually making money in the live account, not the backtest |
| `[ ACCOUNT EQUITY CURVE ]` | `buildPerformanceMetrics()` in `core/paper/perf.ts`, reuses `EquityCurveChart` | The live account's own equity curve - the number that actually matters, finally visible (added because every backtest had one and the live account didn't) |
| `[ PENDING / RESTING ORDERS ]` | `CHECK FILLS` button hits `/api/paper action:fill-pending` against live quotes | Orders waiting to fill, how close price is to triggering them |
| `[ TRADES ]` | Full blotter, filterable by status and display currency (USD/EUR/GBP/INR/CHF/SEK/NOK/DKK/PLN) | DATE/SYMBOL/STRATEGY/SIDE/ENTRY/CUR/STOP/TARGET/QTY/EXIT/P&L/P&L%/EST HOLD/STATUS/MIRROR, with CLOSE/CANCEL buttons - MIRROR column (Alpaca order status + fill drift bps) only shows when `ALPACA_MIRROR_ENABLED=1` |
| REFRESH PRICES / EOD SWEEP buttons | Re-marks positions against live quotes / runs `sweepOpenTrades()` for stop-target-time-stop exits | Manually force a price update or a stop/target check instead of waiting for the next cron tick |

### `/journal` (`src/app/journal/page.tsx`)

**Engineering.** Client page, single `GET /api/journal` call returns `{ rows, report }`.

**Trading.** Closes the loop between what a strategy promised in backtest and what it
actually delivered live - this is how you decide which strategies to keep following.

**Panels:**

| Panel | Engineering | Trading |
|---|---|---|
| `[ SYSTEM REPORT - what can you actually follow? ]` | Per strategy × market combo: TRUST (10+ live trades within 5pp of backtest win rate), AVOID (materially worse), WATCH (insufficient sample) | Tells you exactly which strategy/market pairings have earned trust versus which are still unproven or underperforming live |
| `[ DECISION LOG (n) ]` | Per-trade card: WHY frozen at open (reason, conviction, R:R, entry/stop/target) plus OUTCOME appended at close | Review your own past reasoning against what actually happened - the core habit-building tool for improving as a trader |

### `/settings` (`src/app/settings/page.tsx` → `SettingsPanel.tsx`)

**Engineering.** Thin page wrapper around one panel component; mutations go through
`GET/POST /api/settings`.

**Trading.** Account administration: display currency, paper starting budget, reset the
paper account (clears trades/journal/signals/edge/alerts, keeps market data), or wipe
everything (full DB clear, requires re-ingest).

### `/symbol/[symbol]` - Decision Dossier (`src/app/symbol/[symbol]/page.tsx`)

**Engineering.** Client page using Next 15's async `use(params)`, data fetched via
`useSWR` against `GET /api/dossier?symbol=`, which assembles technicals, strategy
consensus, backtested edge, fundamentals, and news server-side, plus a deterministic
bull/bear scorer (`core/dossier/case.ts`). Header includes a `SymbolTypeahead` to switch
symbols in place without leaving the page.

**Trading.** The single-page pre-trade due-diligence checklist - "should I trade this
name" - combining every angle the system has into one explicit, auditable tally.

**Sections (desks):**

| Desk | Engineering | Trading |
|---|---|---|
| Verdict bar | `dossier.case.bullScore` from `core/dossier/case.ts` | BULL % vs BEAR % with factor counts - one number to anchor on before reading further |
| BULL CASE / BEAR CASE | Deterministic factor list: trend, momentum regime, strategy consensus, backtested edge, signal track record, 52-week position, earnings, valuation | The actual argument for and against the trade, itemized and numeric, not vibes |
| TECHNICAL | Last close, RSI(14), SMA50/200, % below 52w high, live signals with conviction, consensus long/short count | Current technical state at a glance |
| EDGE & HISTORY | Backtested edge per strategy on this symbol (win%, P-factor, trades) + realized signal hit-rate | Has this specific setup actually worked on this specific name historically |
| FUNDAMENTALS | Market cap, P/E, EPS/revenue growth, margin, analyst target (Yahoo) | Sanity-check the technical setup against the underlying business |
| NEWS | Recent headlines, external links | Catch anything that would override a pure technical read |

### `/dashboard/session` - "SESSION" (`src/app/dashboard/session/page.tsx`)

**Engineering.** Pure server component, `dynamic = 'force-dynamic'` - reads straight
from the DB at request time (`getLatestRun`, `getDecisionsForRun`, `getLatestIngestRun`,
`getPaperTrades`, `buildPerformanceMetrics`, `isTradingHalted`, etc). No client-side
fetch or polling; a page reload is a fresh read. The kill switch is the one interactive
client island.

**Trading.** The ops/monitoring console for the *unattended* automated system - "is the
cron job actually running, did it make good decisions overnight, is anything broken,
can I halt it right now." This is the page you check first thing in the morning, not
during active trading.

**Panels:**

| Panel | Engineering | Trading |
|---|---|---|
| Halt banner | Shown only when `isTradingHalted()` is true | Immediate visual confirmation the system is stopped, and why |
| LAST EOD RUN | Metadata from the most recent scheduled scan, with a stale-run warning past 26h | Did the overnight job actually run and finish |
| INGESTION LOG | Latest refresh stats + symbol-level errors + last-10-runs history | Is the underlying price data actually fresh and complete |
| SIGNAL DECISION LOG | `DecisionLogTable.tsx` - per-symbol × per-strategy grid of why each strategy fired or didn't | Full transparency into every decision the automated scan made |
| OPEN POSITIONS | Current open trades, unrealized P&L off daily close | Overnight/EOD view of the book (not live-marked) |
| RECENT TRADES (LAST 20) | Closed trade history with exit reason | Quick recent-history check |
| PERFORMANCE METRICS | Win rate, avg win/loss, profit factor, drawdown, Sharpe (only shown ≥30 trades) | Since-inception scorecard for the live account |
| KILL SWITCH | Backed by the `app_flags` DB table, two-click confirm | Halt or resume the automated trading loop by hand |

---

## API routes

Every route under `src/app/api/`:

| Route | Method | Purpose |
|---|---|---|
| `/api/backtest` | POST | Run one strategy backtest on one symbol; returns metrics + live idea + exit projection |
| `/api/bars` | GET | Full OHLCV bar array for a symbol/timeframe |
| `/api/compare` | POST | Every registered strategy backtested on one symbol + S&P 500 benchmark |
| `/api/dossier` | GET | Assemble the full decision dossier for a symbol |
| `/api/edge` | GET / POST | GET reads stored edge stats; POST `action:compute` recomputes them for the universe |
| `/api/fx` | GET | Static USD exchange rates for client-side currency conversion |
| `/api/halt` | POST | Trading-halt kill switch (`status` / `halt` / `resume`) |
| `/api/ingest` | POST | Manually trigger a data refresh (incl. today's live bar) |
| `/api/journal` | GET | Decision-log entries joined with trades + the TRUST/WATCH/AVOID report |
| `/api/market` | GET | `MarketRow[]` snapshot for symbols |
| `/api/paper` | POST | Single dispatch endpoint (by `action`) for every paper-trading operation: open/close/cancel/list/tradebook/mark/account/performance/sweep/fill-pending/risk |
| `/api/quotes` | GET | Live provider quotes for stored symbols |
| `/api/scan` | POST | Run one strategy across the watchlist/universe; risk-sized ideas |
| `/api/scan-all` | POST | Run every strategy against every symbol; consensus + ideas + edge summaries |
| `/api/search` | GET | Two-tier symbol search: local DB first, then live provider search |
| `/api/settings` | GET / POST | Account row + FX rates / set currency-budget, reset-paper, reset-all |
| `/api/signals` | GET | Stored signal history for a symbol + retrospective forward-return hit-rate |
| `/api/strategies` | GET | List registered strategy ids + names for UI pickers |
| `/api/watchlist` | GET / POST | Manage pinned watchlist symbols |

---

## Folder structure

### `src/core/` - the domain layer, no UI knowledge

Every subfolder below in **engineering** terms (what it does structurally) and
**trading** terms (what capability it gives a trader).

| Folder | Engineering | Trading |
|---|---|---|
| `types.ts` | Shared domain types: `Bar`, `SymbolMeta`, `Signal`, `TradeIdea`, `PaperTrade` | The vocabulary every screen in the app is built from |
| `data/` | Provider abstraction (`DataProvider.ts` interface, `registry.ts`), ingestion (`ingest.ts`, `intraday-ingest.ts`), universe loading (`universe.ts`), gap detection (`gaps.ts`), point-in-time index membership (`pit-membership.ts`), fundamentals prefetch, `providers/` (Yahoo, Alpaca, Twelve Data adapters) | Where every price you see comes from, and the guarantee that a backtest's universe wasn't cherry-picked with hindsight |
| `db/` | Turso/libSQL access layer, one module per domain: `account`, `alerts`, `bars`, `edge`, `flags`, `journal`, `membership`, `paper`, `research`, `runs`, `signals`, `watchlist` | The system of record for every trade, signal, and setting - nothing here is ephemeral |
| `backtest/` | `engine.ts` (single-symbol simulator), `cross-sectional.ts` (portfolio-level momentum backtest), `fills.ts` (fill/slippage math), `metrics.ts` (Sharpe/drawdown/profit factor), `momentum.ts`, `walkforward.ts` | The lab where every strategy's honesty is tested before it ever sees real signals |
| `strategy/` | `Strategy.ts` interface, `registry.ts`, `context.ts` (frozen no-look-ahead context), `validate.ts` (auto-runs a look-ahead probe on every registered strategy), `examples/` (live implementations), `graveyard/` (retired strategies, unregistered but kept for reproducible rejection evidence) | The actual trading rules - what makes a strategy "RSI reversion" versus "MA crossover" in practice |
| `paper/` | `broker.ts` (order/fill/close engine), `auto-trade.ts` (unattended intraday loop), `daily-auto-trade.ts`, `rotation.ts`, `halt.ts` (kill switch), `perf.ts`, `tradebook.ts`, `earnings-blackout.ts`, `reconcile.ts` (live-vs-backtest + promotion criteria) | Everything that happens between "I want this trade" and "this trade is closed and recorded" |
| `broker/` | `alpaca-env.ts` (plan/feed/rate config), `alpaca-trading.ts` (Trading API client, live-endpoint guard), `mirror.ts` (follower-order engine, broker hooks), `mirror-reconcile.ts` (position diff + slippage drift), `rate-limiter.ts` | Mirrors eligible US paper trades to the Alpaca paper account - the evidence trail before real money |
| `costs.ts` | US regulatory fee model (SEC Section 31 + FINRA TAF on sells), opt-in via env, shared by paper broker and backtest engine | Realistic round-trip costs instead of `costs: 0` |
| `risk/` | `checks.ts` (pre-trade gate), `sizing.ts`, `exposure.ts`, `correlation.ts` | The rules that stop a good idea from becoming an oversized, over-concentrated, or over-correlated bet |
| `edge/` | `compute.ts` (nightly backtested-edge job), `aggregate.ts`, `score.ts` (conviction tiers), `projection.ts` | The numeric backbone behind every "this strategy is trustworthy" claim in the UI |
| `market/` | `hours.ts` (NYSE calendar, DST-aware), `regime.ts` (trend/vol/ADX gating), `markets.ts` (exchange bucket classification), `snapshot.ts` | Knows when markets are open and what regime they're in, so strategies don't fire into a closed market or the wrong conditions |
| `indicators/` | `registry.ts` (uniform, NaN-padded compute interface), `crosses.ts`, `helpers.ts` | Every RSI/MACD/Bollinger/ATR value shown anywhere in the app comes from here |
| `signals/` | `conviction.ts`, `gate.ts` (quality gate), `recommend.ts` (idea sizing), `enrich.ts` | Turns a raw strategy signal into a risk-sized, conviction-scored trade idea |
| `scan/` | `scanner.ts`, `consensus.ts` (multi-strategy agreement), `scan-all.ts`, `cache.ts` | Powers the SCAN and SIGNALS tabs - the daily "what's actionable" sweep |
| `dossier/` | `case.ts` - deterministic bull/bear case builder | Powers the symbol dossier's verdict bar and case lists |
| `notify/` | `telegram.ts`, `commands.ts`, `format.ts`, `heartbeat.ts`, `monitor.ts` | Everything that reaches you outside the browser - entry/exit alerts, daily heartbeat, `/halt` `/resume` `/status` commands |
| `format/` | `currency.ts`, `date.ts`, `fx.ts` | Display formatting only - never touches trading logic |
| `tradingview/` | `open.ts`, `symbol.ts` | Deep-links out to TradingView for charting you'd rather do elsewhere |
| `glossary.ts`, `config.ts` | Tooltip text source (`InfoTip`), global config constants | Keeps every metric's definition consistent and explained in one place |

### `src/components/` - the presentation layer

| Folder | Engineering | Trading |
|---|---|---|
| `dashboard/` | `Dashboard.tsx` (main orchestration), `DecisionLogTable.tsx`, `SessionTables.tsx`, `WatchlistSidebar.tsx` | The dashboard and session-console building blocks |
| `panels/` | Reusable widgets: `AccountStrip`, `AutoTradePanel`, `GainersLosersPanel`, `MarketSummaryStrip`, `MetricsPanel`, `RiskPanel`, `ScanResultsPanel`, `SettingsPanel`, `SignalDashboardPanel`, `StrategyEdgePanel`, `TradeIdeasPanel`, `TradesPanel`, `TradesTable` | Each one is a distinct trading capability - risk gauges, trade ideas, strategy trust, etc |
| `charts/` | `PriceChart.tsx` (lightweight-charts candles + markers), `EquityCurveChart.tsx`, `MonthlyReturnsHeatmap.tsx`, `SignalTimeline.tsx` | Every visual read on price and performance |
| `trade/` | `NewPaperTrade.tsx`, `QuickTradeConfirm.tsx`, `ExitProjection.tsx` | The actual order-entry and confirmation flow |
| `overlays/` | `CommandBar.tsx`, `GoToSymbolOverlay.tsx` | Keyboard-first navigation shortcuts |
| `primitives/` | `AppHeader`, `AppNav`, `DublinClock`, `EdgeBadge`, `EmptyState`, `InfoTip`, `Panel`, `ResizeHandle`, `Sparkline`, `SymbolTypeahead` | Shared building blocks with no domain logic of their own |
| `providers/SettingsProvider.tsx` | App-wide display-currency/FX-rate React context | Keeps currency display consistent across every page |
| `table/DataTable.tsx` | Shared TanStack Table wrapper | The sortable-table look used almost everywhere |

### `scripts/` - operational and research CLIs, not part of the running app

| Script | Purpose |
|---|---|
| `ingest.ts` | Bulk-download full history for a universe |
| `refresh.ts` | Incremental EOD update; also runs `postRefreshTasks()` (sweep, scan-all, edge recompute, gap detection, fundamentals prefetch) |
| `poll.ts` | Rate-limited, resumable historical poller - what you run to build the DB from scratch |
| `build-universe.ts` / `validate-universe.ts` | Build/verify the S&P 500 / Nifty 200 symbol universe JSON |
| `build-pit-membership.ts` | Scrape Wikipedia's index-change history into `index_membership_changes` - removes survivorship bias from cross-sectional backtests |
| `reconcile-providers.ts` | Cross-checks Yahoo vs Alpaca daily closes on split-heavy symbols - verifies the adjusted-price pipeline is actually correct |
| `eval-*.ts` (adx-gate, cost-sensitivity, cross-sectional, improvements, param-plateau, trade-overlap, vol-regime, walkforward) | Offline research harnesses - walk-forward validation, parameter robustness, filter accept/reject evidence. Not called by the running app; run manually when evaluating a change |

---

## Core contracts

`src/core/types.ts`:

```ts
interface Bar {
  time: string;  // UTC. Daily = 'YYYY-MM-DD', intraday = full ISO timestamp
  open: number; high: number; low: number; close: number; volume: number;
}

type AssetClass = 'equity' | 'forex' | 'crypto' | 'commodity' | 'index';
type Timeframe   = '1m' | '5m' | '15m' | '1h' | '1d' | '1wk';

interface SymbolMeta {
  symbol: string;         // canonical internal id, e.g. 'NVDA', 'EURUSD', 'XAUUSD'
  providerSymbol: string; // what the provider calls it
  name: string;
  assetClass: AssetClass;
  currency: string;       // ISO 4217
  exchange?: string;
  providerId: string;
}

interface Signal {
  symbol: string; time: string;
  side: 'long' | 'short' | 'flat';
  strength?: number;  // 0..1 conviction
  reason: string;      // e.g. 'RSI(14)=28 < 30 oversold'
  strategyId: string;
}

interface TradeIdea {
  symbol: string; strategyId: string; side: 'long' | 'short';
  currency: string;
  entryPrice: number; stopPrice: number; targetPrice: number;
  qty: number; riskAmount: number; rewardAmount: number; rr: number;
  reason: string; time: string;
}

interface PaperTrade {
  id: string; strategyId: string; symbol: string;
  side: 'long' | 'short'; currency?: string; qty: number;
  entryTime: string; entryPrice: number;
  exitTime?: string; exitPrice?: number;
  stopPrice?: number; targetPrice?: number;
  status: 'open' | 'closed';
  pnl?: number; pnlPct?: number;
  costs: number;  // commission + slippage
  notes?: string;
}
```

`src/core/strategy/Strategy.ts`:

```ts
interface StrategyContext {
  readonly bars: ReadonlyArray<Bar>;  // frozen [0..i] ONLY - structural no-look-ahead
  readonly i: number;
  readonly position: 'long' | 'short' | 'flat';
  indicator(id: string, params?: object): IndicatorOutput;  // causal, NaN during warmup
}

interface StrategyDecision {
  action: 'enter_long' | 'enter_short' | 'exit' | 'hold';
  stopPct?: number; targetPct?: number; sizePct?: number;
  reason?: string;
}

interface Strategy {
  readonly id: string; readonly name: string; readonly description: string;
  readonly params: z.ZodTypeAny;  // every field has .default()
  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision;
  // must be pure: no I/O, no Date.now(), no external state mutation
}
```

`src/core/data/DataProvider.ts`:

```ts
interface DataProvider {
  readonly id: string;
  readonly assetClasses: AssetClass[];
  toProviderSymbol(symbol: string): string;
  getHistory(symbol: string, timeframe: Timeframe, from: string, to: string): Promise<Bar[]>;
  getQuote?(symbol: string): Promise<{ price: number; time: string } | null>;
  search?(query: string): Promise<SymbolMeta[]>;
  getFundamentals?(symbol: string): Promise<Fundamentals | null>;
  getNews?(symbol: string, count?: number): Promise<NewsItem[]>;
  getHistoryBatch?(symbols: string[], timeframe: Timeframe, from: string, to: string): Promise<Record<string, Bar[]>>;
}
```

Adding a new provider = one new file in `providers/` + one line in `registry.ts`. Zero
changes elsewhere.

---

## Backtest engine correctness rules

Enforced structurally in `src/core/backtest/engine.ts`, not by convention:

1. **No look-ahead bias** - `strategy.onBar()` receives frozen `bars[0..i]`; `bars[i+1]`
   is structurally unreachable, not just undocumented.
2. **Fills at next open** - signals fire on bar `i` close; fills execute at bar `i+1`
   open.
3. **Slippage** - applied adverse to fill direction on every market fill.
4. **Conservative intrabar** - if both stop and target are hit in one bar, the stop
   fills first (worst outcome for the held position).
5. **Final-bar guard** - a signal on the last bar is ignored (no next bar to fill on).
6. **Forced liquidation** - open positions at end-of-series close at the final bar's
   close.
7. **Regime preconditions** - a strategy can declare a required market regime
   (`market/regime.ts`); the engine enforces it before allowing an entry.

---

## How to add a strategy

1. Create `src/core/strategy/examples/my-strategy.ts` implementing `Strategy`.
2. `onBar(ctx, rawParams)` - call `this.params.parse(rawParams)` with a Zod schema (all
   fields with defaults).
3. Return `StrategyDecision`. `ctx.bars` is frozen `[0..i]` - look-ahead is structurally
   impossible.
4. Register in `src/core/strategy/registry.ts` - one line.
5. Write a Vitest test; verify no look-ahead trap fires.
6. `npm run build && npm run test`.

See `docs/AUTHORING_STRATEGIES.md` for the indicator catalogue and worked examples.

## How to add a data provider

1. Copy `src/core/data/providers/_template.ts` to `providers/new-provider.ts`.
2. Implement `getHistory()`, `toProviderSymbol()`, optionally `getQuote()`/`search()`.
3. Validate all outputs with the Zod schemas in `schemas.ts`.
4. Add the API key to `.env.local.example`.
5. Register in `src/core/data/registry.ts` - one line.
6. `npm run build`.

---

## Production deployment

QuantDesk is a **self-hosted single-user tool**. It uses a local libSQL database file
and a persistent in-process cron scheduler. This means it **cannot** run on serverless
platforms (Vercel, Netlify, Cloudflare Workers) - it needs a long-lived Node.js process
and persistent disk storage (or Turso in embedded-replica mode, syncing to a remote
libSQL server).

### Where to host

| Option | Cost | Notes |
|---|---|---|
| VPS (DigitalOcean, Hetzner, Linode) | $4-6/mo | Cheapest reliable choice |
| Home server / Raspberry Pi | ~$0 running cost | Fine with stable broadband |
| Cloud VM (AWS EC2 t3.micro, GCP e2-micro) | ~$5-10/mo | Free tier available on some |

Any Linux machine with Node.js 20+ and 512 MB RAM is sufficient.

### Step-by-step

```bash
# 1. Provision + install Node
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 2. Clone and build
git clone <your-repo-url> quantdesk
cd quantdesk
npm install
npm run build          # must pass before you can start

# 3. Configure
cp .env.local.example .env.local
nano .env.local
```

Minimum for full functionality:

```env
# Telegram alerts
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_CHAT_ID=<your-chat-id>

# Data provider (Yahoo needs no key; Twelve Data key optional for better global coverage)
TWELVE_DATA_API_KEY=<optional-key>

# Alpaca - free paper account at alpaca.markets (required for auto-trading + intraday data)
ALPACA_KEY_ID=<paper-key-id>
ALPACA_SECRET_KEY=<paper-secret>
ALPACA_ENABLED=1

# Automated intraday paper-trading (paper only, never real money)
AUTO_TRADE_ENABLED=1
AUTO_TRADE_DRY_RUN=1           # start here: Telegram-only, no DB writes
AUTO_TRADE_TIMEFRAME=15m
AUTO_TRADE_MIN_CONSENSUS=2
AUTO_TRADE_MAX_TRADES_PER_DAY=5
AUTO_TRADE_DAILY_LOSS_HALT_PCT=0.03

# Risk controls
RISK_MAX_POSITION_PCT=25
RISK_MAX_OPEN_RISK_PCT=6
RISK_MAX_OPEN_TRADES=8
RISK_HALT_DRAWDOWN_PCT=20

# EOD refresh timing (default 21:05 Europe/Dublin ~= 16:05 ET, Mon-Fri)
REFRESH_CRON=5 21 * * 1-5
REFRESH_TZ=Europe/Dublin

# Proximity alert threshold
ALERT_PROXIMITY_PCT=2
```

```bash
# 4. Populate the database (first run downloads full history, 20-60 min per universe)
npm run poll -- --universe scripts/universe/sp500.json
npm run poll -- --universe scripts/universe/nifty200.json

# 5. Run with PM2
npm install -g pm2
pm2 start "npm start" --name quantdesk
pm2 save
pm2 startup   # follow the printed command
```

Check logs: `pm2 logs quantdesk`

**(Optional) Nginx reverse proxy** to expose on 80/443:

```nginx
server {
    listen 80;
    server_name your.domain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/quantdesk /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

HTTPS via Certbot: `sudo apt install certbot python3-certbot-nginx && sudo certbot --nginx`.

### What runs automatically once deployed

| What | When | How |
|---|---|---|
| EOD data refresh + `postRefreshTasks()` (sweep, scan-all, edge recompute, gap detection, fundamentals prefetch) | 21:05 Mon-Fri Dublin (~16:05 ET) | `node-cron` inside the Next.js process |
| Telegram stop/target proximity alerts | Every 15 min Mon-Fri | `node-cron` |
| Intraday bar ingest | Every 15 min, 09:00-16:00 ET Mon-Fri | `node-cron`, requires `AUTO_TRADE_ENABLED=1` |
| Auto paper-trade loop | Every 15 min, 09:00-16:00 ET Mon-Fri | `node-cron`, requires `AUTO_TRADE_ENABLED=1` |

All run automatically as long as `npm start` / PM2 is alive - no separate worker
process.

### Security notes

- No user authentication. If exposed on a public IP, add HTTP basic auth via nginx
  (`htpasswd`) or restrict by IP/VPN.
- Never commit `.env` or `.env.local` - gitignored.
- The database file(s) are gitignored (`/*.db`, `/*.db-wal`, `/*.db-shm`). Back up
  periodically.

---

## Environment variables

See `.env.local.example` for the full annotated list. Yahoo Finance requires no key and
is active by default; every other provider and gate is opt-in.

---

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Next.js dev server on port 3000 |
| `npm run build` | TypeScript check + production build |
| `npm run test` | All Vitest unit tests |
| `npm run test:watch -- <file>` | Single file in watch mode |
| `npm run ingest -- --universe <json>` | Bulk-download history for a universe |
| `npm run refresh` | Incremental EOD update + full post-refresh pipeline |
| `npm run poll -- --universe <json>` | Rate-limited resumable historical poller |
| `npm run build-universe` | Regenerate `sp500.json` / `nifty200.json` from live sources |
| `npm run validate-universe` | Verify universe counts and required benchmarks |
| `npm run build-pit-membership` | Populate point-in-time S&P 500 membership from Wikipedia |
| `npm run reconcile-providers` | Cross-check Yahoo vs Alpaca price series for adjustment correctness |

---

## Auto-trading quick-start

```bash
# 1. Free Alpaca paper account: https://app.alpaca.markets/signup
# 2. Add to .env.local (paper keys start with PK...)
ALPACA_KEY_ID=PKxxxxxxxx
ALPACA_SECRET_KEY=xxxxxxxx
ALPACA_ENABLED=1
TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_CHAT_ID=<your chat id>

# 3. Dry-run first (Telegram-only, no DB writes)
AUTO_TRADE_ENABLED=1
AUTO_TRADE_DRY_RUN=1

# 4. Start and click TRIGGER NOW on /paper to test immediately
npm run dev

# 5. Once happy with the Telegram signals, flip to live paper trades
AUTO_TRADE_DRY_RUN=0
# Restart. Cron fires every 15 min during US RTH (9:30-16:00 ET).
```

Per tick: ingest fresh 15m bars → run all live strategies, build consensus (default ≥2
agree) → psychology filters (daily-loss halt, max-trades/day, no re-entry on a
just-stopped symbol, no entries near close, earnings blackout) → risk-size at ~1%
equity/trade → `openPaperTrade()` (broker enforces budget + risk gate + duplicate
checks) → Telegram entry alert → sweep closes stop/target hits → Telegram exit alert.

---

## Alpaca paper-trade mirroring

Purpose: before risking real money, mirror every eligible internal paper trade onto an
actual Alpaca paper account, so the promotion evidence ("this system can execute on a
real broker") is concrete, not theoretical. The internal system stays the single source
of truth - Alpaca is a **follower**, never the decision-maker.

**Scope.** Only US symbols the system already routes through Alpaca for intraday data
(S&P 500 + gold universe) mirror. NSE and EU trades are skipped - Alpaca cannot trade
them.

**How it works:**

1. `openPaperTrade` / `fillPendingTrade` / `closePaperTrade` (`core/paper/broker.ts`) each
   call a one-line hook into `core/broker/mirror.ts` after the internal DB write.
2. The hook enqueues a `mirror_orders` row (`queued`) and fires an async submit pass -
   never blocks or throws into the trading path.
3. A plain market order goes to Alpaca: `day` time-in-force during market hours, `opg`
   (market-on-open) when the internal trade opened after hours - matching the internal
   next-bar-open fill convention.
4. The 15-minute monitor cron re-drives anything still `queued`/`submitted` and polls
   fills, so a crashed process or an Alpaca outage never loses a mirror order.
5. A nightly job (`core/broker/mirror-reconcile.ts`) diffs Alpaca positions against the
   internal open book (missing/orphan/qty-mismatch → Telegram alert) and computes real
   fill drift vs the internal 5 bps slippage model.

**Why follower orders, not bracket orders.** Alpaca bracket orders (entry + stop-loss +
take-profit legs) would let Alpaca manage stops in real time while the internal engine's
trailing-stop and target-ratchet mutate stops on daily bars - two independent books that
diverge immediately. Follower orders keep one brain (the internal system) making every
decision; Alpaca's fill price becomes the slippage-evidence signal instead of a second
source of truth to reconcile.

**Setup:**

```bash
# 1. Reset the Alpaca paper account to $10k in the dashboard (one click) so
#    buying power matches the internal budget - otherwise position sizes
#    diverge and orders get rejected for insufficient buying power.
# 2. Add to .env.local
ALPACA_MIRROR_ENABLED=1
ALPACA_ENDPOINT=https://paper-api.alpaca.markets
# 3. Restart. Watch /paper's MIRROR column and Telegram for entry/exit confirmations.
```

`ALPACA_ALLOW_LIVE_TRADING` is a hard guard - the trading client throws if the endpoint
is anything other than Alpaca's paper host unless this is set. Real-money order routing
stays [out of scope](#out-of-scope) until explicitly revisited.

**Paid-plan upgrade path (Algo Trader Plus, $99/mo).** Set `ALPACA_PLAN=plus` and swap in
paid keys - feed flips IEX → SIP (full exchange coverage) and the rate budget flips
200 → 10,000 req/min, with zero code changes. `ALPACA_FEED` / `ALPACA_RATE_LIMIT_PER_MIN`
override the plan default individually if needed. Websocket streaming
(`core/data/stream/types.ts`) is interface-only for now - implement when intraday
strategies need it.

**Realistic costs.** Paper trades used to book `costs: 0` (commission defaults to 0;
slippage lives in the fill price, not the costs field). `core/costs.ts` adds the US
regulatory fees that actually apply to a sell (SEC Section 31 + FINRA TAF) - off by
default so historical evidence stays reproducible, opt in per `.env.local.example`.

**Reading the evidence.** `/api/paper action:reconcile` (surfaced on `/journal`) reports a
`slippage` criterion that goes `n/a` (mirroring off) → `pending (n/20 fills)` →
`pass`/`fail` once 20 clean (day-tif) mirrored fills exist. Combined with the existing
60-trade / 6-month promotion criteria, that's the bar before increasing size or moving
to real money.

---

## Non-negotiable rules

- **No `any`** in core contracts: `types.ts`, adapters, engine, strategy interface.
- **Indicator alignment** - outputs left-padded with `NaN` during warm-up so
  `output[i]` always maps to `bars[i]`.
- **Pluggable surfaces only** - provider/strategy logic lives only in adapters and
  strategy examples; never in the engine, DB, indicators, or UI.
- **libSQL access is synchronous** and lives in API route handlers or server components.
- **Charts client-side only** - init inside `useEffect`, never at SSR time; use
  `addSeries(CandlestickSeries, ...)`, not the removed `addCandlestickSeries()`.

---

## Style conventions

- UI: dense, dark, monospace, keyboard-driven - terminal aesthetic, not marketing page.
- Hyphens, not em dashes, in all code comments, UI copy, and docs.
- Persistent disclaimer: "Research tool, not financial advice. Results are hypothetical."
- TypeScript strict throughout; no `any` in core contracts.
- Comments only where the WHY is non-obvious; no docblocks narrating what the code does.

---

## Out of scope

Real-money order routing, user accounts, multi-tenant, in-app YouTube transcription.
Single-user local research tool only. Auto-trading is paper-only.


fixes todo:

fix strategy name
add bearish momentum
