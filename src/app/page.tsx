import { getDb } from '@/core/db/client';
import { getMarketSnapshot } from '@/core/market/snapshot';
import { getPaperTrades } from '@/core/db/paper';
import { getAllSymbols } from '@/core/db/bars';
import { list as listStrategies } from '@/core/strategy/registry';
import Dashboard from '@/components/Dashboard';

// Initialise DB (creates tables if they don't exist) on the first server render.
function initDb() {
  try { getDb(); } catch (e) { console.error('[quantdesk] DB init failed:', e); }
}

export default function DashboardPage() {
  initDb();

  const rows       = getMarketSnapshot({ timeframe: '1d' });
  const trades     = getPaperTrades();
  const metas      = getAllSymbols();
  const strategies = listStrategies();

  return (
    <Dashboard
      initialRows={rows}
      initialTrades={trades}
      initialStrategies={strategies}
      allSymbols={metas.map((m) => ({ symbol: m.symbol, name: m.name, assetClass: m.assetClass, exchange: m.exchange }))}
    />
  );
}
