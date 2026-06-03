/**
 * Build universe JSON files from live sources.
 *
 * Usage:
 *   npm run build-universe
 *   npm run build-universe -- --only sp500
 *   npm run build-universe -- --only nifty200
 *
 * Outputs:
 *   scripts/universe/sp500.json     - S&P 500 constituents (from Wikipedia)
 *   scripts/universe/nifty200.json  - NIFTY 200 constituents (from NSE India CSV)
 *
 * Run periodically (e.g. quarterly) to refresh index membership.
 * If a live fetch fails, the existing file is preserved.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface UniverseEntry {
  symbol:     string;
  name:       string;
  assetClass: string;
  currency:   string;
  exchange?:  string;
  providerId: string;
}

// ---------------------------------------------------------------------------
// S&P 500 from Wikipedia
// ---------------------------------------------------------------------------

async function buildSP500(): Promise<UniverseEntry[]> {
  console.log('Fetching S&P 500 from Wikipedia...');

  const url = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
  const html = await fetch(url).then((r) => r.text());

  // Parse the first wikitable (constituents table)
  // Table structure: Symbol | Security | GICS Sector | ... | Exchange
  const tableMatch = html.match(/<table[^>]*id="constituents"[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) throw new Error('Could not find S&P 500 constituents table in Wikipedia HTML');

  const rows = tableMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) ?? [];
  const entries: UniverseEntry[] = [];

  for (const row of rows.slice(1)) { // skip header
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? [];
    if (cells.length < 2) continue;

    const extractText = (cell: string) => cell
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&#160;/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .trim();

    const rawSymbol = extractText(cells[0] ?? '').replace(/\n/g, '').trim();
    const name      = extractText(cells[1] ?? '').trim();
    // Some symbols use dots (BRK.B -> BRK-B on Yahoo)
    const symbol    = rawSymbol.replace('.', '-');

    if (!symbol || !name) continue;

    entries.push({
      symbol,
      name,
      assetClass: 'equity',
      currency:   'USD',
      exchange:   'NYSE',  // approximate; Yahoo resolves the real exchange
      providerId: 'yahoo',
    });
  }

  // Add index benchmarks
  entries.push({ symbol: '^GSPC', name: 'S&P 500 Index',           assetClass: 'index', currency: 'USD', exchange: 'SNP', providerId: 'yahoo' });
  entries.push({ symbol: '^IXIC', name: 'NASDAQ Composite',         assetClass: 'index', currency: 'USD', exchange: 'NMS', providerId: 'yahoo' });
  entries.push({ symbol: '^DJI',  name: 'Dow Jones Industrial Avg', assetClass: 'index', currency: 'USD', exchange: 'DJI', providerId: 'yahoo' });

  if (entries.length < 503) {
    throw new Error(`Expected at least 500 S&P constituents + 3 benchmarks, got ${entries.length}`);
  }

  console.log(`  Found ${entries.length - 3} S&P 500 stocks + 3 index benchmarks`);
  return entries;
}

// ---------------------------------------------------------------------------
// NIFTY 200 from NSE India CSV
// ---------------------------------------------------------------------------

async function buildNifty200(): Promise<UniverseEntry[]> {
  console.log('Fetching NIFTY 200 from NSE India...');

  // NSE provides downloadable CSV files; try the indices bhavocopy URL
  const urls = [
    'https://archives.nseindia.com/content/indices/ind_nifty200list.csv',
    'https://nseindia.com/content/indices/ind_nifty200list.csv',
  ];

  let csv = '';
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuantDesk/1.0)' },
      });
      if (res.ok) {
        csv = await res.text();
        break;
      }
    } catch {
      // try next URL
    }
  }

  if (!csv) {
    throw new Error('Could not fetch NIFTY 200 CSV from NSE India. The file may have moved; update the URL in build-universe.ts.');
  }

  // CSV format: Company Name,Industry,Symbol,Series,ISIN Code
  const lines  = csv.split('\n').filter(Boolean);
  const entries: UniverseEntry[] = [];

  for (const line of lines.slice(1)) { // skip header
    const cols = parseCsvLine(line);
    if (cols.length < 3) continue;
    const name   = cols[0];
    const symbol = cols[2];
    if (!symbol || !name || symbol === 'Symbol') continue;

    entries.push({
      symbol:     `${symbol}.NS`,  // Yahoo Finance NSE suffix
      name,
      assetClass: 'equity',
      currency:   'INR',
      exchange:   'NSE',
      providerId: 'yahoo',
    });
  }

  if (entries.length < 200) {
    throw new Error(`Expected 200 NIFTY 200 constituents, got ${entries.length}`);
  }

  // Add NIFTY indices
  entries.push({ symbol: '^NSEI', name: 'NIFTY 50 Index', assetClass: 'index', currency: 'INR', exchange: 'NSE', providerId: 'yahoo' });
  entries.push({ symbol: '^NSEMDCP50.NS', name: 'NIFTY Midcap 50 Index', assetClass: 'index', currency: 'INR', exchange: 'NSE', providerId: 'yahoo' });

  console.log(`  Found ${entries.length - 2} NIFTY 200 stocks + 2 index benchmarks`);
  return entries;
}

function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && quoted && next === '"') {
      cur += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols.map((c) => c.replace(/^"|"$/g, '').trim());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const only = args.find((_, i) => args[i - 1] === '--only');
  const outDir = resolve(process.cwd(), 'scripts/universe');

  const tasks: { name: string; fn: () => Promise<UniverseEntry[]>; file: string }[] = [
    { name: 'sp500',    fn: buildSP500,    file: `${outDir}/sp500.json`    },
    { name: 'nifty200', fn: buildNifty200, file: `${outDir}/nifty200.json` },
  ].filter((t) => !only || t.name === only);

  for (const task of tasks) {
    const backup = task.file.replace('.json', '.bak.json');
    try {
      // Backup existing file
      if (existsSync(task.file)) {
        writeFileSync(backup, readFileSync(task.file, 'utf-8'));
      }
      const entries = await task.fn();
      writeFileSync(task.file, JSON.stringify(entries, null, 2) + '\n');
      console.log(`  Wrote ${task.file} (${entries.length} entries)`);
    } catch (err) {
      console.error(`  FAILED ${task.name}: ${err instanceof Error ? err.message : String(err)}`);
      // Restore backup if it exists
      if (existsSync(backup)) {
        writeFileSync(task.file, readFileSync(backup, 'utf-8'));
        console.log(`  Restored backup for ${task.name}`);
      }
    }
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
