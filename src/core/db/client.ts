import 'server-only';
import Database from 'libsql';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'quantdesk.db');
const SCHEMA_PATH = path.join(process.cwd(), 'src', 'core', 'db', 'schema.sql');

// libsql's shipped Options type declares `syncUrl` but not `authToken` / `syncPeriod` -
// both are accepted at runtime for embedded-replica mode, so widen the type locally
// instead of reaching for `any`.
type LibsqlOptions = Database.Options & { authToken?: string; syncPeriod?: number };

let _db: Database.Database | null = null;

/**
 * Two libsql quirks specific to embedded-replica mode (TURSO_DATABASE_URL set)
 * that every write in core/db/*.ts must work around - both silent/near-silent,
 * neither present in plain local-file mode:
 *
 * 1. Named-parameter binding on prepared statements (`stmt.run({ key: val })`
 *    against `@key`/`:key`/`$key` placeholders) is silently dropped - the
 *    call returns successfully but nothing is written, no error thrown.
 *    Positional binding (`stmt.run([val1, val2, ...])` against `?`
 *    placeholders, values in placeholder-occurrence order) works correctly.
 *    Always use positional params for writes.
 *
 * 2. `db.transaction(fn)` throws `InvalidParserState("Init")` - it issues a
 *    bare SAVEPOINT, which remote-replica connections reject outside an
 *    already-active transaction (upstream bug:
 *    https://github.com/tursodatabase/libsql/issues/1382). Plain sequential
 *    statements (no transaction wrapper) are used instead throughout - an
 *    accepted loss of cross-statement atomicity, safe here because every
 *    affected write is an idempotent upsert (ON CONFLICT / OR IGNORE) or has
 *    no cross-row invariant to protect mid-batch.
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const syncUrl = process.env.TURSO_DATABASE_URL;

  if (syncUrl) {
    // Embedded-replica mode: writes go straight to the remote Turso primary,
    // reads come from the local replica file at DB_PATH. `DB_PATH` here is a
    // cache, not the source of truth - safe to delete, it gets rebuilt on next sync.
    const syncPeriodEnv = process.env.TURSO_SYNC_PERIOD;
    const opts: LibsqlOptions = {
      syncUrl,
      authToken: process.env.TURSO_AUTH_TOKEN,
      ...(syncPeriodEnv ? { syncPeriod: Number(syncPeriodEnv) } : {}),
    };
    _db = new Database(DB_PATH, opts);
    _db.sync();
    _db.pragma('foreign_keys = ON');
  } else {
    // Local-file fallback (no Turso creds set) - today's standalone behavior.
    // Keeps CI / offline dev working without a Turso account.
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }

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
    try {
      db.exec(stmt + ';');
    } catch (err) {
      // A single statement failing (e.g. CREATE UNIQUE INDEX rejected because
      // pre-existing rows already violate it) must not crash every DB access
      // on startup. Log loudly and continue - CREATE TABLE/INDEX ... IF NOT
      // EXISTS is idempotent by construction, so a real failure here means
      // "this constraint can't apply yet," not "the schema is broken."
      console.error(`[db migrate] statement failed, continuing: ${stmt.slice(0, 120)}...`, err);
    }
  }
  migrateSignals(db);
  migratePaperTrades(db);
  migratePaperTradesMarket(db);
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

  // No db.transaction() - libsql's embedded-replica connection throws
  // InvalidParserState("Init") for a bare SAVEPOINT outside an active
  // transaction (upstream bug: https://github.com/tursodatabase/libsql/issues/1382).
  // Sequential db.exec() calls instead - see the header comment above getDb().
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
  // market column: source market bucket for per-market analytics.
  // Backfill existing rows as 'sp500' (all signals to date came from the S&P500 path).
  if (!cols.some((c) => c.name === 'market')) {
    db.exec('ALTER TABLE signals ADD COLUMN market TEXT');
    db.exec("UPDATE signals SET market = 'sp500' WHERE market IS NULL");
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

/**
 * Add the market column to paper_trades for per-market analytics.
 * Additive migration: existing trades are backfilled as 'sp500' (all trades
 * to date came from the S&P500 + gold intraday path).
 */
function migratePaperTradesMarket(db: Database.Database): void {
  const cols = db.pragma('table_info(paper_trades)') as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'market')) {
    db.exec('ALTER TABLE paper_trades ADD COLUMN market TEXT');
    db.exec("UPDATE paper_trades SET market = 'sp500' WHERE market IS NULL");
  }
}
