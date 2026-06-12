'use client';

import { useMemo, useState } from 'react';

/**
 * Generic header-click sorting for terminal tables.
 *
 * Usage:
 *   const { sorted, sortKey, sortDir, clickHeader } = useTableSort(rows, {
 *     symbol: (r) => r.symbol,         // string accessor -> localeCompare
 *     changePct: (r) => r.changePct,   // number accessor -> numeric sort
 *   });
 *
 * - First click on a column: numbers sort descending (best first), strings ascending.
 * - Second click flips direction. Null/NaN values always sink to the bottom.
 * - sortKey === null -> original row order (no sort applied yet).
 */

export type SortAccessor<Row> = (row: Row) => string | number | null | undefined;
export type SortDir = 1 | -1;

export function useTableSort<Row, K extends string>(
  rows: readonly Row[],
  accessors: Record<K, SortAccessor<Row>>,
  initial?: { key: K; dir: SortDir },
) {
  const [sortKey, setSortKey] = useState<K | null>(initial?.key ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(initial?.dir ?? -1);

  function clickHeader(key: K) {
    if (key === sortKey) {
      setSortDir((d) => (d === 1 ? -1 : 1));
      return;
    }
    setSortKey(key);
    // Strings read naturally ascending; numbers best-first descending
    const probe = rows.length > 0 ? accessors[key](rows[0]) : null;
    setSortDir(typeof probe === 'string' ? 1 : -1);
  }

  const sorted = useMemo(() => {
    if (!sortKey) return [...rows];
    const accessor = accessors[sortKey];
    return [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      const aBad = av == null || (typeof av === 'number' && !isFinite(av));
      const bBad = bv == null || (typeof bv === 'number' && !isFinite(bv));
      if (aBad && bBad) return 0;
      if (aBad) return 1;
      if (bBad) return -1;
      if (typeof av === 'string' || typeof bv === 'string') {
        return sortDir * String(av).localeCompare(String(bv));
      }
      return sortDir * ((av as number) - (bv as number));
    });
    // accessors is a stable literal at every call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir]);

  /** ' v' / ' ^' suffix for the active column header. */
  function indicator(key: K): string {
    if (key !== sortKey) return '';
    return sortDir === -1 ? ' v' : ' ^';
  }

  return { sorted, sortKey, sortDir, clickHeader, indicator };
}
