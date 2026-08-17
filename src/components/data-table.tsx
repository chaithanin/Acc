'use client';

import { useMemo, useState } from 'react';
import { formatNumber, formatTHB, type DisplayMode } from '@/lib/format/number';
import { Button, Select, TextInput } from './ui/controls';
import { cx } from './ui/primitives';

/**
 * The shared data table (requirement 22).
 *
 * Search, sort, pagination, a column selector, a sticky header, subtotals, a
 * grand total, negative-number highlighting and CSV/Excel export — in one
 * place, so every table on every page behaves identically.
 */

export interface Column<T> {
  key: string;
  header: string;
  /** Right-aligned and totalled when true. */
  numeric?: boolean;
  /** Value used for sorting, searching and totals. */
  value: (row: T) => string | number | null;
  /** Optional custom rendering; defaults to the formatted value. */
  render?: (row: T) => React.ReactNode;
  /** Hidden until enabled in the column selector. */
  defaultHidden?: boolean;
  width?: string;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  /** Column key to group subtotals by. */
  groupBy?: string;
  displayMode?: DisplayMode;
  pageSize?: number;
  /** Base name for exported files. */
  exportName?: string;
  emptyMessage?: string;
  initialSort?: { key: string; direction: 'asc' | 'desc' };
}

export function DataTable<T>({
  rows,
  columns,
  groupBy,
  displayMode = 'full',
  pageSize = 25,
  exportName = 'export',
  emptyMessage = 'No records match the current filters.',
  initialSort,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)),
  );
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const visible = columns.filter((c) => !hidden.has(c.key));

  const filtered = useMemo(() => {
    if (!query.trim()) return rows;
    const needle = query.trim().toLowerCase();
    return rows.filter((row) =>
      columns.some((column) => {
        const value = column.value(row);
        return value !== null && String(value).toLowerCase().includes(needle);
      }),
    );
  }, [rows, columns, query]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return filtered;

    return [...filtered].sort((a, b) => {
      const av = column.value(a);
      const bv = column.value(b);
      // Blanks always sort last, whichever direction is active.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;

      const result =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sort.direction === 'asc' ? result : -result;
    });
  }, [filtered, columns, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  const grandTotals = useMemo(() => totalsFor(sorted, columns), [sorted, columns]);

  // Subtotals are computed over the whole filtered set, not just this page —
  // a subtotal that changed when you paged would be worse than none.
  const groups = useMemo(() => {
    if (!groupBy) return null;
    const column = columns.find((c) => c.key === groupBy);
    if (!column) return null;

    const map = new Map<string, T[]>();
    for (const row of sorted) {
      const key = String(column.value(row) ?? '—');
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()].map(([label, groupRows]) => ({
      label,
      rows: groupRows,
      totals: totalsFor(groupRows, columns),
    }));
  }, [sorted, columns, groupBy]);

  const format = (column: Column<T>, value: string | number | null) => {
    if (value === null) return '—';
    if (!column.numeric) return String(value);
    return typeof value === 'number' ? formatTHB(value, displayMode) : String(value);
  };

  const exportRows = () => sorted.map((row) =>
    Object.fromEntries(visible.map((c) => [c.header, c.value(row) ?? ''])),
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <TextInput
          type="search"
          placeholder="Search…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          className="w-56"
          aria-label="Search table"
        />

        <span className="text-xs text-ink-muted">
          {formatNumber(sorted.length)} of {formatNumber(rows.length)} rows
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="relative">
            <Button size="sm" onClick={() => setShowColumnPicker((v) => !v)}>
              Columns
            </Button>
            {showColumnPicker ? (
              <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-border bg-surface p-2 shadow-lg">
                {columns.map((column) => (
                  <label
                    key={column.key}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-hover"
                  >
                    <input
                      type="checkbox"
                      checked={!hidden.has(column.key)}
                      onChange={() =>
                        setHidden((prev) => {
                          const next = new Set(prev);
                          if (next.has(column.key)) next.delete(column.key);
                          else next.add(column.key);
                          return next;
                        })
                      }
                    />
                    {column.header}
                  </label>
                ))}
              </div>
            ) : null}
          </div>

          <Button size="sm" onClick={() => downloadCsv(exportRows(), exportName)}>
            CSV
          </Button>
          <Button size="sm" onClick={() => downloadExcel(exportRows(), exportName)}>
            Excel
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
        <table className="w-full min-w-max text-sm">
          <thead className="sticky top-0 z-10 bg-surface-sunken">
            <tr>
              {visible.map((column) => (
                <th
                  key={column.key}
                  style={column.width ? { width: column.width } : undefined}
                  className={cx(
                    'whitespace-nowrap border-b border-border px-3 py-2 text-xs font-semibold text-ink-secondary',
                    column.numeric ? 'text-right' : 'text-left',
                  )}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSort((prev) =>
                        prev?.key === column.key
                          ? { key: column.key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
                          : { key: column.key, direction: column.numeric ? 'desc' : 'asc' },
                      )
                    }
                    className="inline-flex items-center gap-1 hover:text-ink"
                  >
                    {column.header}
                    <span className="text-ink-muted">
                      {sort?.key === column.key ? (sort.direction === 'asc' ? '↑' : '↓') : ''}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={visible.length} className="px-3 py-10 text-center text-ink-muted">
                  {emptyMessage}
                </td>
              </tr>
            ) : groups ? (
              groups.map((group) => (
                <GroupBlock
                  key={group.label}
                  label={group.label}
                  rows={group.rows}
                  totals={group.totals}
                  columns={visible}
                  format={format}
                />
              ))
            ) : (
              pageRows.map((row, index) => (
                <Row key={index} row={row} columns={visible} format={format} />
              ))
            )}
          </tbody>

          {sorted.length > 0 ? (
            <tfoot>
              <tr className="border-t-2 border-border-strong bg-surface-sunken">
                {visible.map((column, index) => (
                  <td
                    key={column.key}
                    className={cx(
                      'px-3 py-2 text-xs font-semibold',
                      column.numeric ? 'tnum text-right' : 'text-left',
                    )}
                  >
                    {index === 0
                      ? 'Grand Total'
                      : column.numeric
                        ? formatTHB(grandTotals[column.key] ?? 0, displayMode)
                        : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {!groups && pageCount > 1 ? (
        <div className="mt-3 flex items-center justify-between text-xs text-ink-secondary">
          <span>
            Page {currentPage + 1} of {pageCount}
          </span>
          <div className="flex gap-1.5">
            <Button size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
              Previous
            </Button>
            <Button
              size="sm"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row<T>({
  row,
  columns,
  format,
}: {
  row: T;
  columns: Column<T>[];
  format: (column: Column<T>, value: string | number | null) => React.ReactNode;
}) {
  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface-hover">
      {columns.map((column) => {
        const value = column.value(row);
        const negative = column.numeric && typeof value === 'number' && value < 0;
        return (
          <td
            key={column.key}
            className={cx(
              'px-3 py-2',
              column.numeric ? 'tnum text-right' : 'text-left',
              // Negative figures are highlighted (requirement 22).
              negative ? 'text-delta-down' : 'text-ink',
            )}
          >
            {column.render ? column.render(row) : format(column, value)}
          </td>
        );
      })}
    </tr>
  );
}

function GroupBlock<T>({
  label,
  rows,
  totals,
  columns,
  format,
}: {
  label: string;
  rows: T[];
  totals: Record<string, number>;
  columns: Column<T>[];
  format: (column: Column<T>, value: string | number | null) => React.ReactNode;
}) {
  return (
    <>
      <tr className="bg-surface-sunken">
        <td colSpan={columns.length} className="px-3 py-1.5 text-xs font-semibold text-ink-secondary">
          {label}
        </td>
      </tr>
      {rows.map((row, index) => (
        <Row key={index} row={row} columns={columns} format={format} />
      ))}
      <tr className="border-b border-border-strong">
        {columns.map((column, index) => (
          <td
            key={column.key}
            className={cx(
              'px-3 py-1.5 text-xs font-medium text-ink-secondary',
              column.numeric ? 'tnum text-right' : 'text-left',
            )}
          >
            {index === 0 ? `Subtotal — ${label}` : column.numeric ? formatTHB(totals[column.key] ?? 0) : ''}
          </td>
        ))}
      </tr>
    </>
  );
}

function totalsFor<T>(rows: T[], columns: Column<T>[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const column of columns) {
    if (!column.numeric) continue;
    totals[column.key] = rows.reduce((sum, row) => {
      const value = column.value(row);
      return typeof value === 'number' ? sum + value : sum;
    }, 0);
  }
  return totals;
}

// ------------------------------------------------------------------ export

type ExportRow = Record<string, string | number>;

function csvEscape(value: string | number): string {
  const text = String(value ?? '');
  // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula;
  // prefixing an apostrophe keeps exported text inert.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function downloadCsv(rows: ExportRow[], name: string): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(',')),
  ];
  // The BOM makes Excel open UTF-8 Thai text correctly.
  download(`﻿${lines.join('\r\n')}`, `${name}.csv`, 'text/csv;charset=utf-8');
}

/**
 * Excel export as SpreadsheetML, which Excel and LibreOffice both open
 * natively — no client-side workbook library, so no parser ships to the browser.
 */
export function downloadExcel(rows: ExportRow[], name: string): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);

  const escapeXml = (value: string | number) =>
    String(value ?? '').replace(/[<>&'"]/g, (c) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!,
    );

  const cell = (value: string | number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? `<Cell><Data ss:Type="Number">${value}</Data></Cell>`
      : `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${escapeXml(name).slice(0, 31)}"><Table>
<Row>${headers.map((h) => `<Cell><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`).join('')}</Row>
${rows.map((row) => `<Row>${headers.map((h) => cell(row[h])).join('')}</Row>`).join('\n')}
</Table></Worksheet></Workbook>`;

  download(xml, `${name}.xls`, 'application/vnd.ms-excel');
}

function download(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
