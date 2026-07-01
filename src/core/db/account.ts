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
  // Preserve existing currency when updating; default to 'USD' on first insert only.
  // NOTE: libsql's embedded-replica connection silently drops writes bound via
  // named (@param) object args - positional (?) array args are required. See
  // client.ts header comment for the full explanation (upstream libsql bug).
  db.prepare(`
    INSERT INTO account (id, starting_balance, currency, created_at, updated_at)
    VALUES (1, ?, 'USD', ?, ?)
    ON CONFLICT (id) DO UPDATE SET starting_balance = ?, updated_at = ?
  `).run([amount, now, now, amount, now]);
  return getAccountRow()!;
}

/** Set the display/account currency. Creates the account row if it does not exist yet. */
export function setAccountCurrency(currency: string): AccountRow {
  if (!currency || typeof currency !== 'string') {
    throw new Error('currency must be a non-empty string');
  }
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getAccountRow();
  const upperCurrency = currency.toUpperCase();
  if (existing) {
    db.prepare(
      'UPDATE account SET currency = ?, updated_at = ? WHERE id = 1',
    ).run([upperCurrency, now]);
  } else {
    // No budget row yet - create one with zero balance so currency is persisted.
    // The zero balance means the broker falls back to legacy notional sizing until
    // the user sets a real budget.
    db.prepare(`
      INSERT INTO account (id, starting_balance, currency, created_at, updated_at)
      VALUES (1, 0, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET currency = ?, updated_at = ?
    `).run([upperCurrency, now, now, upperCurrency, now]);
  }
  return getAccountRow()!;
}
