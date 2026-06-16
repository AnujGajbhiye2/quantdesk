/** Canonical list of currencies available for display selection across the app. */
export const DISPLAY_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'INR', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'AUD', 'CAD', 'JPY',
] as const;

export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];
