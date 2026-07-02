/**
 * Incremental EOD refresh script.
 *
 * Usage:
 *   npm run refresh
 *   npm run refresh -- --universe scripts/universe/sp500.json
 *
 * Fetches only bars newer than the latest stored time for each symbol.
 * Runs in seconds for daily updates; only new rows are added.
 *
 * Also triggered by: node-cron (see src/instrumentation.ts) and POST /api/ingest.
 *
 * Run via:  npm run refresh (see package.json)
 * Which calls: tsx --conditions=react-server scripts/refresh.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { refreshUniverse, type UniverseEntry } from '../src/core/data/ingest';
import { postRefreshTasks } from '../src/core/data/post-refresh';
import { buildIngestRunInput, insertIngestRun, pruneOldIngestRuns } from '../src/core/db/ingest-log';

function parseArgs(): { universePath?: string } {
  const args = process.argv.slice(2);
  let universePath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--universe' && args[i + 1]) {
      universePath = args[++i];
    }
  }

  return { universePath };
}

async function main() {
  const { universePath } = parseArgs();
  let universe: UniverseEntry[] | undefined;

  if (universePath) {
    const absolutePath = resolve(process.cwd(), universePath);
    try {
      const raw = readFileSync(absolutePath, 'utf-8');
      universe = JSON.parse(raw) as UniverseEntry[];
      console.log(`Refreshing ${universe.length} symbols from ${absolutePath}...`);
    } catch (err) {
      console.error(`Failed to read universe file: ${absolutePath}`);
      console.error(err);
      process.exit(1);
    }
  } else {
    console.log('Refreshing all symbols stored in DB...');
  }

  const ingestStartedAt = new Date().toISOString();
  const results = await refreshUniverse(universe);

  let totalBars = 0;
  let errors = 0;

  for (const r of results) {
    if (r.error) {
      console.error(`  ERROR  ${r.symbol}: ${r.error}`);
      errors++;
    } else if (r.barsAdded > 0) {
      console.log(`  NEW    ${r.symbol}: +${r.barsAdded} bars`);
      totalBars += r.barsAdded;
    } else {
      console.log(`  UP-TO-DATE  ${r.symbol}`);
    }
  }

  console.log(`\nDone. ${results.length - errors}/${results.length} symbols checked, ${totalBars} new bars. ${errors} error(s).`);

  // Persist ingest run for session dashboard
  try {
    const input = buildIngestRunInput(results, ingestStartedAt, 'manual');
    insertIngestRun(input);
    pruneOldIngestRuns(30);
  } catch (err) {
    console.warn('Ingest log write failed (non-fatal):', err);
  }

  // Post-refresh: sweep open paper trades, then run the all-strategies scan
  console.log('\nRunning post-refresh tasks (sweep + scan-all)...');
  const post = await postRefreshTasks();

  if (post.sweep.error) {
    console.error(`Sweep error: ${post.sweep.error}`);
  } else {
    const closed   = post.sweep.results.filter((r) => r.action !== 'still-open');
    const stopped  = closed.filter((r) => r.action === 'stopped').length;
    const targeted = closed.filter((r) => r.action === 'targeted').length;
    const expired  = closed.filter((r) => r.action === 'expired').length;
    for (const r of closed) {
      console.log(`  ${r.action.toUpperCase().padEnd(8)} ${r.trade.symbol}: exit @ ${r.exitPrice?.toFixed(2)} on ${r.exitTime} | P&L ${r.trade.pnl?.toFixed(2) ?? '--'}`);
    }
    console.log(`Sweep done. Closed ${closed.length} trade(s): ${stopped} stopped, ${targeted} targeted, ${expired} expired (max hold).`);
  }

  if (post.scan.error) {
    console.error(`Scan error: ${post.scan.error}`);
  } else if (post.scan.result) {
    const s = post.scan.result;
    console.log(
      `Scan-all done. ${s.scanned} symbols x ${s.totalStrategies} strategies, ` +
      `${s.signals.length} signals, ${s.consensus.length} consensus rows, ${s.durationMs}ms.`,
    );
  }

  if (post.edge.error) {
    console.error(`Edge compute error: ${post.edge.error}`);
  } else if (post.edge.result) {
    const e = post.edge.result;
    console.log(
      `Edge stats done. ${e.symbols} symbols x ${e.strategies} strategies, ` +
      `${e.rows} rows (${e.recomputed} recomputed), ${e.durationMs}ms.`,
    );
  }

  if (post.fundamentalsPrefetch?.error) {
    console.error(`Fundamentals prefetch error: ${post.fundamentalsPrefetch.error}`);
  } else if (post.fundamentalsPrefetch?.result) {
    const f = post.fundamentalsPrefetch.result;
    console.log(
      `Fundamentals prefetch done. ${f.fetched} fetched, ${f.cached} cached, ` +
      `${f.failed} failed of ${f.attempted} (earnings-blackout gate armed).`,
    );
  }

  // Daily heartbeat - fires every time the refresh script runs so the operator
  // can confirm the system is alive and data is fresh. Best-effort; never
  // blocks the process or changes the exit code.
  try {
    const { sendDailyHeartbeat } = await import('../src/core/notify/heartbeat');
    await sendDailyHeartbeat({
      totalBars,
      symbolCount: results.length,
      refreshErrors: errors,
      post,
    });
  } catch (err) {
    console.warn('Heartbeat send failed (non-fatal):', err);
  }

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
