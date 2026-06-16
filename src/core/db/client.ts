import 'server-only';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = path.join(process.cwd(), 'data', 'quantdesk.db');
const SCHEMA_PATH = path.join(process.cwd(), 'src', 'core', 'db', 'schema.sql');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  migrate(_db);
  return _db;
}

function migrate(db: Database.Database): void {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  // Split on statement boundaries; filter empty strings
  const statements = schema
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    db.exec(stmt + ';');
  }
  migrateSignals(db);
  migratePaperTrades(db);
}

/**
 * Rebuild paper_trades if the stored status CHECK constraint does not include
 * 'pending'. SQLite cannot ALTER a CHECK constraint in place, so the table is
 * recreated with the same data inside a transaction. Idempotent.
 */
function migratePaperTrades(db: Database.Database): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='paper_trades'")
    .get() as { sql: string } | undefined;

  // Table doesn't exist yet (fresh DB) or already has 'pending' - nothing to do
  if (!row || row.sql.includes("'pending'")) return;

  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE paper_trades_new (
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
      )
    `);
    db.exec('INSERT INTO paper_trades_new SELECT * FROM paper_trades');
    db.exec('DROP TABLE paper_trades');
    db.exec('ALTER TABLE paper_trades_new RENAME TO paper_trades');
  });
  rebuild();
}

/**
 * Column adds and data fixes that schema.sql cannot express idempotently
 * (SQLite has no ADD COLUMN IF NOT EXISTS). Order matters: dedup must run
 * before the unique index is created or index creation throws on legacy dups.
 */
function migrateSignals(db: Database.Database): void {
  const cols = db.pragma('table_info(signals)') as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'created_at')) {
    db.exec('ALTER TABLE signals ADD COLUMN created_at TEXT');
    db.exec('UPDATE signals SET created_at = time WHERE created_at IS NULL');
  }
  db.exec(`
    DELETE FROM signals WHERE id NOT IN (
      SELECT MIN(id) FROM signals GROUP BY symbol, time, strategy_id, side
    )
  `);
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_dedup ON signals (symbol, time, strategy_id, side)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_signals_symbol_time ON signals (symbol, time)',
  );
}
