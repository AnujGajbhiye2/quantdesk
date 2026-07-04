CREATE TABLE IF NOT EXISTS symbols (
  symbol        TEXT PRIMARY KEY,
  provider_symbol TEXT NOT NULL,
  name          TEXT NOT NULL,
  asset_class   TEXT NOT NULL,
  currency      TEXT NOT NULL,
  exchange      TEXT,
  provider_id   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bars (
  symbol    TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  time      TEXT NOT NULL,
  open      REAL NOT NULL,
  high      REAL NOT NULL,
  low       REAL NOT NULL,
  close     REAL NOT NULL,
  volume    REAL NOT NULL,
  PRIMARY KEY (symbol, timeframe, time)
);
CREATE INDEX IF NOT EXISTS idx_bars ON bars (symbol, timeframe, time);

CREATE TABLE IF NOT EXISTS strategies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  config_json TEXT NOT NULL,
  source_path TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_trades (
  id           TEXT PRIMARY KEY,
  strategy_id  TEXT NOT NULL,
  symbol       TEXT NOT NULL,
  side         TEXT NOT NULL CHECK (side IN ('long', 'short')),
  qty          REAL NOT NULL,
  entry_time   TEXT NOT NULL,
  entry_price  REAL NOT NULL,
  exit_time    TEXT,
  exit_price   REAL,
  stop_price   REAL,
  target_price REAL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'pending')),
  pnl          REAL,
  pnl_pct      REAL,
  costs        REAL NOT NULL DEFAULT 0,
  notes        TEXT
);

-- Enforces "one active (open or pending) position per symbol" at the DB
-- level. The app already checks this via getActivePaperTradeBySymbol()
-- before inserting, but that check-then-insert is not atomic - two
-- overlapping cron ticks (see core/db/lock.ts for the mitigation on the
-- cron side) could both pass the check before either inserts. This index
-- makes the invariant unconditional rather than best-effort
-- (SYSTEM_AUDIT_AND_ROADMAP.md finding, Phase 2).
CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_trades_one_active_per_symbol
  ON paper_trades (symbol) WHERE status IN ('open', 'pending');

CREATE TABLE IF NOT EXISTS signals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol      TEXT NOT NULL,
  time        TEXT NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('long', 'short', 'flat')),
  strength    REAL,
  reason      TEXT NOT NULL,
  strategy_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
  symbol    TEXT PRIMARY KEY,
  pinned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS strategy_edge (
  strategy_id          TEXT NOT NULL,
  scope                TEXT NOT NULL,
  symbol               TEXT,
  asset_class          TEXT,
  win_rate             REAL NOT NULL,
  avg_win_pct          REAL NOT NULL,
  avg_loss_pct         REAL NOT NULL,
  profit_factor        REAL NOT NULL,
  num_trades           INTEGER NOT NULL,
  median_win_hold_bars REAL NOT NULL,
  tested_from          TEXT NOT NULL,
  tested_to            TEXT NOT NULL,
  computed_at          TEXT NOT NULL,
  PRIMARY KEY (strategy_id, scope)
);

-- Alert dedupe log for the stop/target proximity monitor (core/notify/monitor.ts).
-- One row per (trade, level) remembers the last alert state so a hovering
-- price does not spam Telegram every cron tick.
CREATE TABLE IF NOT EXISTS alert_log (
  trade_id TEXT NOT NULL,
  level    TEXT NOT NULL CHECK (level IN ('stop', 'target')),
  state    TEXT NOT NULL CHECK (state IN ('near', 'hit')),
  sent_at  TEXT NOT NULL,
  PRIMARY KEY (trade_id, level)
);

