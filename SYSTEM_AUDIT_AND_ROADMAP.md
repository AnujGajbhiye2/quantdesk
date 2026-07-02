# QuantDesk — System Audit and Phased Roadmap

Dual-lens audit of the system as of 2026-07-02 (branch point: `main` @ 79c8f10), from two
perspectives: a principal staff engineer (correctness, reliability, operations) and a
professional trader (edge, risk, execution, UX). Part A is the audit; Part B is the
phase-by-phase action plan. Each phase has a goal, tasks, and a Definition of Done.

Ground rules used throughout:

- Free data sources first. Paid options are flagged inline with cost where they are a
  meaningful upgrade.
- Correctness before alpha. Several audit findings mean the current backtest numbers
  cannot be fully trusted; new signal work built on top of them would be wasted research.
- Paper trading only. Real-money execution stays out of scope; Phase 7 defines the
  numeric evidence bar that would justify it.

---

## Part A — Audit findings

### A1. Engineering findings (severity order)

1. **Yahoo prices are unadjusted; Alpaca prices are adjusted.** `yahoo.ts` uses raw
   `q.open/high/low/close` from the chart API and never reads the `adjclose` series
   (`src/core/data/providers/yahoo.ts:130-176`), while the Alpaca adapter requests
   `adjustment: 'all'` (`src/core/data/providers/alpaca.ts:169`). Any split on a
   Yahoo-sourced name injects a large artificial gap into the stored series: false
   stop-outs, false breakout signals, distorted backtest and edge metrics. The same
   strategy sees different price series depending on which provider served the symbol.
   This is the single highest-impact correctness bug in the system.

2. **Survivorship bias in every backtest and edge number.** Universes are static
   current-membership snapshots (`scripts/universe/sp500.json`, loaded via
   `src/core/data/universe.ts`) applied retroactively to 2015
   (`src/core/data/ingest.ts:23`). Companies that were delisted, acquired, or dropped
   from the index are invisible, so all reported win rates, profit factors, and Sharpe
   ratios are optimistically biased. The cross-sectional momentum module documents this
   honestly (`src/core/backtest/cross-sectional.ts:34-38`) but nothing mitigates it.

3. **Sharpe annualization hardcoded to daily.** `/api/backtest` passes
   `barsPerYear: 252` regardless of the requested timeframe
   (`src/app/api/backtest/route.ts:95`). A 15m backtest should use ~9,828 bars/year -
   its Sharpe is understated roughly 6x; a weekly backtest is overstated. The engine
   supports `barsPerYear` correctly; the API caller ignores it.

4. **NYSE holiday table expires end of 2026.** `src/core/market/hours.ts:16-63` lists
   holidays for 2024-2026 only. From 2027-01-01 the market-open gate treats every
   holiday as a normal session and the auto-trade loop will fire into a closed market.
   Half-days (day after Thanksgiving, Christmas Eve) are already mishandled.

5. **UTC date used as the ET trading day.** `todayET()` deliberately returns the UTC
   date (`src/core/paper/auto-trade.ts:149-156`, same pattern in
   `daily-auto-trade.ts:108`). Max-trades-per-day and the anti-revenge
   (no re-entry after stop-out) gates key off this date, and UTC midnight lands at
   19:00-20:00 ET - the day can roll during the evening, mis-scoping both gates.

6. **Rotation can close a winner and get nothing back.** On a risk-check rejection,
   `maybeRotateForCandidate` actually closes an existing position, then retries the
   open; if the retry throws (`src/core/paper/auto-trade.ts:578-585`, mirrored in
   `daily-auto-trade.ts:457-464`), the exit is booked with no replacement - a real
   net-negative outcome recorded merely as a `risk-check` skip.

7. **Production DB files sit untracked in the repo root.** `quantdesk-prod.db`,
   `quantdesk.db` and their `-wal`/`-shm` companions are not gitignored (only `/data/`
   is). One `git add .` commits production data. It is also unclear which path is
   authoritative versus the `data/quantdesk.db` default in `src/core/db/client.ts:6`.

8. **The core research output is untested.** `src/core/backtest/metrics.ts` (Sharpe,
   max drawdown, profit factor - the numbers every decision rests on) has no test
   file. Also untested: `walkforward.ts`, `cross-sectional.ts`, `daily-auto-trade.ts`,
   `intraday-ingest.ts`, `scan-all.ts`, `edge/compute.ts`, `market/regime.ts`,
   `risk/correlation.ts`, `risk/exposure.ts`, and every `db/*` module. 41 test files
   cover 127 sources; the covered set (engine, fills, broker, risk checks, consensus)
   is well chosen, but the metrics gap is the one that matters most.

