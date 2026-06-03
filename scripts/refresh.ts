/**
 * Incremental EOD refresh script.
 *
 * Usage:
 *   npm run refresh
 *   npm run refresh -- --universe scripts/universe/sp500-sample.json
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

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
