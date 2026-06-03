/**
 * Throttled, resumable polling script.
 *
 * Usage:
 *   npm run poll -- --universe scripts/universe/sp500.json
 *   npm run poll -- --universe scripts/universe/nifty200.json --cap 400
 *   npm run poll -- --universe scripts/universe/sp500.json --rate 8 --cap 800
 *
 * Options:
 *   --universe <path>   Universe JSON file (required)
 *   --rate   <n>        Requests per minute (default: 30 for Yahoo, 8 for Twelve Data)
 *   --cap    <n>        Max requests this run; stop and resume tomorrow (default: no cap)
 *   --from   <date>     History start for first-time symbols (default: 2015-01-01)
 *   --provider <id>     Only ingest symbols with this providerId (optional filter)
 *
 * The script skips symbols that are already up-to-date (latestBar >= yesterday).
 * Re-run daily to continue building the database incrementally.
 */

import { readFileSync } from 'node:fs';
import { resolve }      from 'node:path';
import { pollUniverse, type PollResult } from '../src/core/data/poller';
import type { UniverseEntry } from '../src/core/data/ingest';

function parseArgs(): {
  universePath: string;
  reqPerMin:    number;
  dailyCap:     number;
  from:         string;
  provider?:    string;
} {
  const args = process.argv.slice(2);
  let universePath: string | undefined;
  let reqPerMin  = 30;
  let dailyCap   = Infinity;
  let from       = '2015-01-01';
  let provider: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--universe' && args[i + 1]) universePath = args[++i];
    if (args[i] === '--rate'     && args[i + 1]) reqPerMin  = parseInt(args[++i], 10);
    if (args[i] === '--cap'      && args[i + 1]) dailyCap   = parseInt(args[++i], 10);
    if (args[i] === '--from'     && args[i + 1]) from       = args[++i];
    if (args[i] === '--provider' && args[i + 1]) provider   = args[++i];
  }

  if (!universePath) {
    console.error('Usage: npm run poll -- --universe <path> [--rate <n>] [--cap <n>] [--from YYYY-MM-DD] [--provider <id>]');
    process.exit(1);
  }

  return { universePath, reqPerMin, dailyCap, from, provider };
}

async function main() {
  const { universePath, reqPerMin, dailyCap, from, provider } = parseArgs();
  const absolutePath = resolve(process.cwd(), universePath);

  let universe: UniverseEntry[];
  try {
    universe = JSON.parse(readFileSync(absolutePath, 'utf-8')) as UniverseEntry[];
  } catch (err) {
    console.error(`Failed to read universe file: ${absolutePath}`);
    console.error(err);
    process.exit(1);
  }

  if (provider) {
    universe = universe.filter((e) => e.providerId === provider);
    console.log(`Filtered to provider '${provider}': ${universe.length} symbols`);
  }

  console.log(`Polling ${universe.length} symbols from ${absolutePath}`);
  console.log(`  Rate: ${reqPerMin} req/min  |  Cap: ${dailyCap === Infinity ? 'none' : dailyCap}  |  History from: ${from}`);
  console.log('');

  const results: PollResult[] = await pollUniverse({
    universe,
    reqPerMin,
    dailyCap,
    from,
    onProgress: (msg) => console.log(msg),
  });

  const errors = results.filter((r) => !r.skipped && r.error).length;
  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