9. **Cron reliability is best-effort.** All schedules run in-process via node-cron
   inside the Next server (`src/instrumentation.node.ts`), single PM2 instance with
   `max_memory_restart: 512M` - a memory restart mid-tick silently drops that tick
   (possibly a sweep). There is no overlap lock, so a slow network-bound 15-minute tick
   can overlap the next one. A failed sweep is swallowed and entries still proceed that
   tick (`auto-trade.ts:209-213`). The file's own comment recommends system cron for
   production - the recommended mode is not the deployed mode.

10. **One bad bar drops the whole symbol; no gap detection.** `validateBars` throws on
    the first non-conforming bar (`src/core/data/schemas.ts:72-82`), aborting that
    symbol's entire ingest for the run. Nothing detects missing trading days, stale
    symbols, or partial daily bars that persist when a refresh is missed. Yahoo
    high/low clamping (`yahoo.ts:164-167`) masks bad data rather than flagging it.

11. **`exposurePct` double-counts with partial exits.** Partial exits push an extra
    trade record spanning the same bars (`src/core/backtest/engine.ts:494-511`) and
    `exposurePct` sums `holdingBars` across all records
    (`src/core/backtest/metrics.ts:121`) - it can exceed 100% when partials are on.
    (`exposureSharpe` de-dupes bars and is unaffected; the two disagree internally.)

12. **Deployment assets are contradictory; docs have drifted.** `Dockerfile` +
    `docker-compose.yml` + `scripts/deploy.sh` describe a Docker path, but the real
    deploy is GitHub Actions -> AWS SSM -> `pm2 restart quantdesk`. The Dockerfile
    still installs build deps for `better-sqlite3`, which is no longer a dependency.
    `CLAUDE.md` still describes the DB as plain SQLite. Minor: dead
    `refreshUniverse` import kept alive in `instrumentation.node.ts:151-160`, `.bak`
    universe files committed, `providers/_template.ts` ships in `src`.

Also noted (lower severity): libSQL embedded-replica workarounds (positional params
only, no transactions) are convention-enforced with silent failure on violation
(`src/core/db/client.ts:16-36`); no unique DB index enforces one open position per
symbol (duplicate protection is app-level with a TOCTOU window,
`src/core/paper/broker.ts:134`); the target fill model applies no slippage on gap-up
opens (`engine.ts:616-617`); Telegram error paths can echo API responses into logs
(`src/core/notify/telegram.ts:62`); static FX rates drift multi-market PnL.

### A2. Trading findings — what the book actually is

**The live book:** three strategies, all long-only daily-designed mean reversion -
`bollinger-reversion`, `rsi-reversion`, `stoch-reversal`
(`src/core/strategy/registry.ts:43-47`) - executed intraday on 15m bars
(`AUTO_TRADE_TIMEFRAME` default `15m`), a timeframe they were never walk-forward
validated on. Consensus requires 2-of-3 agreement. Two other strategies are disabled
with honest annotations (`roc-momentum`: zero OOS trades; `atr-trend`: negative OOS
Sharpe). Nine more exist as research-only.

**The edge, honestly stated:** best documented single-symbol OOS Sharpe is ~0.42
(bollinger-reversion), with heavy in-sample to out-of-sample decay. The new
cross-sectional 12-1 momentum backtest (`src/core/backtest/cross-sectional.ts`,
`momentum.ts`) reports **1.44 average OOS Sharpe** - by far the strongest result in
the repo - but it is research-only, survivorship-biased, and tested on a single
post-2020 bull regime. The author's own caveat: "a lead, not a proven edge."

**Risk infrastructure is genuinely good** - better than the alpha it protects:
1%-of-equity risk sizing (`src/core/risk/sizing.ts`), 25% concentration cap, 6% total
open-risk cap, per-market and global position caps, a 12% drawdown breaker requiring
manual reset, correlated-cluster blocking (0.7 correlation / 3% cluster risk,
`src/core/risk/checks.ts:51`), daily loss halts, max-trades-per-day, no-re-entry after
same-day stop-out, and a Telegram kill switch.

**Built but inert - the switched-off risk brain:**

- Regime gating: `Strategy.regime` and `checkRegime` are fully implemented, but no
  strategy declares a regime requirement, so the gate never fires.
