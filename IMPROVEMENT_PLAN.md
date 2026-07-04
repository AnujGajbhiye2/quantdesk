# QuantDesk - Improvement Plan (2026-H2)

Implementation spec for the next round of system improvements. This doc executes and
extends `SYSTEM_AUDIT_AND_ROADMAP.md` Phases 3-7. It is written so an implementing
session (Sonnet) needs zero design decisions - every step names files, functions,
schemas, env vars, tests, and a Definition of Done.

**Status (2026-07-04): WS0 DONE (combined eval accepted, ratchet flipped live on
prod). WS1 DONE (registry env-driven, reconcile generalized, migrate-provider tool
proven via alpaca dry-run; paid adapter deliberately not built until the provider
is chosen). WS2 OPTIONAL/paused (live runs the daily path - see premise update).
WS3 SHELVED (go-live gate failed 0/4 regime windows - see premise update). WS4
DONE (on-chart indicators, USD equity curve + P&L calendar, 15m charts, /paper
auto-polling, backtest run history; DOSSIER nav pre-existed). WS5 DONE (/reconcile
drift + criteria page, monthly Telegram report cron, PROMOTION_CRITERIA.md).
Separately: Turso decommissioned (MIGRATION_OFF_TURSO.md).**

Status snapshot (2026-07-03): live paper book is stable - 12 trades, 6 closed at 100%
win rate, +$221.98 realized, running unattended on the 15m auto-trade path with
Telegram alerts. Roster is the validated trio: `bollinger-reversion`, `rsi-reversion`,
`stoch-reversal`.

User decisions already made (do not re-ask):

1. 15m mismatch -> backfill ~5yr of 15m bars via Alpaca free IEX and walk-forward
   validate; evidence decides whether live stays on 15m or moves to the daily path.
2. Cross-sectional momentum -> build as a live paper "rotation book" sleeve.
3. Paid data provider lands in ~1 month, budget ~$30-50/mo, provider NOT chosen yet.
   Prepare the switch so it is provider-agnostic plug-and-play: when the choice is
   made, the work is one new adapter file from the recipe in 1.4, one registry line,
   an env change, a scripted re-ingest, and a reconcile report - nothing else.
4. Scope includes: flipping trailing stop + target ratchet live (WS0), Phase 6 trader
   UX (WS4), Phase 7 reconciliation/promotion criteria (WS5).

## Ground rules for the implementing session

- Correctness before alpha. Never weaken the no-look-ahead, next-open-fill,
  worse-outcome-intrabar, or adjusted-data invariants.
- Every live-behavior change ships behind an env flag whose default preserves current
  behavior. Flipping a flag on prod is the user's action, not the implementer's.
- Honour every STOP checkpoint below: summarize, show the DoD is met, wait for the
  user. Do not continue past a STOP.
- The user runs tests himself - do not auto-run `npm run test` after every change;
  finish a chunk, then offer the exact commands to verify.
- Record every accept/reject evidence result as a research note (same convention as
  the Phase 3/5 entries in `SYSTEM_AUDIT_AND_ROADMAP.md`).
- Hyphens, not em dashes, in all comments/docs/UI text. TypeScript strict, no `any`
  in core contracts. libSQL embedded-replica rules apply to `core/db/client.ts` code
  (positional params only, no transactions) - but NOT to scripts that open a local
  standalone DB directly (transactions are fine there).
- One workstream per session where possible (session split guidance at the bottom).

Verified facts this plan is built on (do not re-derive):

- `data/quantdesk.db` (local research DB, read directly by eval scripts, bypassing
  Turso): `1d` bars 2015-01-01 -> now for 784 symbols - pre-2020 history including
  2015-16, 2018 Q4, 2020, 2022 already exists. `15m` bars: only ~3 weeks.
- `BARS_PER_YEAR['15m'] = 6552` already exists in `src/core/backtest/metrics.ts`.
- `scripts/eval-walkforward.ts` hardcodes `'1d'`, `barsPerYear: 252`, and the DB path.
- `AlpacaProvider.getHistoryBatch` (`src/core/data/providers/alpaca.ts`) already
  chunks symbols, follows `next_page_token`, requests `adjustment: 'all'`,
  `feed: 'iex'`, and backs off on 429. Free tier: 200 req/min, IEX history ~5 years.
- `paper_trades` has a partial unique index: one active position per symbol, global.
- `sweepOpenTrades` (`src/core/paper/broker.ts`) time-stops ALL open trades after
  `maxHoldBars` (default 21 bars) - the rotation sleeve MUST be excluded from sweep.
- `positionRiskUSD` (`src/core/risk/checks.ts`) charges FULL entry notional for
  stop-less positions - 20 rotation holdings would permanently block every MR entry
  unless `openPositionsUSD` becomes sleeve-filtered.
- `src/core/data/registry.ts` hardcodes `'yahoo'` as fallback;
  `scripts/reconcile-providers.ts` hardcodes Yahoo-vs-Alpaca constructors.
- Index symbols (`^GSPC`, `^NSEI`, ...) are Yahoo notation. Polygon serves indices
  only on a separate paid plan (`I:SPX` notation) and does not serve `^NSEI` at all.
  Mixed-provider DB is already supported (per-symbol `symbols.provider_id`).
- The three live strategies declare no `regime` requirement, so 15m evaluation does
  not need 15m index bars.

---

## WS0 - Flip the accepted features live

Goal: turn on the two exit improvements that already passed walk-forward evaluation,
and close the follow-up the audit doc flagged (combined + tuned variants).

