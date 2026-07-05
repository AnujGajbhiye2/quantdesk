import { NextResponse } from 'next/server';
import { isTradingHalted, setTradingHalt, clearTradingHalt } from '@/core/paper/halt';
import { requireAdmin, AuthError } from '@/core/auth/guard';

/**
 * POST /api/halt
 *
 * Manages the trading halt switch backed by app_flags key 'trading_halt'.
 *
 * Actions:
 *   status  - return current halt state (no mutation)
 *   halt    - activate halt with a reason string
 *   resume  - clear halt, re-enable new entries
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const action = body['action'];

  try {
    await requireAdmin();
    if (action === 'status') {
      return NextResponse.json(isTradingHalted());
    }

    if (action === 'halt') {
      const reason = typeof body['reason'] === 'string' && body['reason'].trim()
        ? body['reason'].trim()
        : 'manual halt via dashboard';
      setTradingHalt(reason);
      return NextResponse.json(isTradingHalted());
    }

    if (action === 'resume') {
      clearTradingHalt();
      return NextResponse.json(isTradingHalted());
    }

    return NextResponse.json({ error: `unknown action: ${String(action)}` }, { status: 400 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