- ADX ranging gate on the live mean-reversion strategies defaults to `adxMax: 100` =
  off (`rsi-reversion.ts:24-25`). Live MR runs with no trend filter.
- Trailing stop is fully wired into the broker (`broker.ts:708-844`) but
  `TRAILING_STOP_ENABLED` is off by default.
- Earnings and news are fetched into `fundamentals_cache` / `news_cache` but are
  display-only in the dossier - nothing blacks out entries around earnings dates.

**Missing entirely:** any volatility filter (VIX or realized-vol position scaling),
sector exposure caps (correlation is the only proxy), benchmark comparison (no SPY
buy-and-hold overlay anywhere), the short side (interface supports it, zero strategies
use it), parameter robustness checks (defaults are hand-picked and never validated
for neighborhood stability), point-in-time universe membership, and live-vs-backtest
reconciliation beyond single-trade projection.

### A3. Trader UX findings

**Strong:** dense keyboard-driven terminal (g/s/w/p/i/j/k, command bar), conviction-
scored trade ideas with a quality gate and WHY snapshots into the journal, a journal
with TRUST/WATCH/AVOID strategy verdicts, rich Telegram integration (entry/exit/
rotation alerts, proximity monitor, daily heartbeat, /halt /resume /status), watchlist
sidebar, session ops dashboard with kill switch, multi-currency display.

**Gaps, ranked by how much they hurt a working trader:**

1. **No indicators on the chart.** RSI, Bollinger, MAs exist only as table columns and
   dossier text. A trader cannot see why a mean-reversion signal fired on the chart
   that shows the trade markers (`src/components/charts/PriceChart.tsx`).
2. **No intraday chart.** The auto-trader executes on 15m bars; the UI can only chart
   1D/1W. The executed timeframe is invisible.
3. **No paper-account equity curve or daily P&L calendar.** Equity curves exist only
   per-backtest; the live account's own curve - the number that matters - is nowhere.
4. **Positions don't self-update.** `/paper` marks to price only on manual REFRESH.
5. Dossier page not in the nav; no saved backtest runs or parameter inputs; no in-app
   alert management (all env/cron); no post-open bracket editing.

---

## Part B — Phased roadmap

Order matters: Phases 0-2 make the numbers and the execution path trustworthy,
Phases 3-5 are where expected P&L improvement lives, Phase 6 is trader ergonomics,
Phase 7 is the evidence bar for real money. Do not start a later phase before the
earlier one's Definition of Done is met and confirmed.

### Phase 0 — Hygiene (half a day)

Goal: remove foot-guns and lies from the repo.

- Gitignore `*.db`, `*.db-wal`, `*.db-shm` in the repo root; document which DB path is
  authoritative and delete the strays after confirming they are replica caches.
- Delete the stale Docker assets (`Dockerfile`, `docker-compose.yml`,
  `scripts/deploy.sh`) or rewrite them to match the real PM2/SSM deploy - not both.
- Fix `CLAUDE.md` architecture drift (Turso/libSQL, not SQLite).
- Remove the dead `refreshUniverse` import in `instrumentation.node.ts`; delete
  `.bak.json` universe files.
- Formally bin `roc-momentum` and `atr-trend`: move them out of `examples/` into a
  `graveyard/` folder (or delete) with the OOS evidence recorded in the commit message.

Definition of Done: `git status` clean of DB files; one true deploy story; docs match
reality; build passes.

### Phase 1 — Data and metrics honesty (the foundation)

Goal: every number the system reports is computed on adjusted, validated,
survivorship-aware data with correct annualization. Everything downstream depends on
this phase.

- **Adjusted Yahoo prices:** read `adjclose`, scale OHLC by the `adjclose/close`
  ratio per bar so the whole series is split/dividend adjusted, matching Alpaca's
  `adjustment: 'all'`. Add a reconciliation script comparing Yahoo-vs-Alpaca series on
  overlap symbols; alert on divergence beyond tolerance. Re-ingest affected history.
- **Correct annualization:** derive `barsPerYear` from the requested timeframe in
  `/api/backtest` (252 daily, 52 weekly, ~9,828 for 15m RTH bars).
- **Metrics tests:** add `metrics.test.ts` with hand-computed fixtures for Sharpe, max
  drawdown, profit factor (including the PF=Infinity zero-loss case). Fix the
  `exposurePct` partial-exit double-count by de-duping bars the way `exposureSharpe`
  already does.