Both were ACCEPTED with evidence (`SYSTEM_AUDIT_AND_ROADMAP.md` Phase 3):
trailing stop +0.06 to +0.09 OOS Sharpe across all 3 strategies; target ratchet
+0.02 to +0.04 (strategy-dependent, near-zero for bollinger-reversion).

Steps:

1. Prod env confirmed 2026-07-03: `TRAILING_STOP_ENABLED=1` is set on prod;
   `TARGET_RATCHET_ENABLED` is NOT set on prod (it is set locally). The open flip
   is `TARGET_RATCHET_ENABLED=1` on prod `.env` - operator action, after the
   combined eval below.
2. Small script addition: `scripts/eval-improvements.ts` currently evaluates
   `FEATURE=trailing` and `FEATURE=ratchet` separately. Add `FEATURE=both` (trailing
   stop AND target ratchet active in the same run) so the combination the live book
   will actually run is what gets measured. Follow the existing FEATURE switch
   pattern in that script.
3. Parameter sweep for the ratchet, as flagged in the audit doc: re-run
   `FEATURE=ratchet` and `FEATURE=both` at `extensionR` in {0.5, 1, 1.5} and
   `maxExtensions` in {2, 3, 5} (env-driven, e.g. `RATCHET_EXTENSION_R`,
   `RATCHET_MAX_EXTENSIONS` - add the envs to the script if not present). Report the
   grid as a table in a research note. Pick the best stable cell (prefer plateau over
   peak - same philosophy as `eval-param-plateau.ts`).
4. Write the before/after note (append a dated section to
   `SYSTEM_AUDIT_AND_ROADMAP.md` or a new note under the journal convention).

Definition of Done: `FEATURE=both` supported; sweep table written; recommended live
params documented; user has flipped (or declined) `TARGET_RATCHET_ENABLED` after
seeing the numbers. STOP here for that user decision.

---

## WS1 - Provider-switch hardening (provider-agnostic)

Goal: switching the primary bar source to ANY paid provider means one new adapter
file (written from the recipe in 1.4), one registry line, an env change, a scripted
re-ingest, and a reconcile report - zero other code changes. Nothing in this
workstream assumes which provider gets chosen.

### 1.1 Config-driven default provider

`src/core/data/registry.ts`:

```ts
const DEFAULT_PROVIDER_ID = process.env.DEFAULT_PROVIDER ?? 'yahoo';
export function defaultProviderId(): string { return DEFAULT_PROVIDER_ID; }
export function getOrDefault(id: string): DataProvider {
  const p = _registry.get(id) ?? _registry.get(DEFAULT_PROVIDER_ID);
  if (!p) throw new Error(`Neither provider '${id}' nor default '${DEFAULT_PROVIDER_ID}' is registered.`);
  return p;
}
```

Plus a seed-time assertion at the bottom of the file: if `DEFAULT_PROVIDER` is set
but not registered after seeding, throw at boot (fail loud, not at first fetch).

Callers to update:

- `src/core/data/intraday-ingest.ts:71` - `: 'yahoo'` fallback -> `defaultProviderId()`.
- `src/core/data/universe.ts` - `autoTradeUniverse()` forces `providerId: 'alpaca'`;
  make it `process.env.INTRADAY_PROVIDER ?? 'alpaca'`.
- `src/components/overlays/GoToSymbolOverlay.tsx:113` - `?? 'yahoo'` fallback: have
  `/api/search` return the resolved providerId (it already knows), drop the fallback.
- `src/core/data/fundamentals-prefetch.ts` - `getProvider('yahoo')` stays
  INTENTIONALLY Yahoo-pinned (fundamentals/news/earnings are a Yahoo capability,
  orthogonal to bar sourcing). Add a comment saying exactly that so a future
  migration session does not "fix" it.

### 1.2 Generalize the reconcile script

`scripts/reconcile-providers.ts`: replace the hardcoded `new YahooProvider()` /
`new AlpacaProvider(...)` with env-selected ids:

```
PROVIDER_A=yahoo PROVIDER_B=<any-adapter-id> SYMBOLS=NVDA,AVGO,... npm run reconcile-providers
```

Implement a `providerFromEnv(id: string): DataProvider` factory inside the script
that constructs each known adapter directly from its env keys (yahoo needs none,
alpaca needs keys; future adapters get one case each) - direct construction, not
the registry, so it works regardless of `*_ENABLED` flags (same rationale as the
existing comment in that script). Defaults stay `yahoo`/`alpaca` so existing
behavior is unchanged. The rest of the script (tolerances, split-break detection,
exit codes) is already provider-agnostic.

### 1.3 Migration tool: `scripts/migrate-provider.ts`

npm script (copy the tsx invocation style of the existing scripts):

```
"migrate-provider": "tsx --conditions=react-server --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/migrate-provider.ts"
```

Usage:

```
npm run migrate-provider -- --universe scripts/universe/sp500.json --to polygon [--timeframes 1d] [--from 2015-01-01] [--sample 12] [--dry-run] [--include-indices]
```

Sequential steps, abort on any failure:

1. Preflight: target provider constructible from env and supports each requested
   timeframe - probe `getHistory('AAPL', tf, <30 days ago>, today)`, require > 0 bars.
2. Reconcile BEFORE switching: run the 1.2 logic old-vs-new on `--sample` symbols
   (default: the split-heavy set from reconcile-providers plus 6 random universe
   names) over `--from`..today. Abort if it fails - never re-point at a diverging
   source.
