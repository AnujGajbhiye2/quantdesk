'use client';

/**
 * DataTable — themed headless wrapper around TanStack Table v8.
 *
 * Design tokens match all existing tables exactly:
 *   - borderCollapse collapse, font var(--fs-sm) (or --fs-xs for dense prop)
 *   - Header: color var(--text-muted), weight 400; active sort col weight 700 + ' v'/' ^' suffix
 *   - Rows: borderBottom 1px solid var(--border); selected row bg var(--bg-panel-header)
 *   - Symbol cells: var(--color-accent) weight 600 (apply via meta.accent + meta.clickable)
 *   - Numeric cells: textAlign right + fontVariantNumeric tabular-nums
 *
 * Usage:
 *   const columns = useMemo<ColumnDef<MyRow>[]>(() => [...], []);
 *   <DataTable columns={columns} data={rows} enableSorting enableFilters toolbar={...} />
 *
 * Column meta extensions (TypeScript augmented in types.ts at bottom):
 *   meta.align    'left' | 'center' | 'right'   — default 'left'
 *   meta.accent   boolean                        — accent color + weight 600
 *   meta.numeric  boolean                        — tabular-nums + right align
 */

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type FilterFn,
} from '@tanstack/react-table';
import { useCallback, useState } from 'react';

// --------------------------------------------------------------------------
// Custom filter functions
// --------------------------------------------------------------------------

/** Boolean column filter: value=true shows only truthy rows. */
export const boolFilter: FilterFn<unknown> = (row, columnId, filterValue: boolean) => {
  if (filterValue === undefined || filterValue === null) return true;
  return Boolean(row.getValue(columnId)) === filterValue;
};
boolFilter.autoRemove = (val: unknown) => val === undefined || val === null;

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface DataTableProps<TData> {
  columns:       ColumnDef<TData, unknown>[];
  data:          TData[];
  /** Enable header-click column sorting. Default false. */
  enableSorting?:    boolean;
  /** Enable column-level filtering. Default false. */
  enableFilters?:    boolean;
  /** Initial sort state. */
  defaultSort?:      SortingState;
  /** Slot above the table (filter controls, action buttons, etc.). */
  toolbar?:          React.ReactNode;
  /** Use var(--fs-xs) and tighter padding for compact view. Default false. */
  dense?:            boolean;
  /** Row-level background color override (receives row data). */
  rowStyle?:         (row: TData, idx: number) => React.CSSProperties;
  /** Currently selected row index (-1 = none). */
  selectedRow?:      number;
  /** Fired when a row is clicked. */
  onRowClick?:       (row: TData, idx: number) => void;
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export function DataTable<TData>({
  columns,
  data,
  enableSorting  = false,
  enableFilters  = false,
  defaultSort    = [],
  toolbar,
  dense          = false,
  rowStyle,
  selectedRow    = -1,
  onRowClick,
}: DataTableProps<TData>) {
  const [sorting,        setSorting]        = useState<SortingState>(defaultSort);
  const [columnFilters,  setColumnFilters]  = useState<ColumnFiltersState>([]);

  const table = useReactTable({
    data,
    columns,
    filterFns: { boolFilter },
    state:     { sorting, columnFilters },
    onSortingChange:       setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel:       getCoreRowModel(),
    getSortedRowModel:     enableSorting  ? getSortedRowModel()  : undefined,
    getFilteredRowModel:   enableFilters  ? getFilteredRowModel() : undefined,
    enableSorting,
    enableFilters,
  });

  const fontSize   = dense ? 'var(--fs-xs)' : 'var(--fs-sm)';
  const cellPad    = dense ? '2px 4px' : '3px 6px';

  const sortIcon = useCallback((col: ReturnType<typeof table.getColumn>) => {
    if (!col || !enableSorting) return '';
    const sorted = col.getIsSorted();
    if (sorted === 'asc')  return ' ^';
    if (sorted === 'desc') return ' v';
    return '';
  }, [enableSorting, table]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {toolbar && (
        <div style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {toolbar}
        </div>
      )}
      <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1 }}>
        <table
          style={{
            width:           '100%',
            borderCollapse:  'collapse',
            fontSize,
            fontFamily:      'var(--font-mono)',
          }}
        >
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr
                key={hg.id}
                style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}
              >
                {hg.headers.map((header) => {
                  const col       = header.column;
                  const canSort   = enableSorting && col.getCanSort();
                  const isSorted  = col.getIsSorted();
                  const meta      = (col.columnDef.meta ?? {}) as Record<string, unknown>;
                  const align     = (meta.align as string | undefined) ?? 'left';
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      title={canSort ? 'click to sort' : undefined}
                      style={{
                        textAlign:   align as React.CSSProperties['textAlign'],
                        padding:     cellPad,
                        fontWeight:  isSorted ? 700 : 400,
                        cursor:      canSort ? 'pointer' : undefined,
                        userSelect:  'none',
                        whiteSpace:  'nowrap',
                      }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(col.columnDef.header, header.getContext())}
                      {sortIcon(col)}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, idx) => {
              const isSelected = idx === selectedRow;
              const extra      = rowStyle ? rowStyle(row.original, idx) : {};
              return (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original, idx) : undefined}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    background:   isSelected ? 'var(--bg-panel-header)' : 'transparent',
                    cursor:       onRowClick ? 'pointer' : undefined,
                    ...extra,
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta    = (cell.column.columnDef.meta ?? {}) as Record<string, unknown>;
                    const align   = (meta.align   as string  | undefined) ?? 'left';
                    const accent  = (meta.accent  as boolean | undefined) ?? false;
                    const numeric = (meta.numeric as boolean | undefined) ?? false;
                    return (
                      <td
                        key={cell.id}
                        style={{
                          padding:           cellPad,
                          textAlign:         align as React.CSSProperties['textAlign'],
                          color:             accent ? 'var(--color-accent)' : undefined,
                          fontWeight:        accent ? 600 : undefined,
                          fontVariantNumeric: numeric ? 'tabular-nums' : undefined,
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// TypeScript augmentation for column meta
// --------------------------------------------------------------------------

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    align?:   'left' | 'center' | 'right';
    accent?:  boolean;
    numeric?: boolean;
  }
}
