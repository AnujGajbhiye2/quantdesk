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
