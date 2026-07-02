/**
 * Scrape point-in-time S&P 500 index membership from Wikipedia's "Selected
 * changes to the list of S&P 500 components" table and load it into the
 * index_membership_changes DB table.
 *
 * This is the free, standard approach to removing survivorship bias from a
 * backtest universe (see SYSTEM_AUDIT_AND_ROADMAP.md Phase 1): Wikipedia's
 * revision-tracked changes table lets us reconstruct what the index looked
 * like on any past date by replaying changes backward from today's
 * constituent list (see src/core/data/pit-membership.ts for the replay
 * logic). Coverage is reasonably complete back to the late 1990s for the
 * S&P 500; older history and full delisted-name price data would require a
 * paid vendor (e.g. EODHD) - out of scope here.
 *
 * Usage:
 *   npm run build-pit-membership
 *
 * Run via: tsx --conditions=react-server scripts/build-pit-membership.ts
 * (--conditions=react-server: same reason as scripts/ingest.ts - resolves
 * the 'server-only' import to a no-op outside a Next.js render context.)
 */

import { replaceMembershipChanges, type MembershipChange } from '../src/core/db/membership';

const MONTHS: Record<string, string> = {
  January: '01', February: '02', March: '03', April: '04',
  May: '05', June: '06', July: '07', August: '08',
  September: '09', October: '10', November: '11', December: '12',
};

/** Parse Wikipedia's "June 30, 2026" date format to 'YYYY-MM-DD'. */
function parseWikiDate(text: string): string | null {
  const m = text.trim().match(/^(\w+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (!month) return null;
  const day = m[2].padStart(2, '0');
  return `${m[3]}-${month}-${day}`;
}

function extractText(cell: string): string {
  return cell
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#160;/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Parse the "changes" table HTML into a flat change ledger. Table columns
 * (after the two header rows): Date | Added Ticker | Added Security |
 * Removed Ticker | Removed Security | Reason.
 */
export function parseChangesTable(tableHtml: string): MembershipChange[] {
  const rows = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g) ?? [];
  const changes: MembershipChange[] = [];

  for (const row of rows) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g);
    if (!cells || cells.length < 4) continue; // header rows have <th>, not <td>

    const dateText     = extractText(cells[0] ?? '');
    const addedTicker  = extractText(cells[1] ?? '');
    const removedTicker = extractText(cells[3] ?? '');

    const effectiveDate = parseWikiDate(dateText);
    if (!effectiveDate) continue;

    if (addedTicker) {
      changes.push({ effectiveDate, symbol: addedTicker, action: 'added' });
    }
    if (removedTicker) {
      changes.push({ effectiveDate, symbol: removedTicker, action: 'removed' });
    }
  }

  return changes;
}

async function main() {
  console.log('Fetching S&P 500 membership changes from Wikipedia...');

  const url = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
  const html = await fetch(url).then((r) => r.text());

  const tableMatch = html.match(/<table[^>]*id="changes"[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) {
    throw new Error('Could not find the S&P 500 "changes" table in Wikipedia HTML');
  }

  const changes = parseChangesTable(tableMatch[1]);
  if (changes.length < 100) {
    throw new Error(`Expected at least 100 membership change rows, got ${changes.length} - Wikipedia page structure may have changed`);
  }

  console.log(`  Parsed ${changes.length} membership change events.`);
  replaceMembershipChanges('sp500', changes);
  console.log(`  Loaded into index_membership_changes (index_name='sp500').`);
}

// Guard against running main() as a side effect of importing parseChangesTable
// for tests - only run when this file is executed directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
