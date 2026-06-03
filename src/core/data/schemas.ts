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

/** Parse and validate an array of raw bar objects; throws ZodError on failure. */
export function validateBars(raw: unknown[]): z.infer<typeof BarSchema>[] {
  return raw.map((b, i) => {
    const result = BarSchema.safeParse(b);
    if (!result.success) {
      throw new Error(
        `Bar[${i}] validation failed: ${result.error.message}`,
      );
    }
    return result.data;
  });
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
