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
}
