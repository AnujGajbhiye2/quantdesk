import { NextResponse } from 'next/server';
import { list } from '@/core/strategy/registry';

/**
 * GET /api/strategies
 *
 * Returns the list of registered strategy ids + names for the UI pickers.
 */
export async function GET() {
  try {
    return NextResponse.json({ strategies: list() });
  } catch (err) {
    console.error('[GET /api/strategies]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
