import { NextResponse } from 'next/server';
import { getUserStats } from '@/core/db/users';
import { requireAdmin, AuthError } from '@/core/auth/guard';

/** GET /api/users - admin-only signup analytics (counts + recent accounts). */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json(getUserStats());
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[GET /api/users]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
