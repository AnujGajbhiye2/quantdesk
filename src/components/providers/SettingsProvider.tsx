'use client';

/**
 * App-wide display currency + FX rates context.
 *
 * Currency is persisted in the `account` DB table (account.currency) via
 * POST /api/settings action=currency-set, so it survives page reloads and
 * is visible to all panels - replacing the previous localStorage-only hack
 * on the Paper page.
 *
 * Internal accounting stays in USD; this context only affects display.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { curGlyph } from '@/core/format/currency';

// --------------------------------------------------------------------------
// Types (client-safe; mirrors server AccountRow without importing server-only)
// --------------------------------------------------------------------------

export interface AccountSettings {
  startingBalance: number;
  currency:        string;
  createdAt:       string;
  updatedAt:       string;
}

interface SettingsContextValue {
  /** Currently selected display currency (ISO code). */
  displayCurrency:    string;
  /** All known FX rates from /api/fx (currency -> USD multiplier). */
  rates:              Record<string, number>;
  /** Loaded account settings (null until fetched or if no budget set). */
  account:            AccountSettings | null;
  /** Set a new display currency; persists to DB. */
  setDisplayCurrency: (currency: string) => Promise<void>;
  /** Derive display amount from a USD amount using current rates. */
  fromUSD:            (amountUSD: number) => number;
  /** Format a USD amount in the current display currency (glyph + 2dp). */
  fmt:                (amountUSD: number, dec?: number) => string;
  /** Refetch settings from the server (call after budget/currency changes). */
  reload:             () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

// --------------------------------------------------------------------------
// Provider
// --------------------------------------------------------------------------

interface ApiResponse {
  account: AccountSettings | null;
  rates:   Record<string, number>;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [account,         setAccount]         = useState<AccountSettings | null>(null);
  const [rates,           setRates]           = useState<Record<string, number>>({ USD: 1 });
  const [displayCurrency, setDisplayCurrencyState] = useState<string>('USD');

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const data = await res.json() as ApiResponse;
      setRates(data.rates ?? { USD: 1 });
      if (data.account) {
        setAccount(data.account);
        setDisplayCurrencyState(data.account.currency);
      }
    } catch { /* silently ignore - app still works without settings */ }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const setDisplayCurrency = useCallback(async (currency: string) => {
    // Optimistic update
    setDisplayCurrencyState(currency);
    try {
      const res = await fetch('/api/settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'currency-set', currency }),
      });
      if (res.ok) {
        const data = await res.json() as { account: AccountSettings };
        setAccount(data.account);
        setDisplayCurrencyState(data.account.currency);
      }
    } catch { /* optimistic state already set; silently ignore */ }
  }, []);

  /** Convert a USD amount to the current display currency. */
  const fromUSD = useCallback((amountUSD: number): number => {
    const rate = rates[displayCurrency] ?? 1;
    return amountUSD / rate;
  }, [rates, displayCurrency]);

  /** Format a USD amount in the current display currency with glyph. */
  const fmt = useCallback((amountUSD: number, dec = 2): string => {
    if (!isFinite(amountUSD)) return '--';
    const converted = fromUSD(amountUSD);
    return `${curGlyph(displayCurrency)}${converted.toFixed(dec)}`;
  }, [fromUSD, displayCurrency]);

  return (
    <SettingsContext.Provider
      value={{
        displayCurrency,
        rates,
        account,
        setDisplayCurrency,
        fromUSD,
        fmt,
        reload,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

// --------------------------------------------------------------------------
// Hook
// --------------------------------------------------------------------------

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
