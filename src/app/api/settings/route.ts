import { NextResponse } from 'next/server';
import { getAccountRow, setStartingBalance, setAccountCurrency } from '@/core/db/account';
import { getAllRates } from '@/core/format/fx';
import { resetPaperState, wipeAll } from '@/core/db/reset';

/**
 * GET /api/settings
 * Returns current account row (budget + currency) and FX rates for client-side display.
 */
export async function GET() {
  return NextResponse.json({
    account: getAccountRow(),
    rates:   getAllRates(),
  });
}

/**
 * POST /api/settings
 *
 * Actions:
 *   currency-set  — Set display/account currency. Body: { action, currency }
 *   budget-set    — Set starting balance. Body: { action, amount }
 *   reset-paper   — Clear paper trades, journal, signals, strategy_edge, alert_log, account.
 *   reset-all     — Wipe everything including market data. Requires re-ingest.
 */
export async function POST(request: Request) {
  try {
    const body   = await request.json() as Record<string, unknown>;
    const action = body.action as string | undefined;

    switch (action) {
      case 'currency-set': {
        const currency = body.currency as string;
        if (!currency) {
          return NextResponse.json({ error: 'currency required' }, { status: 400 });
        }
        const account = setAccountCurrency(currency);
        return NextResponse.json({ account });
      }

      case 'budget-set': {
        const amount = body.amount as number;
        const account = setStartingBalance(amount);
        return NextResponse.json({ account });
      }

      case 'reset-paper': {
        resetPaperState();
        return NextResponse.json({ ok: true });
      }

      case 'reset-all': {
        wipeAll();
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action '${String(action)}'. Valid: currency-set, budget-set, reset-paper, reset-all` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error('[POST /api/settings]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
