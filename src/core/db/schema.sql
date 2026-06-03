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
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  pnl          REAL,
  pnl_pct      REAL,
  costs        REAL NOT NULL DEFAULT 0,
  notes        TEXT
);

CREATE TABLE IF NOT EXISTS signals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol      TEXT NOT NULL,
  time        TEXT NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('long', 'short', 'flat')),
  strength    REAL,
  reason      TEXT NOT NULL,
  strategy_id TEXT NOT NULL
);
