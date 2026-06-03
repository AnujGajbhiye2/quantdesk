import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Entry {
  symbol: string;
  name: string;
}

const checks = [
  { file: 'scripts/universe/sp500.json', minStocks: 500, benchmarkSymbols: ['^GSPC', '^IXIC', '^DJI'] },
  { file: 'scripts/universe/nifty200.json', minStocks: 200, benchmarkSymbols: ['^NSEI', '^NSEMDCP50.NS'] },
];

let failed = false;

for (const check of checks) {
  const file = resolve(process.cwd(), check.file);
  const entries = JSON.parse(readFileSync(file, 'utf-8')) as Entry[];
  const symbols = new Set(entries.map((e) => e.symbol));
  const stockCount = entries.length - check.benchmarkSymbols.filter((s) => symbols.has(s)).length;
  const missingBenchmarks = check.benchmarkSymbols.filter((s) => !symbols.has(s));

  if (stockCount < check.minStocks || missingBenchmarks.length > 0 || symbols.size !== entries.length) {
    failed = true;
    console.error(`FAIL ${check.file}: ${stockCount} stocks, ${entries.length} total`);
    if (stockCount < check.minStocks) console.error(`  expected at least ${check.minStocks} stocks`);
    if (missingBenchmarks.length > 0) console.error(`  missing benchmarks: ${missingBenchmarks.join(', ')}`);
    if (symbols.size !== entries.length) console.error('  duplicate symbols found');
  } else {
    console.log(`OK   ${check.file}: ${stockCount} stocks, ${entries.length} total`);
  }
}

if (failed) process.exit(1);