3. Re-point: for each universe entry,
   `upsertSymbol({ ...entry, providerId: target, providerSymbol: provider.toProviderSymbol(entry.symbol) })`
   via `core/db/bars.ts` (positional-param safe, works in replica and local modes).
   Skip index symbols (`symbol.startsWith('^')`) unless `--include-indices`.
4. Full re-ingest: `ingestUniverse(entries, from)`. Full window on purpose - the
   `bars` table has no provider column, so a partial refresh would silently
   interleave two adjustment bases. Always overwrite the entire series.
5. Post-verify: reconcile the sample again (stored closes vs old provider live
   fetch), print a summary table, exit non-zero on failure.

`--dry-run` prints steps 3-4 counts without writing.

### 1.4 New-adapter recipe (generic - applies to whatever provider gets chosen)

Do NOT build any paid-provider adapter now. When the subscription decision lands,
one session writes one adapter file from this recipe. The recipe is the checklist;
the per-provider notes below it are just starting hints.

Recipe - `src/core/data/providers/<provider>.ts` from `providers/_template.ts`:

1. Implement `id`, `assetClasses`, `toProviderSymbol()`, `getHistory()`. Optional
   but valuable: `getQuote()`, `getHistoryBatch()` (if the provider has a bulk or
   grouped endpoint, the daily refresh drops from ~500 requests to a handful).
2. Non-negotiable invariants (same as the template header):
   - request ADJUSTED prices (split + dividend) - the whole DB is adjusted data;
   - daily bar `time` stored as `YYYY-MM-DD` derived from the bar's ET calendar
     date via `Intl.DateTimeFormat` with `America/New_York` (never a raw UTC slice);
     intraday bars as full ISO strings with `Z`;
   - `validateBars()` (zod) before returning - quarantine, never throw-per-symbol;
   - retries / rate limits / pagination handled INSIDE the adapter (429 backoff
     modeled on Alpaca's `apiFetch`; if the tier has a hard req/min cap, serialize
     through an internal queue with fixed spacing);
   - no DB writes, no business logic - translate to `Bar`/`SymbolMeta` only.
3. `toProviderSymbol` must throw an informative error for any symbol notation the
   provider cannot serve (e.g. `^`-prefixed indices) - never silently return a
   guess. Index symbols stay on Yahoo regardless (1.5).
4. Register in `registry.ts` behind its API-key env (one line, same pattern as
   alpaca). Add the key to `.env.local.example`.
5. Tests `providers/<provider>.test.ts` with mocked fetch, mirroring
   `yahoo.test.ts` / `alpaca.test.ts`: timeframe map, timestamp -> daily-date
   conversion, pagination loop, rate-limit/429 behavior, unsupported-symbol throw,
   zod validation of output.
6. Cutover uses only WS1 tooling, in this order: `reconcile-providers` (new vs
   yahoo, sample symbols) -> `migrate-provider --dry-run` -> `migrate-provider`
   (re-point + full re-ingest) -> post-verify reconcile. No other code changes.

Per-provider starting hints (one line each, verify against current docs at build
time - do not trust these blindly):

- **Polygon** (~$29/mo Starter: unlimited calls, 5yr history, 15-min delayed,
  corporate actions, flat files): aggregates endpoint with `adjusted=true`,
  `next_url` pagination (re-append apiKey), epoch-ms timestamps; grouped-daily
  endpoint = whole market in 1 request/day for `getHistoryBatch`.
- **Tiingo** (~$10/mo): EOD endpoint returns `adjOpen/adjHigh/adjLow/adjClose` -
  map those, not the raw fields; 30yr history; IEX intraday endpoint separate.
- **EODHD** (~EUR 20/mo): EOD endpoint has `adjusted_close` only - scale OHLC by
  `adjusted_close/close` per bar (same technique as the Yahoo adapter); bulk
  endpoint for batch; also sells delisted history + PIT constituents.
- **Alpaca paid data** (~$99/mo Algo Trader Plus): adapter already exists - cutover
  is env only (`feed: 'sip'` instead of `'iex'` plus `INTRADAY_PROVIDER`/
  `DEFAULT_PROVIDER`), no new file at all.

### 1.5 Index-symbol policy (document, do not "solve")

`^GSPC`, `^NSEI`, `^IXIC`, `^DJI` (in `scripts/universe/reference.json`) are used by
regime gates, the `/api/backtest` + `/api/compare` benchmark field, and
`eval-walkforward.ts`. Policy: index/reference symbols stay on Yahoo permanently -
provider migration applies to tradeable equities only. Encode this in the migration
tool (1.3 step 3) and add a short README note in `src/core/data/providers/`
(canonical symbols are Yahoo notation; adapters translate via `toProviderSymbol`;
documented fallback if Yahoo ever dies: switch benchmark/regime index to SPY, a
one-line change in `reference.json` plus strategy `regime.index`).

### 1.6 Env documentation

`.env.local.example`: add `DEFAULT_PROVIDER` (default yahoo) and `INTRADAY_PROVIDER`
(default alpaca) with one-line comments. Provider API-key envs get added when the
chosen adapter lands (recipe step 4), not now.

### Provider decision table (for the user, ~1 month out - no decision needed today)

| Provider | Cost | What it unlocks | Work at cutover |
|---|---|---|---|
| Polygon Starter | ~$29/mo | Full-market aggregates, 5yr history, unlimited calls, 15-min delayed, corporate actions | 1 adapter file (recipe 1.4) |
| Tiingo | ~$10/mo | Clean EOD, 30yr history, good fundamentals | 1 adapter file (recipe 1.4) |
| EODHD | ~EUR 20/mo | Delisted names + historical index constituents - fully kills survivorship bias | 1 adapter file (recipe 1.4) |
| Alpaca Algo Trader Plus | ~$99/mo | Realtime SIP data inside the broker already executing the fills | Env change only - adapter exists |

