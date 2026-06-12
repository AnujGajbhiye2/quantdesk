import 'server-only';
import { getDb } from './client';
import type { Fundamentals, NewsItem } from '@/core/data/DataProvider';

/**
 * TTL'd JSON caches for dossier decoration data (fundamentals, news).
 * Generic single-row-per-symbol pattern; payloads are provider-validated
 * before they get here.
 */

const FUNDAMENTALS_TTL_MS = 24 * 3_600_000; // 1 day
const NEWS_TTL_MS         = 6 * 3_600_000;  // 6 hours

interface CacheRow {
  payload:    string;
  fetched_at: string;
}

function readCache<T>(table: 'fundamentals_cache' | 'news_cache', symbol: string, ttlMs: number): T | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT payload, fetched_at FROM ${table} WHERE symbol = ?`)
    .get(symbol) as CacheRow | undefined;
  if (!row) return null;
  if (Date.now() - new Date(row.fetched_at).getTime() > ttlMs) return null;
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}

function writeCache(table: 'fundamentals_cache' | 'news_cache', symbol: string, payload: unknown): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO ${table} (symbol, payload, fetched_at) VALUES (?, ?, ?)
    ON CONFLICT (symbol) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at
  `).run(symbol, JSON.stringify(payload), new Date().toISOString());
}

export function getCachedFundamentals(symbol: string): Fundamentals | null {
  return readCache<Fundamentals>('fundamentals_cache', symbol, FUNDAMENTALS_TTL_MS);
}

export function saveFundamentals(symbol: string, data: Fundamentals): void {
  writeCache('fundamentals_cache', symbol, data);
}

export function getCachedNews(symbol: string): NewsItem[] | null {
  return readCache<NewsItem[]>('news_cache', symbol, NEWS_TTL_MS);
}

export function saveNews(symbol: string, items: NewsItem[]): void {
  writeCache('news_cache', symbol, items);
}
