import 'server-only';
import { getDb } from './client';

/** The single paper-trading budget row, or null when no budget has been set. */
export interface AccountRow {
  startingBalance: number;
  currency:        string;
  createdAt:       string;
  updatedAt:       string;
}

interface DbRow {
  starting_balance: number;
  currency:         string;
  created_at:       string;
  updated_at:       string;
}

export function getAccountRow(): AccountRow | null {
  const db = getDb();
  const row = db
    .prepare('SELECT starting_balance, currency, created_at, updated_at FROM account WHERE id = 1')
    .get() as DbRow | undefined;
  if (!row) return null;
  return {
    startingBalance: row.starting_balance,
    currency:        row.currency,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  };
}

/** Set or replace the budget. Trades are untouched - balance re-derives from them. */
export function setStartingBalance(amount: number): AccountRow {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('starting balance must be a positive number');
  }
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO account (id, starting_balance, currency, created_at, updated_at)
    VALUES (1, @amount, 'USD', @now, @now)
    ON CONFLICT (id) DO UPDATE SET starting_balance = @amount, updated_at = @now
  `).run({ amount, now });
  return getAccountRow()!;
}
