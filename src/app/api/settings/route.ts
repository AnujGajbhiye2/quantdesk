import { NextResponse } from 'next/server';
import { getAccountRow, setStartingBalance, setAccountCurrency } from '@/core/db/account';
import { getAllRates } from '@/core/format/fx';
import { resetPaperState, wipeAll } from '@/core/db/reset';
import { requireUser, requireAdmin, AuthError } from '@/core/auth/guard';

/**
 * GET /api/settings
 * Returns FX rates (public research data) for all logged-in users. The
 * account row (budget/currency of the live book) is trade data - only
 * included for admin.
 */
export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({
      account: user.isAdmin ? getAccountRow() : null,
      rates:   getAllRates(),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[GET /api/settings]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/settings
 *
 * Actions:
 *   currency-set  — Set display/account currency. Body: { action, currency }
 *                    Any logged-in user may call this, but it only persists
 *                    to the shared account row for admin - non-admins never
 *                    write to (or read) the real account, so their currency
 *                    choice is display-only on the client.
 *   budget-set    — Set starting balance. Admin only.
 *   reset-paper   — Clear paper trades, journal, signals, strategy_edge, alert_log, account. Admin only.
 *   reset-all     — Wipe everything including market data. Requires re-ingest. Admin only.
 */
export async function POST(request: Request) {
  try {
    const body   = await request.json() as Record<string, unknown>;
    const action = body.action as string | undefined;

    const ADMIN_ACTIONS = new Set(['budget-set', 'reset-paper', 'reset-all']);
    const user = ADMIN_ACTIONS.has(action ?? '') ? await requireAdmin() : await requireUser();

    switch (action) {
      case 'currency-set': {
        const currency = body.currency as string;
        if (!currency) {
          return NextResponse.json({ error: 'currency required' }, { status: 400 });
        }
        if (!user.isAdmin) {
          // Non-admin: no shared account to persist against - client keeps
          // the choice locally. Echo it back so the UI can update optimistically.
          return NextResponse.json({ account: { currency } });
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
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[POST /api/settings]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
