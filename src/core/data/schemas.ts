import { z } from 'zod';

/**
 * Shared zod schemas for adapter output validation.
 * All adapters MUST validate their output through these before returning.
 */

export const BarSchema = z.object({
  time: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z)?$/,
      'time must be YYYY-MM-DD or full ISO UTC timestamp',
    ),
  open: z.number().finite(),
  high: z.number().finite(),
  low: z.number().finite(),
  close: z.number().finite(),
  volume: z.number().finite().nonnegative(),
}).refine((b) => b.high >= b.low, {
  message: 'high must be >= low',
}).refine((b) => b.high >= b.open && b.high >= b.close, {
  message: 'high must be >= open and close',
}).refine((b) => b.low <= b.open && b.low <= b.close, {
  message: 'low must be <= open and close',
});

export type BarInput = z.input<typeof BarSchema>;

export const SymbolMetaSchema = z.object({
  symbol: z.string().min(1),
  providerSymbol: z.string().min(1),
  name: z.string().min(1),
  assetClass: z.enum(['equity', 'forex', 'crypto', 'commodity', 'index']),
  currency: z.string().min(1),
  exchange: z.string().optional(),
  providerId: z.string().min(1),
});

const nullableFiniteNumber = z.number().finite().nullable();

export const FundamentalsSchema = z.object({
  symbol:           z.string().min(1),
  trailingPE:       nullableFiniteNumber,
  forwardPE:        nullableFiniteNumber,
  marketCap:        nullableFiniteNumber,
  epsGrowth:        nullableFiniteNumber,
  profitMargin:     nullableFiniteNumber,
  revenueGrowth:    nullableFiniteNumber,
  fiftyTwoWeekLow:  nullableFiniteNumber,
  fiftyTwoWeekHigh: nullableFiniteNumber,
  recommendation:   z.string().nullable(),
  targetMeanPrice:  nullableFiniteNumber,
  nextEarningsDate: z.string().nullable(),
});

export const NewsItemSchema = z.object({
  title:       z.string().min(1),
  publisher:   z.string(),
  publishedAt: z.string(),
  link:        z.string(),
});

export function validateNewsItems(raw: unknown[]): z.infer<typeof NewsItemSchema>[] {
  return raw.flatMap((n) => {
    const result = NewsItemSchema.safeParse(n);
    // News is best-effort decoration - drop malformed items instead of failing the dossier
    return result.success ? [result.data] : [];
  });
}

/**
 * Parse and validate an array of raw bar objects. Bars that fail validation
 * are quarantined (logged + dropped), NOT thrown - a single malformed bar
 * (a known-occasional Yahoo/Alpaca glitch) used to abort ingest for the
 * entire symbol, silently dropping it from that run. One bad bar should cost
 * one bar, not the whole symbol.
 */
export function validateBars(raw: unknown[], context?: string): z.infer<typeof BarSchema>[] {
  const good: z.infer<typeof BarSchema>[] = [];
  let dropped = 0;
  for (let i = 0; i < raw.length; i++) {
    const result = BarSchema.safeParse(raw[i]);
    if (result.success) {
      good.push(result.data);
    } else {
      dropped++;
      console.warn(
        `[validateBars]${context ? ` ${context}` : ''} bar[${i}] quarantined: ${result.error.message}`,
      );
    }
  }
  if (dropped > 0) {
    console.warn(
      `[validateBars]${context ? ` ${context}` : ''} dropped ${dropped}/${raw.length} bars, kept ${good.length}.`,
    );
  }
  return good;
}

/** Parse and validate an array of raw SymbolMeta objects; throws ZodError on failure. */
export function validateSymbolMetas(
  raw: unknown[],
): z.infer<typeof SymbolMetaSchema>[] {
  return raw.map((s, i) => {
    const result = SymbolMetaSchema.safeParse(s);
    if (!result.success) {
      throw new Error(
        `SymbolMeta[${i}] validation failed: ${result.error.message}`,
      );
    }
    return result.data;
  });
}
