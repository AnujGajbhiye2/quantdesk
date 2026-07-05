import { getDb } from '@/core/db/client';
import { getMarketSnapshot } from '@/core/market/snapshot';
import { getPaperTrades } from '@/core/db/paper';
import { getAllSymbols } from '@/core/db/bars';
import { mergeKnownSymbols } from '@/core/data/universe';
import { list as listStrategies } from '@/core/strategy/registry';
import Dashboard from '@/components/dashboard/Dashboard';

export const dynamic = 'force-dynamic';

// Initialise DB (creates tables if they don't exist) on the first server render.
function initDb() {
  try { getDb(); } catch (e) { console.error('[quantdesk] DB init failed:', e); }
}

export default function DashboardPage() {
  initDb();

  // getMarketSnapshot caches full-universe results for 60 s internally;
  // navigation away+back is fast after the first load.
  const rows       = getMarketSnapshot({ timeframe: '1d' });
  const metas      = getAllSymbols();
  const allSymbols = mergeKnownSymbols(metas);
  const strategies = listStrategies();

  // Executed trades + performance are visible to any logged-in user (this
  // route already requires login via middleware) - only the *mutating*
  // controls on Dashboard stay admin-gated (client-side, via useAuth()).
  const trades = getPaperTrades();

  return (
    <Dashboard
      initialRows={rows}
      initialTrades={trades}
      initialStrategies={strategies}
      allSymbols={allSymbols}
    />
  );
}