-- Paper trading budget (single row). Balance is always DERIVED from
-- starting_balance + the paper_trades table - never stored, so it cannot drift.
CREATE TABLE IF NOT EXISTS account (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  starting_balance REAL NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- Dossier caches: provider fundamentals and news, stored as JSON payloads
-- with a fetched_at TTL so the dossier never hammers the provider.
CREATE TABLE IF NOT EXISTS fundamentals_cache (
  symbol     TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS news_cache (
  symbol     TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

-- Trade journal: WHY snapshot at open, outcome reflection at close.
-- One row per paper trade. Payloads are JSON (display-only, never re-parsed
-- into trading logic).
CREATE TABLE IF NOT EXISTS journal (
  trade_id  TEXT PRIMARY KEY,
  opened_at TEXT NOT NULL,
  why       TEXT NOT NULL,
  closed_at TEXT,
  outcome   TEXT
);

-- Key-value flag store for operational state (halt switch, Telegram cursor,
-- heartbeat sequence). Persists across process restarts, applied idempotently
-- at startup by the existing schema execution in db/client.ts.
CREATE TABLE IF NOT EXISTS app_flags (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per EOD data ingestion run (refreshUniverse call).
-- Only error details are stored per-symbol (successful symbols are counted only).
-- Keeps last 30 runs via pruneOldIngestRuns() in ingest-log.ts.
CREATE TABLE IF NOT EXISTS ingest_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at     TEXT    NOT NULL,
  finished_at    TEXT    NOT NULL,
  trigger        TEXT    NOT NULL,    -- 'eod-cron' | 'manual' | 'api'
  total_symbols  INTEGER NOT NULL,
  total_bars     INTEGER NOT NULL,
  error_count    INTEGER NOT NULL DEFAULT 0,
  errors_json    TEXT    NOT NULL DEFAULT '[]',  -- JSON: [{symbol, error}]
  duration_ms    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ingest_runs_started ON ingest_runs(started_at DESC);

-- One row per logged EOD scan run. Written by post-refresh when logRun is set.
-- Used by /dashboard/session to show last-run metadata and detect stale runs (>26h).
CREATE TABLE IF NOT EXISTS scan_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        TEXT    NOT NULL,
  finished_at       TEXT    NOT NULL,
  timeframe         TEXT    NOT NULL,
  trigger           TEXT    NOT NULL,    -- 'eod-cron' | 'manual' | 'api'
  symbols_scanned   INTEGER NOT NULL,
  strategies_count  INTEGER NOT NULL,
  evaluations       INTEGER NOT NULL,    -- symbols_scanned * strategies_count
  signals_generated INTEGER NOT NULL,
  trades_opened     INTEGER NOT NULL DEFAULT 0,
  trades_closed     INTEGER NOT NULL DEFAULT 0,
  duration_ms       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan_runs_started ON scan_runs(started_at DESC);

-- One row per (run, symbol, strategy) evaluation. Captures fired AND no-fire
-- decisions so the session dashboard can show per-symbol reasoning.
-- Strategies must populate StrategyDecision.reason on hold branches for useful output.
CREATE TABLE IF NOT EXISTS decision_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      INTEGER NOT NULL,
  symbol      TEXT    NOT NULL,
  strategy_id TEXT    NOT NULL,
  bar_time    TEXT    NOT NULL,          -- date of the bar evaluated (YYYY-MM-DD)
  fired       INTEGER NOT NULL,          -- 1 = signal fired, 0 = hold/no-fire
  action      TEXT    NOT NULL,          -- enter_long | enter_short | exit | hold
  reason      TEXT,                      -- null when strategy does not supply one
  FOREIGN KEY (run_id) REFERENCES scan_runs(id)
);
CREATE INDEX IF NOT EXISTS idx_decision_log_run    ON decision_log(run_id);
CREATE INDEX IF NOT EXISTS idx_decision_log_runsym ON decision_log(run_id, symbol);

-- Point-in-time index membership changes, scraped from each index's Wikipedia
-- "selected changes" table (scripts/build-pit-membership.ts). An append-only
-- ledger, not a snapshot: replay it backward from the current constituent
-- list to reconstruct membership as of any past date. This is what makes
-- backtests survivorship-bias-aware - without it, a backtest run today only
-- ever sees today's constituents, even at 2015 dates.
--
-- Coverage caveat (free data): Wikipedia's changes tables are reasonably
-- complete back to the late 1990s for the S&P 500 but are not a complete
-- record for a stock's entire multi-decade history. Good enough to remove
-- lookahead bias in "did this stock enter/exit the index during my backtest
-- window" - not a substitute for a paid point-in-time data vendor.
CREATE TABLE IF NOT EXISTS index_membership_changes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  index_name     TEXT    NOT NULL,        -- e.g. 'sp500'
  effective_date TEXT    NOT NULL,        -- 'YYYY-MM-DD', the change's effective date
  symbol         TEXT    NOT NULL,
  action         TEXT    NOT NULL CHECK (action IN ('added', 'removed')),
  source         TEXT    NOT NULL DEFAULT 'wikipedia',
  UNIQUE(index_name, effective_date, symbol, action)
);
CREATE INDEX IF NOT EXISTS idx_membership_changes_index ON index_membership_changes(index_name, effective_date);

-- Saved backtest runs (IMPROVEMENT_PLAN.md WS4.5): params + metrics snapshot
-- per run so before/after comparisons survive page reloads. Append-only.
CREATE TABLE IF NOT EXISTS backtest_runs (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,             -- ISO timestamp
  strategy_id TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  timeframe   TEXT NOT NULL DEFAULT '1d',
  params      TEXT NOT NULL,             -- JSON: resolved strategy params
  metrics     TEXT NOT NULL              -- JSON: BacktestMetrics
);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_created ON backtest_runs(created_at);
