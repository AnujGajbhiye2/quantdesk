import 'server-only';
import { randomUUID } from 'node:crypto';
import { getDb } from './client';

export interface UserRow {
  id:           string;
  email:        string;
  name:         string | null;
  passwordHash: string | null;
  provider:     string;
  createdAt:    string;
}

interface RawUserRow {
  id:            string;
  email:         string;
  name:          string | null;
  password_hash: string | null;
  provider:      string;
  created_at:    string;
}

function mapRow(r: RawUserRow): UserRow {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    passwordHash: r.password_hash,
    provider: r.provider,
    createdAt: r.created_at,
  };
}

export function getUserByEmail(email: string): UserRow | null {
  const db = getDb();
  const row = db
    .prepare('SELECT id, email, name, password_hash, provider, created_at FROM users WHERE email = ?')
    .get(email.toLowerCase()) as RawUserRow | undefined;
  return row ? mapRow(row) : null;
}

/** Credentials signup. Caller has already hashed the password and rejected the admin email. */
export function createUser(email: string, passwordHash: string, name: string | null): UserRow {
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const normalizedEmail = email.toLowerCase();
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, normalizedEmail, name, passwordHash, 'credentials', createdAt);
  return { id, email: normalizedEmail, name, passwordHash, provider: 'credentials', createdAt };
}

/** Idempotent upsert for Google sign-ins (no password). Single statement - no transaction needed. */
export function upsertOAuthUser(email: string, name: string | null): void {
  const db = getDb();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, provider, created_at)
     VALUES (?, ?, ?, NULL, 'google', ?)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name`
  ).run(id, email.toLowerCase(), name, createdAt);
}

export interface UserStats {
  total:       number;
  last7d:      number;
  last30d:     number;
  byProvider:  Record<string, number>;
  recent:      { email: string; name: string | null; provider: string; createdAt: string }[];
}

/** Admin-only signup analytics: counts + the most recent accounts. */
export function getUserStats(recentLimit = 20): UserStats {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;

  const since7d  = new Date(Date.now() - 7  * 86_400_000).toISOString();
  const since30d = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const last7d  = (db.prepare('SELECT COUNT(*) as c FROM users WHERE created_at >= ?').get(since7d)  as { c: number }).c;
  const last30d = (db.prepare('SELECT COUNT(*) as c FROM users WHERE created_at >= ?').get(since30d) as { c: number }).c;

  const providerRows = db.prepare('SELECT provider, COUNT(*) as c FROM users GROUP BY provider').all() as { provider: string; c: number }[];
  const byProvider = Object.fromEntries(providerRows.map((r) => [r.provider, r.c]));

  const recentRows = db
    .prepare('SELECT email, name, provider, created_at FROM users ORDER BY created_at DESC LIMIT ?')
    .all(recentLimit) as { email: string; name: string | null; provider: string; created_at: string }[];
  const recent = recentRows.map((r) => ({ email: r.email, name: r.name, provider: r.provider, createdAt: r.created_at }));

  return { total, last7d, last30d, byProvider, recent };
}
