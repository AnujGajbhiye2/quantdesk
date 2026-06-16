/**
 * Build universe JSON files from live sources.
 *
 * Usage:
 *   npm run build-universe
 *   npm run build-universe -- --only sp500
 *   npm run build-universe -- --only nifty200
 *   npm run build-universe -- --only stoxx600
 *
 * Outputs:
 *   scripts/universe/sp500.json     - S&P 500 constituents (from Wikipedia)
 *   scripts/universe/nifty200.json  - NIFTY 200 constituents (from NSE India CSV)
 *   scripts/universe/stoxx600.json  - STOXX Europe 600 constituents (from Wikipedia)
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
// Shared helpers
// ---------------------------------------------------------------------------

function extractText(cell: string): string {
  return cell
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#160;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();
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

// ---------------------------------------------------------------------------
// STOXX Europe 600 from Wikipedia
// ---------------------------------------------------------------------------

// Maps the country column in the Wikipedia STOXX 600 table to Yahoo Finance
// exchange suffix and the primary trading currency. Countries with no clear
// Yahoo suffix are omitted (Bermuda, Israel) and logged during build.
const STOXX_COUNTRY_MAP: Record<string, { suffix: string; currency: string; exchange: string }> = {
  'United Kingdom': { suffix: '.L',  currency: 'GBP', exchange: 'LSE'   },
  'Germany':        { suffix: '.DE', currency: 'EUR', exchange: 'XETRA' },
  'France':         { suffix: '.PA', currency: 'EUR', exchange: 'EPA'   },
  'Switzerland':    { suffix: '.SW', currency: 'CHF', exchange: 'SIX'   },
  'Sweden':         { suffix: '.ST', currency: 'SEK', exchange: 'OMX'   },
  'Netherlands':    { suffix: '.AS', currency: 'EUR', exchange: 'AEX'   },
  'Spain':          { suffix: '.MC', currency: 'EUR', exchange: 'BME'   },
  'Italy':          { suffix: '.MI', currency: 'EUR', exchange: 'BIT'   },
  'Belgium':        { suffix: '.BR', currency: 'EUR', exchange: 'EBR'   },
  'Finland':        { suffix: '.HE', currency: 'EUR', exchange: 'HEL'   },
  'Norway':         { suffix: '.OL', currency: 'NOK', exchange: 'OSL'   },
  'Denmark':        { suffix: '.CO', currency: 'DKK', exchange: 'CPH'   },
  'Austria':        { suffix: '.VI', currency: 'EUR', exchange: 'VIE'   },
  'Ireland':        { suffix: '.IR', currency: 'EUR', exchange: 'ISE'   },
  'Portugal':       { suffix: '.LS', currency: 'EUR', exchange: 'ELI'   },
  'Luxembourg':     { suffix: '.LU', currency: 'EUR', exchange: 'LUX'   },
  'Poland':         { suffix: '.WA', currency: 'PLN', exchange: 'WSE'   },
  'Greece':         { suffix: '.AT', currency: 'EUR', exchange: 'ATHEX' },
};

async function buildStoxx600(): Promise<UniverseEntry[]> {
  console.log('Fetching STOXX Europe 600 from Wikipedia...');

  const url = 'https://en.wikipedia.org/wiki/STOXX_Europe_600';
  const html = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QuantDesk/1.0)' },
  }).then((r) => r.text());

  // Find all wikitables; the constituent table (Ticker | Company | ICB Sector | Country | HQ)
  // is identified by having "Ticker" as its first header cell.
  const wikitableRe = /<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/g;
  let constituentHtml: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = wikitableRe.exec(html)) !== null) {
    const inner = m[1];
    const firstRow = (inner.match(/<tr[^>]*>([\s\S]*?)<\/tr>/) ?? [])[1] ?? '';
    if (/ticker/i.test(extractText(firstRow))) {
      constituentHtml = inner;
      break;
    }
  }

  if (!constituentHtml) {
    throw new Error('Could not find STOXX 600 constituent table on Wikipedia (no table with "Ticker" header found)');
  }

  const rows = constituentHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) ?? [];
  const entries: UniverseEntry[] = [];
  const skipped: string[] = [];

  for (const row of rows.slice(1)) { // skip header row
    const cells = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g) ?? [];
    if (cells.length < 4) continue;

    const ticker  = extractText(cells[0] ?? '').replace(/\n/g, '').trim();
    const name    = extractText(cells[1] ?? '').trim();
    const country = extractText(cells[3] ?? '').trim();

    if (!ticker || !name) continue;

    const mapped = STOXX_COUNTRY_MAP[country];
    if (!mapped) {
      skipped.push(`${ticker} (${country})`);
      continue;
    }

    entries.push({
      symbol:     `${ticker}${mapped.suffix}`,
      name,
      assetClass: 'equity',
      currency:   mapped.currency,
      exchange:   mapped.exchange,
      providerId: 'yahoo',
    });
  }

  if (skipped.length > 0) {
    console.log(`  Skipped ${skipped.length} entries with no Yahoo mapping: ${skipped.join(', ')}`);
  }

  // Add STOXX Europe 600 index benchmark
  entries.push({
    symbol:     '^STOXX',
    name:       'STOXX Europe 600 Index',
    assetClass: 'index',
    currency:   'EUR',
    exchange:   'STOXX',
    providerId: 'yahoo',
  });

  if (entries.length < 450) {
    throw new Error(`Expected at least 450 STOXX 600 entries, got ${entries.length - 1} (check Wikipedia page structure)`);
  }

  console.log(`  Found ${entries.length - 1} STOXX Europe 600 stocks + 1 index benchmark`);
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
    { name: 'stoxx600', fn: buildStoxx600, file: `${outDir}/stoxx600.json` },
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