- **Calendar correctness:** compute NYSE holidays algorithmically (the rules are
  fixed: New Year, MLK, Presidents, Good Friday, Memorial, Juneteenth, July 4, Labor,
  Thanksgiving, Christmas, with observation shifts) plus half-day handling; add a
  startup assertion that fails loudly if the calendar cannot cover the current year.
  Fix `todayET()` with a proper ET conversion (`Intl.DateTimeFormat` with
  `America/New_York` - no dependency needed).
- **Data quality:** quarantine individual bad bars (log + skip) instead of aborting
  the symbol; add a missing-trading-day gap detector over stored history with a
  Telegram report; flag rather than clamp inconsistent high/low.
- **Point-in-time universe:** build an S&P 500 membership table
  (symbol, added_date, removed_date) from Wikipedia's change history - the
  [teddykoker survivorship-free approach](https://github.com/teddykoker/survivorship-free-spy)
  and [riazarbi's PIT constituent method](https://riazarbi.github.io/quant/backtesting-sp500-constituent-history/)
  are both free and documented. Backtests filter the universe by membership at each
  rebalance date. Known limitation on free data: Yahoo lacks price history for many
  delisted names, so PIT membership removes the *selection* bias even where prices
  are missing. Paid upgrade if the edge proves out:
  [EODHD historical constituents + delisted prices](https://eodhd.com/financial-apis-blog/sp-500-historical-constituents-data)
  (~$20/mo).
- **Re-validate the live book:** re-run the walk-forward evaluation
  (`scripts/eval-walkforward.ts`) for the 3 live strategies on the corrected data.
  If a strategy no longer clears the bar, demote it - that is the point of this phase.

Definition of Done: reconciliation script shows Yahoo/Alpaca agreement; metrics tests
pass; calendar assertion in place; PIT membership table populated; fresh walk-forward
report on honest data exists and the live roster reflects it.

### Phase 2 — Execution safety

Goal: the auto-trade tick cannot lose money through mechanics.

- **Fix rotation ordering:** never close the incumbent until the candidate's open has
  passed all risk checks that don't depend on the freed slot; where the slot itself is
  the blocker, close-then-open must re-open the incumbent (compensating action) if the
  candidate open fails.
- **Cron overlap lock:** a lock row in the DB (acquire at tick start with a staleness
  timeout, release at end). A tick that finds a live lock skips and logs.
- **Sweep failures block entries:** if the open-position sweep throws, do not proceed
  to new entries that tick - unmanaged stops are worse than a missed entry.
- **One open position per symbol, enforced by the DB:** partial unique index on
  `paper_trades (symbol) WHERE status = 'open'` (positional-param safe), closing the
  TOCTOU window.
- **Kill stop/target re-derivation drift:** carry the scan result (stop/target pcts)
  from the consensus stage into execution instead of re-running `scanSymbol`
  (`auto-trade.ts:414-422`), so the executed bracket is the one that generated the
  signal.
- Align the daily-loss-halt scope: realized and unrealized components should cover the
  same trade set.

Definition of Done: failure-injection tests for the tick (sweep throws, open throws
mid-rotation, concurrent tick) show no orphaned closes, no duplicate positions, no
entries after failed sweeps.

### Phase 3 — Switch on the risk brain (built, inert)

Goal: activate the already-implemented filters, each justified by before/after
walk-forward evidence - the cheapest expected P&L improvement in the repo.

**Evidence gathered this pass** (run against the local `data/quantdesk.db` research
snapshot - not yet the Phase-1-corrected adjusted/PIT data, so treat as directional,
re-run once that re-ingest happens):

- **ADX ranging gate: REJECTED.** `scripts/eval-adx-gate.ts` at `adxMax=25` on SP500 +
  Nifty200 walk-forward: OOS Sharpe and win rate both *fell* for all 3 live strategies
  on both universes (drawdown improved, but not enough to clear the acceptance bar).
  Left at the default (100 = off); the rejection reasoning is now inline in each
  strategy's `adxMax` param comment (`rsi-reversion.ts`, `bollinger-reversion.ts`,
  `stoch-reversal.ts`) so a future session doesn't re-flip it without re-running the
  harness. Don't assume "add a trend filter" is free money - it wasn't, here.
- **Trailing stop: ACCEPTED**, and this was already known - `.env.local.example`
  documented the same finding before this session touched it (+0.09 avg OOS Sharpe).
  Independent re-run via `scripts/eval-improvements.ts FEATURE=trailing` vs `FEATURE=none`
  confirms it: all 3 strategies improve on Sharpe (+0.06 to +0.09), win rate (+9 to
  +14pp), and drawdown (all lower) at the current default params (3% activation,
  1.5% distance). **Not flipped `TRAILING_STOP_ENABLED=1` in this pass** - it's a live
  paper-trading behavior change (not a bug fix), and `.env.local.example`'s own comment
  already frames it as an intentional user opt-in after dry-run verification, not
  something to silently switch on. Recommendation stands: turn it on.
- **Target ratchet (new, user-proposed): built, evaluated, ACCEPTED with caveats.**
  Idea from the user: don't close at target - lock the stop at the old target and
  push a new target out further, "let winners run" instead of leaving money on the
  table at a fixed target. Implemented as Imp 6 in the backtest engine
  (`targetRatchetExtensionR` / `targetRatchetMaxExtensions`) and mirrored in the live
  broker's sweep (`TARGET_RATCHET_ENABLED`), following the exact pattern trailing stop
  already established: state re-derived from scratch each sweep (no persisted
  counters), composes with trailing stop (the stop only ever ratchets in the trade's
  favor - `Math.max`/`Math.min`), off by default. `scripts/eval-improvements.ts
  FEATURE=ratchet` on SP500 walk-forward (extensionR=1, maxExtensions=3): OOS Sharpe
  +0.02 (rsi-reversion), +0.04 (stoch-reversal), ~0 (bollinger-reversion - its own
  signal exit usually fires before the fixed 10% target price is ever reached, so the
  ratchet rarely gets a chance to trigger for that strategy specifically). Real edge,
  smaller and more strategy-dependent than trailing stop's. Not flipped
  `TARGET_RATCHET_ENABLED=1` for the same reason trailing stop wasn't - live
  trading-behavior change, user's call. Untried in this pass: combining trailing +
  ratchet together, and tuning `extensionR`/`maxExtensions` beyond the 1/3 defaults -
  worth a follow-up sweep before deciding on live parameters.

**Not done this pass** (each is real feature work with trading-behavior judgment
calls, not a mechanical fix - deliberately left for a dedicated phase rather than
rushed):

- **Volatility regime filter:** realized-vol (or ^VIX via Yahoo - free) position
  scaler. Not yet built or evaluated.
- **Regime declarations:** no live strategy declares `Strategy.regime` yet, so
  `checkRegime` stays inert. Needs a per-strategy regime spec + its own walk-forward
  evidence, not a blanket flip.
- **Earnings blackout:** no new entry within N days of a known earnings date. Data
  exists (`fundamentals_cache`); the blackout window N is unvalidated.
- **Resolve the 15m mismatch:** the 3 live strategies are daily-designed but execute
  on 15m bars intraday, never walk-forward-validated at that timeframe. Needs a
  decision backed by a 15m walk-forward run (now that `barsPerYear` annualizes
  correctly - Phase 1) or a move to the daily-only execution path.

Definition of Done: each filter ships with a before/after walk-forward comparison in
the journal or a research note; live config reflects the winning variant. Met for
ADX (rejected, documented) and trailing stop (accepted, documented, opt-in
recommendation stands); not yet met for vol filter / regime / earnings / 15m.

### Phase 4 — Alpha: cross-sectional momentum goes live

Goal: promote the strongest edge in the repo (1.44 OOS Sharpe) from research to a live
paper sleeve, after killing its known biases. Highest expected-value trading change in
this roadmap.

- **Extend history pre-2020** (Yahoo daily data is free back decades) so OOS windows
  cover at least one bear market (2015-2016 draw, 2018 Q4, 2020 crash, 2022 bear).
- **Apply PIT membership** from Phase 1 to the cross-sectional universe at each
  rebalance date.
- **Add the Phase 3 vol filter to the momentum sleeve** (vol-scaled momentum is the
  canonical use case).
- **Wire a "rotation book":** monthly top-N (start N=20, equal weight) rebalance as a
  scheduled paper portfolio with its own budget bucket, separate from the MR book.
  Reuse `cross-sectional.ts` scoring, the existing broker, and Telegram digests
  (rebalance summary: entered/exited names, turnover, sleeve equity). The two sleeves
  are complementary by construction - short-hold mean reversion and 12-month momentum
  are lowly/negatively correlated, which is the cheapest diversification available.
- Portfolio-level guardrails: sleeve budget cap, existing drawdown breaker covers
  combined equity.

Definition of Done: momentum sleeve shows OOS Sharpe > 1 across at least two regimes
including a drawdown period, on PIT + adjusted data; sleeve trades live on paper with
Telegram rebalance digests; combined-account risk checks pass.

### Phase 5 — Strategy bench

Goal: the live roster is chosen by evidence, and every number has a benchmark.

- **Promote the production-tier candidates** through the full pipeline:
  `rsi2-pullback` (Connors RSI-2, the best-documented retail MR pattern),
  `down-streak`, `ema-pullback` / `ma44-support` (trend-pullback pair). These already
  have real stops, targets, and time exits - unlike the current live trio. Any that
  clears walk-forward on corrected data joins the live set; consensus quorum scales
  with roster size.
- **Parameter plateau check:** for each live strategy, perturb each key parameter
  ±20-30% and confirm the OOS result is stable. Not optimization - a cliff next to
  the default means the default is luck. Bin strategies that only work on a knife
  edge.
- **Benchmark everything:** SPY buy-and-hold equity overlay in the backtest engine
  output, the backtest UI, and the compare page. A strategy that underperforms its
  benchmark with more drawdown is binned regardless of its absolute return.
- Revisit the short side only if a validated long edge has an obvious inverse; do not
  force it.

Definition of Done: live roster re-selected from walk-forward evidence on corrected
data; plateau report per live strategy; benchmark column visible in compare and
backtest views.

### Phase 6 — Trader UX

Goal: the trader can see what the system sees, at the timeframe it trades.

- **On-chart indicators:** Bollinger bands + MA overlays on the price chart, RSI and
  volume panes below (lightweight-charts v5 `addSeries`; panes are supported). Toggle
  per live strategy so a signal's trigger condition is visible on the chart.
- **Paper-account equity curve + daily P&L calendar** on `/paper`, computed from
  `paper_trades` history and marks - the live account finally gets the chart every
  backtest already has.
- **15m chart timeframe** on backtest/dossier surfaces, so the executed timeframe is
  inspectable.
- **Auto-polling marks:** SWR polling on `/paper` during market hours (no websocket
  needed at this scale).
- **Navigation and persistence:** DOSSIER in the nav; persist backtest runs
  (params + metrics) to a `backtest_runs` table with a simple history list, enabling
  before/after comparisons that Phases 3-5 keep needing.

Definition of Done: a live signal can be fully explained on-chart at the traded
timeframe; the account equity curve is visible; backtest runs are recallable.

### Phase 7 — Prove the edge (the path to real money)

Goal: replace "it feels like it works" with a numeric go/no-go rule.

- **Live-vs-backtest reconciliation dashboard:** actual fill slippage vs the 5bps
  model, live hit-rate and average R per strategy vs its walk-forward expectation,
  with drift alarms (Telegram) when live degrades beyond a band. The data already
  exists in `paper_trades` + `decision_log`; this is assembly, not new
  infrastructure.
- **Automated monthly report:** per-sleeve and combined equity, drawdown, hit rate,
  PF, slippage, filter-block counts - to Telegram and the journal.
- **Promotion criteria, written down:** real capital is considered only when, e.g.:
  ≥ 60 closed live paper trades per sleeve, ≥ 6 months elapsed, live Sharpe ≥ 0.7x
  the walk-forward OOS Sharpe, max drawdown within 1.25x the modeled max, slippage
  drift < 2x model. Exact numbers to be fixed at the start of this phase and not
  moved afterwards.

Definition of Done: dashboard live, monthly report firing, promotion criteria doc
committed - and the decision to trade real money (or not) reads off a table instead
of a feeling.

---

## Sources

- [teddykoker/survivorship-free-spy](https://github.com/teddykoker/survivorship-free-spy) -
  free survivorship-bias-free S&P 500 dataset approach
- [Survivorship-bias free S&P 500 constituent lists (riazarbi)](https://riazarbi.github.io/quant/backtesting-sp500-constituent-history/) -
  Wikipedia-revision-based point-in-time membership
- [EODHD S&P 500 historical constituents](https://eodhd.com/financial-apis-blog/sp-500-historical-constituents-data) -
  paid option (~$20/mo) incl. delisted-name history
- Volatility-scaled momentum / VIX regime sizing practice:
  [Cracking Markets momentum system research](https://www.crackingmarkets.com/us-stock-momentum-trading-system-for-retail-traders-deep-research/),
  [VIX regime signals](https://intellectia.ai/blog/bear-market-vix-pattern)

---

Research tool. Not financial advice. All results are hypothetical.
