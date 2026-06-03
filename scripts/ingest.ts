/**
 * Bulk ingestion script.
 *
 * Usage:
 *   npm run ingest -- --universe scripts/universe/sp500.json
 *   npm run ingest -- --universe scripts/universe/nifty200.json --from 2020-01-01
 *
 * Fetches full daily history for every symbol in the universe JSON file
 * and upserts it into the local SQLite DB.
 *
 * Run via:  npm run ingest (see package.json)
 * Which calls: tsx --conditions=react-server scripts/ingest.ts
 * The --conditions=react-server flag makes the 'server-only' package resolve
 * to its no-op export so it does not throw outside a Next.js render context.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ingestUniverse, type UniverseEntry } from '../src/core/data/ingest';

function parseArgs(): { universePath: string; from?: string } {
  const args = process.argv.slice(2);
  let universePath: string | undefined;
  let from: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--universe' && args[i + 1]) {
      universePath = args[++i];
    } else if (args[i] === '--from' && args[i + 1]) {
      from = args[++i];
    }
  }

  if (!universePath) {
    console.error('Usage: npm run ingest -- --universe <path> [--from YYYY-MM-DD]');
    process.exit(1);
  }

  return { universePath, from };
}

async function main() {
  const { universePath, from } = parseArgs();
  const absolutePath = resolve(process.cwd(), universePath);

  let universe: UniverseEntry[];
  try {
    const raw = readFileSync(absolutePath, 'utf-8');
    universe = JSON.parse(raw) as UniverseEntry[];
  } catch (err) {
    console.error(`Failed to read universe file: ${absolutePath}`);
    console.error(err);
    process.exit(1);
  }

  console.log(`Ingesting ${universe.length} symbols from ${absolutePath}...`);
  if (from) console.log(`  History from: ${from}`);

  const results = await ingestUniverse(universe, from);

  let totalBars = 0;
  let errors = 0;

  for (const r of results) {
    if (r.error) {
      console.error(`  ERROR  ${r.symbol}: ${r.error}`);
      errors++;
    } else {
      console.log(`  OK     ${r.symbol}: ${r.barsAdded} bars`);
      totalBars += r.barsAdded;
    }
  }

  console.log(`\nDone. ${results.length - errors}/${results.length} symbols, ${totalBars} total bars. ${errors} error(s).`);

  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
