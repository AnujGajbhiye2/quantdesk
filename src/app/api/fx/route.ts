import { NextResponse } from 'next/server';
import { getAllRates } from '@/core/format/fx';

/**
 * GET /api/fx
 * Returns all known static USD exchange rates so the client can convert
 * native-currency values for display without importing server-only fx.ts.
 *
 * Response: { rates: Record<string, number> }
 * where rates[currency] = how many USD 1 unit of that currency is worth.
 */
export function GET() {
  return NextResponse.json({ rates: getAllRates() });
}
