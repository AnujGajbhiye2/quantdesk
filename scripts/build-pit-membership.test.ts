import { describe, it, expect } from 'vitest';
import { parseChangesTable } from './build-pit-membership';

// Real fragment shape from https://en.wikipedia.org/wiki/List_of_S%26P_500_companies
// table id="changes" (captured 2026-07-02): two header rows, then data rows of
// Date | Added Ticker | Added Security | Removed Ticker | Removed Security | Reason.
const FIXTURE = `
<tr>
<th data-sort-type="date" rowspan="2">Effective Date
</th>
<th colspan="2">Added
</th>
<th colspan="2">Removed
</th>
<th rowspan="2">Reason
</th>
</tr>
<tr>
<th>Ticker</th>
<th>Security</th>
<th>Ticker</th>
<th>Security
</th>
</tr>
<tr>
<td>June 30, 2026</td>
<td></td>
<td></td>
<td>CAG</td>
<td><a href="/wiki/Conagra_Brands" title="Conagra Brands">Conagra Brands</a></td>
<td>Market capitalization change.<sup>[6]</sup>
</td>
</tr>
<tr>
<td>June 29, 2026</td>
<td>HONA</td>
<td><a href="/wiki/Honeywell_Aerospace" title="Honeywell Aerospace">Honeywell Aerospace</a></td>
<td></td>
<td></td>
<td>S&amp;P 500 constituent <a href="/wiki/Honeywell" title="Honeywell">Honeywell</a> spun off Honeywell Aerospace.<sup>[6]</sup>
</td>
</tr>
`;

describe('parseChangesTable', () => {
  it('extracts added and removed events, skipping header rows', () => {
    const changes = parseChangesTable(FIXTURE);
    expect(changes).toHaveLength(2);
  });

  it('parses a removed-only row', () => {
    const changes = parseChangesTable(FIXTURE);
    const removed = changes.find((c) => c.symbol === 'CAG');
    expect(removed).toEqual({ effectiveDate: '2026-06-30', symbol: 'CAG', action: 'removed' });
  });

  it('parses an added-only row', () => {
    const changes = parseChangesTable(FIXTURE);
    const added = changes.find((c) => c.symbol === 'HONA');
    expect(added).toEqual({ effectiveDate: '2026-06-29', symbol: 'HONA', action: 'added' });
  });

  it('parses a row with both an addition and a removal on the same date', () => {
    const html = `
<tr>
<td>May 19, 2025</td>
<td>DASH</td>
<td><a href="/wiki/DoorDash">DoorDash</a></td>
<td>TFX</td>
<td><a href="/wiki/Teleflex">Teleflex</a></td>
<td>Market cap change.</td>
</tr>`;
    const changes = parseChangesTable(html);
    expect(changes).toEqual([
      { effectiveDate: '2025-05-19', symbol: 'DASH', action: 'added' },
      { effectiveDate: '2025-05-19', symbol: 'TFX', action: 'removed' },
    ]);
  });

  it('ignores malformed date rows without throwing', () => {
    const html = `
<tr>
<td>not-a-date</td>
<td>ZZZ</td>
<td>Some Co</td>
<td></td>
<td></td>
<td>reason</td>
</tr>`;
    expect(() => parseChangesTable(html)).not.toThrow();
    expect(parseChangesTable(html)).toEqual([]);
  });
});