Worth weighing at decision time: Alpaca is the only option that is also a broker.
If "paying for a service that can also place real trades" matters, Alpaca is the
one-vendor path (data + paper fills today, live brokerage exists when/if the
Phase 7 promotion criteria are ever met - real-money routing itself stays out of
scope). Pure data vendors (Polygon/Tiingo/EODHD) buy better history per dollar but
place no trades. EODHD is the pick if WS2/WS3 results make survivorship-complete
daily data the priority.

Definition of Done (WS1): `npm run build` passes; registry + reconcile tests pass;
`migrate-provider --dry-run --to alpaca` runs clean end-to-end against the existing
Alpaca adapter (proves the whole cutover pipeline with zero new code and no paid
key); env docs updated. No paid-provider adapter is built in this workstream.

---

## WS2 - 15m backfill + walk-forward validation of the live trio

**Premise update (2026-07-03, verified against prod env during the Turso
migration):** live execution is ALREADY on daily bars - prod has
`AUTO_TRADE_TIMEFRAME=1d`, `DAILY_AUTO_TRADE_ENABLED=1`, and the 15m intraday
cron never starts (`ALPACA_ENABLED` unset; prod log: "Alpaca disabled ...
Intraday auto-trade cron not started"). The roadmap's "live trades unvalidated
15m bars" mismatch does not currently exist. WS2 is therefore OPTIONAL research -
do it only if the user wants to evaluate moving execution to 15m; it is no longer
a correctness blocker and drops below WS3 in priority. The design below stands
as written for when/if that happens. (15m bars in the DB stop at 2026-06-25 -
when the intraday cron was disabled - so the ~3-week sample is stale as well.)

Goal (if pursued): backfill ~5 years of 15m history (free, Alpaca IEX) and run
the same walk-forward harness the daily numbers came from. Evidence then decides
whether 15m execution would beat the validated daily path.

### 2.1 Where the data lives - decided

A LOCAL standalone research DB at `data/research-15m.db`. NOT the shared Turso DB:

- Expect 10-15M rows (~515 symbols x 5yr x ~26 RTH bars/day, minus IEX gaps). In
  embedded-replica mode every `upsertBars` row is a network write to the Turso
  primary - days of wall clock and a blown write quota, for data the live system
  never reads (live intraday needs only ~21 days of 15m bars, already rolling).
- Every eval script already reads a local file directly - this is the established
  research pattern.
- The script opens libsql directly (like the eval scripts do), NOT through
  `core/db/client.ts` - plain local-file mode, so real `BEGIN`/`COMMIT` transactions
  are allowed and fast.

The research 15m DB is rebuild-from-scratch only. Never refresh it incrementally -
Alpaca's `adjustment: 'all'` is as-of fetch date, and a later incremental top-up
after a split would silently mix adjustment bases. Document this in the script
header.

### 2.2 New script: `scripts/backfill-15m.ts`

npm script:

```
"backfill-15m": "tsx --conditions=react-server --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/backfill-15m.ts"
```

Env / flags: `RESEARCH_DB_PATH` (default `data/research-15m.db`), `FROM` (default 5
years back), `TO` (default today), `SYMBOLS_FILE` (default
`scripts/universe/sp500.json` - the FULL universe; a subset would not validate the
live consensus scan), `THROTTLE_MS` (default 350), `--resume`.
Requires `ALPACA_KEY_ID` / `ALPACA_SECRET_KEY`.

Shape:

```ts
function monthWindows(from: string, to: string): { from: string; to: string }[]  // pure, unit-tested
async function backfillMonth(provider: AlpacaProvider, symbols: string[], win: { from: string; to: string }, db: Database): Promise<{ bars: number; requests: number }>
function writeBars(db: Database, rows: BarRow[]): void  // BEGIN; batched INSERT ... ON CONFLICT DO UPDATE; COMMIT
async function main(): Promise<void>
```

Mechanics (decided - implement as written):

- Chunk by calendar month. One `getHistoryBatch(all symbols, '15m', month)` call is
  ~280k bars / ~28 pages - fetch, write, release memory. Never issue one giant
  5-year call (it would page ~1,600 times while accumulating everything in memory).
- ~60 months = ~1,700 requests total. Free tier is 200 req/min; `apiFetch` already
  backs off on 429, add the proactive `THROTTLE_MS` sleep between pages anyway
  (350ms = ~170 req/min). Expected runtime 30-60 min.
- Create only the `bars` table in the research DB (same DDL as
  `src/core/db/schema.sql`, PK `(symbol, timeframe, time)`).
- Store exactly what Alpaca returns - do NOT filter to regular trading hours at
  write time (live `ingestIntraday` stores unfiltered too; RTH filtering happens at
  eval time, 2.3).
- `--resume`: `SELECT MAX(time) FROM bars WHERE timeframe='15m'` and skip complete
  months.
- Final summary: per-symbol bar counts (coverage report) - IEX is ~2-3% of
  consolidated volume and thin names will have holes; the eval's MIN_BARS gate
  handles them, but coverage must be visible in the output.

Tests (`scripts/backfill-15m.test.ts`): `monthWindows` boundaries (partial first and
last month, from == to), `writeBars` conflict idempotency against a temp DB, resume
skip logic.

### 2.3 Generalize `scripts/eval-walkforward.ts` (do not fork it)

- `const TIMEFRAME = (process.env.TIMEFRAME ?? '1d') as Timeframe;` - replaces the
  `'1d'` literals in both SQL queries.
- `const DB_PATH = process.env.DB_PATH ?? join(process.cwd(), 'data/quantdesk.db');`
- `barsPerYear: BARS_PER_YEAR[TIMEFRAME]` (import from `@/core/backtest/metrics`) -
  replaces the hardcoded 252.
- `MIN_BARS` env: keep default 200 for 1d; document `MIN_BARS=5000` for 15m runs.
- `STRATEGIES=live` env: restrict to the live trio (graveyard strategies do not need
  500-symbol 15m runs).
- RTH filter: new pure helper in `src/core/market/hours.ts`:

```ts
export function isRthBar(timeISO: string): boolean
// true iff 09:30 <= t < 16:00 America/New_York, via Intl.DateTimeFormat - no dependency
```

  Applied after load when `TIMEFRAME !== '1d'`:
  `bars = bars.filter(b => isRthBar(b.time))`. This keeps `barsPerYear = 6552`
  honest and drops extended-hours IEX bars that live entries can never act on (the
  auto-trade cron only fires 09:00-16:00 ET). Half-day early closes are accepted
  noise - note it, do not build half-day RTH logic.
- npm aliases: add `"eval-walkforward": "tsx --conditions=react-server scripts/eval-walkforward.ts"`
  (it has no alias today) and
  `"eval-walkforward-15m": "TIMEFRAME=15m DB_PATH=data/research-15m.db MIN_BARS=5000 STRATEGIES=live UNIVERSE=sp500 npm run eval-walkforward"`.

Costs: run BOTH the daily baseline and the 15m run with the identical existing cost
defaults (10bps round-trip commission, 5bps slippage). Intraday mean reversion turns
over faster so costs bite harder - that is signal, not a knob to tune down.

`maxHoldBars` stays in bars (engine convention): live 15m execution holds up to 21
fifteen-minute bars unless overridden - validate exactly that. If the eval shows the
intent should be "21 trading days", that is a live-config decision to surface at the
STOP, not something to change silently.

Tests: `hours.test.ts` additions for `isRthBar` (DST boundaries - a 14:30Z bar is
RTH in summer, pre-market in winter), smoke assertion `BARS_PER_YEAR['15m'] === 6552`.

### 2.4 Acceptance bar - fixed BEFORE running, do not move it afterwards

Per strategy, 15m execution stays live only if ALL of:

1. 15m OOS aggregate Sharpe >= 0.7x that strategy's daily OOS Sharpe on the same
   corrected data (daily baselines: bollinger 0.42, rsi 0.39, stoch 0.39 ->
   thresholds ~0.29 / 0.27 / 0.27);
2. >= 15 OOS trades (the project's own minimum-sample gate);
3. `profitableWindowFrac >= 0.5` (at least 2 of 3 OOS windows positive).

Outcomes:

- A strategy fails -> demote it from the intraday consensus (it stays in the daily
  book where it was validated).
- 2+ of 3 fail -> recommend flipping live execution to the daily path
  (`DAILY_AUTO_TRADE_ENABLED=1`, `AUTO_TRADE_ENABLED=0`) - the roadmap's existing
  Phase 3 recommendation.

STOP: present the 15m vs daily walk-forward table and the resulting roster
recommendation. Any live-path change is the user's call.

Definition of Done (WS2): backfill complete with a coverage report; 15m and daily
walk-forward reports produced from the same harness; acceptance-bar verdict per
strategy recorded as a research note; STOP honored before any live change.

---

## WS3 - Momentum rotation book (live paper sleeve)

**Premise update (2026-07-03): the go-live gate (3.7) was run FIRST and FAILED -
0/4 regime windows over Sharpe 1 with PIT active (0.63 / 0.44 / 0.17 / 0.99 for
2016-19 / 2020-21 / 2022 / 2023-26). The prior "1.15 OOS Sharpe" was a
TRAIN_FRAC-split artifact (all OOS windows in the 2023-26 bull). Variants
(TOP_N=10/50, bimonthly rebalance) do not clear the bar. Per the gate rule the
sleeve must NOT trade live. Open user decision: (a) build it dry-run-only as
designed below, (b) shelve WS3 and proceed to WS4/WS5, or (c) research
vol-scaled momentum variants first. Evidence in SYSTEM_AUDIT_AND_ROADMAP.md
Phase 4 status update. Note for any future live enablement: prod must run
`npm run build-pit-membership` (its DB lacked the table - discovered here).**

Goal (as originally scoped): promote cross-sectional 12-1 momentum from research
to a live paper sleeve: monthly top-20 equal-weight rebalance, its own budget
bucket, Telegram digests. Complementary by construction to the short-hold
mean-reversion book.

Cross-cutting safety property: every change in this workstream defaults to sleeve
`'mr'`, so existing live behavior is bit-identical until the first rotation trade
exists. The test list asserts exactly that.

### 3.1 Schema + types

New idempotent migration in `src/core/db/client.ts`, called from `migrate()` after
`migratePaperTradesMarket` (same pattern):

```ts
function migratePaperTradesSleeve(db: Database): void {
  // pragma table_info check, then:
  // ALTER TABLE paper_trades ADD COLUMN sleeve TEXT NOT NULL DEFAULT 'mr'
  // CREATE INDEX IF NOT EXISTS idx_paper_trades_sleeve ON paper_trades(sleeve, status)
}
```

- `src/core/types.ts`: `export type Sleeve = 'mr' | 'rotation';` and
  `sleeve?: Sleeve` on `PaperTrade`.
- `src/core/db/paper.ts`: include `sleeve` in `insertPaperTrade` (positional params -
  count carefully), row mapping, and a `sleeve?: Sleeve` filter in `getPaperTrades`
  options.
- The global one-active-position-per-symbol unique index stays UNCHANGED. Policy
  when a top-20 momentum name is already held by the MR book: the rotation book
  substitutes the next-ranked name (rank 21, 22, ...) and records `substitutedFor`
  in the digest. This avoids touching the broker's duplicate invariant and avoids
  doubled single-name exposure; top-N momentum is robust to a rank-21 substitution.

### 3.2 Sleeve accounting

`src/core/paper/account.ts`:

```ts
export interface SleeveAccount { budgetUSD: number; realized: number; cashUsed: number; cash: number; openNames: number; }
export function computeSleeveAccount(sleeve: Sleeve): SleeveAccount | null
```

`budgetUSD = ROTATION_BOOK_BUDGET_FRACTION (default 0.4) x account starting balance`;
realized/cashUsed computed exactly like `computeCashAccount` but over
`getPaperTrades({ sleeve })`. The MR book keeps sizing off full equity (v1,
unchanged) - the broker's global insufficient-funds error remains the backstop for
cash contention between books. Known, accepted paper-only quirk: the MR book can
spend into the rotation sleeve's unspent budget between rebalances; the digest
prints "sleeve cash reserved: $X" to keep it visible.

### 3.3 Risk integration - two changes are MANDATORY, not optional

1. `src/core/risk/exposure.ts`:
   `openPositionsUSD(candidateBars?, opts?: { sleeve?: Sleeve })` - filter open
   trades to the candidate's sleeve. Without this, 20 stop-less rotation positions
   charge FULL notional into the `total-open-risk` check and permanently block every
   MR entry, and they instantly bust `maxOpenTrades=16`. All existing MR call sites
   in `broker.ts` pass `{ sleeve: 'mr' }`.
2. `src/core/risk/checks.ts` - new rotation-specific check; `checkRisk` itself stays
   untouched for MR:

```ts
export interface RotationRiskLimits { maxNames: number; maxPositionPctOfSleeve: number; haltDrawdownPct: number; }
// defaults: 20 / 10 / same 12% halt
export function checkRotationRisk(
  account: AccountStateUSD,   // combined equity - the drawdown halt stays account-wide
  sleeve: { budgetUSD: number; cashUsedUSD: number; openNames: number },
  candidate: { symbol: string; costUSD: number },
  limits: RotationRiskLimits,
): RiskCheckResult
```

   Rules, in order: (a) combined-account drawdown halt, identical formula to
   `checkRisk` rule 1 - the existing breaker covers both sleeves; (b)
   `cashUsedUSD + costUSD <= budgetUSD`; (c) `openNames + 1 <= maxNames`; (d)
   `costUSD <= maxPositionPctOfSleeve% x budgetUSD` (equal weight is ~5%, 10% is a
   loose sanity cap). Concentration / correlation-cluster / per-market caps
   deliberately do NOT apply - top-20 equal weight IS the risk model for this
   sleeve; say so in a comment.

3. `src/core/paper/broker.ts`: `OpenTradeInput` gains `sleeve?: Sleeve` (default
   `'mr'`). In `openPaperTrade`: `sleeve === 'rotation'` -> `checkRotationRisk`
   path (manual kill-switch halt still applies); else the existing `checkRisk` path
   with `openPositionsUSD(bars, { sleeve: 'mr' })`.
4. `sweepOpenTrades` MUST exclude the rotation sleeve: the open-trades query becomes
   `getPaperTrades({ status: 'open', sleeve: 'mr' })`. Otherwise the 21-bar time
   stop force-closes every rotation holding after ~1 month and trailing/ratchet
   logic acts on positions that have no stop/target by design. Rotation exits happen
   ONLY at rebalance. `markOpenTrades` stays all-sleeves - equity and drawdown must
   see rotation positions.
5. Audit pass during implementation: every other code path that iterates open trades
   (`monitor.ts` proximity alerts, perf pages, journal) must tolerate stop-less,
   target-less trades - most likely a no-op skip, but verify each.

### 3.4 New module: `src/core/paper/rotation-book.ts`

```ts
export interface RotationBookConfig { enabled: boolean; dryRun: boolean; topN: number; lookbackBars: number; skipBars: number; budgetFraction: number; }
export function rotationBookConfigFromEnv(): RotationBookConfig
// ROTATION_BOOK_ENABLED (default off) | ROTATION_BOOK_DRY_RUN (default 1)
// ROTATION_BOOK_TOP_N=20 | ROTATION_BOOK_LOOKBACK=252 | ROTATION_BOOK_SKIP=21
// ROTATION_BOOK_BUDGET_FRACTION=0.4

export interface RotationTarget { symbol: string; score: number; substitutedFor?: string; }
export function computeTargetPortfolio(asOfDate: string, cfg: RotationBookConfig): RotationTarget[]
export function diffHoldings(current: PaperTrade[], target: RotationTarget[]): { toClose: PaperTrade[]; toOpen: RotationTarget[]; kept: string[]; }
export interface RotationBookSummary { rebalanceDate: string; entered: string[]; exited: string[]; kept: string[]; skips: Array<{ symbol: string; reason: string }>; turnoverPct: number; sleeveEquityUSD: number; dryRun: boolean; }
export async function runRotationBook(): Promise<RotationBookSummary>  // acquireLock('rotation-book') / finally release
```

Decided details:

- Scoring reuses `momentumScore(bars, bars.length - 1, lookback, skip)` from
  `src/core/backtest/momentum.ts` over `getRecentBars(sym, '1d', 320)` (252 + 21 +
  buffer) for each symbol in `universeForMarket('sp500')`.
- PIT filter: new reader `getMembershipChanges(indexName)` in a new
  `src/core/db/membership.ts` (SELECT mirroring the one in
  `scripts/eval-cross-sectional.ts`), then `membershipAsOf(...)` from
  `core/data/pit-membership.ts`. Near-a-no-op for a live rebalance, but keeps live
  and backtest code paths identical.
- Substitution: walk the ranked list top-down; skip symbols with an active MR trade
  (`getActivePaperTradeBySymbol`), take the next rank, record `substitutedFor`.
- Execution order: close `toClose` first (frees sleeve cash) via
  `closePaperTrade(id, { exitPrice: getLatestClose(sym, '1d'), exitTime, exitReason: 'rotation' })`;
  then `perNameUSD = sleeveEquity / topN` (sleeve cash + marked value of kept
  holdings); open `toOpen` via `openPaperTrade` with `strategyId: 'xs-momentum'`,
  `sleeve: 'rotation'`, `market: 'sp500'`, long, entry = latest daily close, NO
  stop/target, `journalWhy: { score, rank, rebalanceDate }`.
- Kept names untouched (incremental turnover - same mechanics as
  `cross-sectional.ts`, ~70-80% monthly persistence keeps costs realistic).
- Dry-run mirrors `DAILY_AUTO_TRADE_DRY_RUN`: full computation + digest, zero DB
  writes.

### 3.5 Scheduling

- `src/core/market/hours.ts`: `export function isFirstTradingDayOfMonth(dateET: string): boolean` -
  true iff `dateET` is a trading day and no earlier trading day exists in its month
  (uses the existing holiday calendar).
- `src/instrumentation.node.ts`: new cron block after the US scan block, expression
  env `ROTATION_BOOK_CRON` default `'30 21 1-9 * 1-5'` (Europe/Dublin - 21:30, after
  the 21:05 EOD refresh has landed fresh daily bars; days 1-9 always contain the
  first trading day). Tick body: compute today in ET, return silently unless
  `isFirstTradingDayOfMonth`, else `runRotationBook()`. Gated on
  `ROTATION_BOOK_ENABLED === '1'`, honors `LOCAL_DEV_MODE` like every other cron in
  that file.

### 3.6 Telegram

`src/core/notify/format.ts`:

```ts
export interface RebalanceDigestInput { rebalanceDate: string; entered: Array<{ symbol: string; score: number }>; exited: Array<{ symbol: string; pnlPct?: number }>; keptCount: number; turnoverPct: number; sleeveEquityUSD: number; sleevePnlPct: number; substitutions: Array<{ wanted: string; got: string }>; dryRun: boolean; }
export function buildRebalanceDigest(i: RebalanceDigestInput): string
```

Same HTML style as `buildScanDigest`; sent from `runRotationBook` via
`sendTelegram(msg, { parseMode: 'HTML' })`. Add a one-line rotation-sleeve summary
(equity + open names) to the daily heartbeat in `heartbeat.ts`.

### 3.7 Go-live gate - run BEFORE enabling the cron

Daily history already covers 2015 -> now (verified), so no ingest work. Extend
`scripts/eval-cross-sectional.ts`:

- New env `WINDOWS_SPEC="2016-01-01:2019-12-31,2020-01-01:2021-12-31,2022-01-01:2022-12-31,2023-01-01:2026-07-01"` -
  when set, skip the TRAIN_FRAC split and run `runCrossSectional` per window via its
  `activeFrom`/`activeTo` (bars load in full, so lookback warmup before `activeFrom`
  is automatic).
- Gate (the roadmap Phase 4 DoD, verbatim): OOS Sharpe > 1 in >= 2 windows, at least
  one being a drawdown window (2020 or 2022), with PIT active (`PIT` unset). Fail ->
  the rotation book ships dry-run-only and the failure goes in the journal.
- Then: at least 1 full rebalance observed in `ROTATION_BOOK_DRY_RUN=1` via Telegram
  before the user flips to live paper.

Known live-vs-backtest basis to note in the research note (and later in WS5): live
rebalance fills at same-day close + slippage; the backtest fills next-open.

### 3.8 Tests (all new or extended)

- `rotation-book.test.ts`: `diffHoldings` (enter/exit/keep/substitution),
  equal-weight sizing math, dry-run writes nothing.
- `risk/checks.test.ts`: `checkRotationRisk` budget / name-cap / drawdown cases.
- `paper/account.test.ts`: `computeSleeveAccount` filtering.
- `paper/broker.test.ts`: sweep excludes rotation sleeve; rotation open respects
  manual halt but bypasses per-market cap; MR open ignores rotation positions in
  total-open-risk; and the bit-identical assertion - with zero rotation trades, all
  existing broker tests still pass unchanged.
- `market/hours.test.ts`: `isFirstTradingDayOfMonth` (Jan 1 holiday shift, month
  starting on a weekend).
- `notify/format.test.ts`: digest snapshot.

Definition of Done (WS3): gate eval report written; migration + all tests above
pass; `npm run build` passes; one dry-run rebalance observed on Telegram. STOP
before flipping `ROTATION_BOOK_DRY_RUN=0` - user's call.

---

## WS4 - Trader UX (roadmap Phase 6)

Goal: the trader can see what the system sees, at the timeframe it trades. Ordered
by how much each gap hurts; implement in this order.

1. **On-chart indicators** (`src/components/charts/PriceChart.tsx` + wherever chart
   config lives): Bollinger bands + MA overlays on the price chart; RSI and volume
   panes below. lightweight-charts v5 only - `addSeries(LineSeries, ...)` etc.
   (unified API; `addCandlestickSeries` is removed), panes are supported in v5,
   init client-side inside `useEffect`, markers via `createSeriesMarkers`. Add a
   per-live-strategy toggle that shows exactly the indicator set that strategy
   triggers on (bollinger -> bands; rsi -> RSI pane; stoch -> stochastic pane), so a
   signal's trigger condition is visible on the chart that shows the trade markers.
2. **Paper-account equity curve + daily P&L calendar** on `/paper`: computed from
   `paper_trades` history + current marks. Once WS3 lands, split by sleeve (combined
   + per-sleeve toggle). This is the live account finally getting the chart every
   backtest already has.
3. **15m chart timeframe** on the backtest/dossier chart surfaces (data already in
   the DB for the auto-trade universe).
4. **Auto-polling marks**: SWR polling on `/paper` during market hours (no websocket
   at this scale). Respect `isUsMarketOpen()` to avoid pointless polling.
5. **Navigation + persistence**: DOSSIER in the nav; new `backtest_runs` table
   (id, created_at, strategy_id, symbol/universe, params JSON, metrics JSON) with an
   idempotent migration in `client.ts`, write-on-run in `/api/backtest`, and a
   simple history list UI for recalling before/after comparisons (WS0/WS2/WS3 keep
   needing these).

Definition of Done: a live signal can be fully explained on-chart at the traded
timeframe; the account equity curve is visible; backtest runs are recallable.
Keep the UI dense, dark, monospace, keyboard-driven; keep the hypothetical-results
disclaimer visible.

---

## WS5 - Prove the edge (roadmap Phase 7)

Goal: replace "it feels like it works" with a numeric go/no-go rule. Data already
exists in `paper_trades` + `decision_log` - this is assembly, not new
infrastructure.

1. **Live-vs-backtest reconciliation page** (new panel/page + API route):
   - actual fill slippage vs the 5bps model (per trade, aggregated per strategy);
   - live hit-rate and average R per strategy vs its walk-forward OOS expectation;
   - drift alarms to Telegram when live degrades beyond a band (band values in env,
     e.g. hit-rate more than 15pp below WF expectation over the last 20 closed
     trades, or median slippage > 2x model over the same window);
   - note the known rotation-book basis (same-day close vs next-open) so it is not
     read as drift.
2. **Automated monthly report** (cron in `instrumentation.node.ts`, first calendar
   day, reusing the heartbeat/telegram plumbing): per-sleeve and combined equity,
   max drawdown, hit rate, profit factor, realized slippage, filter-block counts
   (from decision_log skip reasons). Send to Telegram and append to the journal.
3. **`PROMOTION_CRITERIA.md`** (repo root): real capital is considered only when ALL
   of - >= 60 closed live paper trades per sleeve; >= 6 months elapsed; live Sharpe
   >= 0.7x the walk-forward OOS Sharpe; live max drawdown within 1.25x modeled;
   slippage drift < 2x model. Numbers are fixed when the file is committed and are
   not moved afterwards. The reconciliation page shows each criterion as a
   pass/fail row.

Definition of Done: dashboard live, monthly report firing, criteria doc committed -
the real-money decision reads off a table, not a feeling.

---

## Global ordering and session splits

| Session | Workstream | Why this order |
|---|---|---|
| A | WS1 (registry/env, reconcile, migrate tool - no paid adapter yet) | Touches files WS2/WS3 also touch - land first to avoid rebases |
| B | WS2 (backfill -> eval -> roster STOP) | Independent of WS3; has a user STOP on the roster decision |
| C | WS3 (schema -> risk -> accounting -> module -> cron/digest -> gate eval -> dry-run STOP) | Largest; gate eval can run in parallel with the module build |
| any | WS0 (env flips + eval-improvements additions) | Small; operator action plus one script change |
| D | WS4 (UX) | After WS3 schema lands (sleeve-aware equity curve) |
| E | WS5 (reconciliation + report + criteria) | Needs WS3 sleeves and benefits from WS2's validated expectations |

Every session ends with: `npm run build`, the workstream's test list, and a
checkpoint message to the user - offer the verify commands, do not auto-run the full
test suite.

STOP checkpoints (wait for the user):

1. WS0 - flipping `TARGET_RATCHET_ENABLED` (and confirming trailing) on prod.
2. WS2 - roster decision after the 15m vs daily walk-forward table.
3. WS3 - flipping the rotation book from dry-run to live paper.

---

## Sources

- [Alpaca market data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq) -
  IEX historical data ~5 years, free for all accounts
- [Alpaca data plans](https://alpaca.markets/data) - free IEX vs paid SIP tiers
- [Financial data API comparison 2026](https://www.nb-data.com/p/best-financial-data-apis-in-2026) -
  pricing ballpark: Tiingo ~$10/mo, EODHD ~EUR 20/mo, Polygon Starter ~$29/mo
- [EODHD historical S&P 500 constituents](https://eodhd.com/financial-apis-blog/sp-500-historical-constituents-data) -
  the survivorship-complete upgrade path (delisted names + PIT membership)
- `SYSTEM_AUDIT_AND_ROADMAP.md` - the audit this plan executes; all accept/reject
  evidence cited above lives there

---

Research tool. Not financial advice. All results are hypothetical.
