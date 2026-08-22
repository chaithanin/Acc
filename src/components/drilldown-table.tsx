'use client';

import { formatDateTime, formatTHB } from '@/lib/format/number';
import type { DrilldownRow } from '@/lib/db/repositories/drilldown';
import { DataTable, type Column } from './data-table';
import { EmptyState } from './ui/primitives';

export interface DrilldownResponse {
  supported: boolean;
  label: string;
  rows: DrilldownRow[];
  /** The total of every contributing record, not only the rows listed. */
  total: number;
  recordCount?: number;
  truncated?: boolean;
  error?: string;
}

/**
 * The audit trail behind a KPI (requirement 16).
 *
 * Every row names the project, the amount and — the point of the whole
 * exercise — the file, sheet and cell it was read from, plus the Excel formula
 * when the source cell held one.
 */
export function DrilldownTable({ data }: { data: DrilldownResponse }) {
  if (data.error) {
    return <EmptyState title="Details unavailable" description={data.error} />;
  }

  if (!data.supported) {
    return (
      <EmptyState
        title="No record-level detail for this figure"
        description="This KPI is derived from other KPIs rather than read from records directly. Open the calculation to see which figures feed it, then drill into those."
      />
    );
  }

  if (data.rows.length === 0) {
    return (
      <EmptyState
        title="No contributing records"
        description="Nothing in this snapshot contributes to this figure."
      />
    );
  }

  const recordCount = data.recordCount ?? data.rows.length;

  const columns: Column<DrilldownRow>[] = [
    { key: 'project', header: 'Project', value: (r) => r.projectName ?? 'Unassigned' },
    { key: 'category', header: 'Category', value: (r) => r.category },
    { key: 'description', header: 'Description', value: (r) => r.description ?? '—' },
    { key: 'amount', header: 'Amount', numeric: true, value: (r) => r.amount },
    { key: 'file', header: 'Source File', value: (r) => r.sourceFile ?? '—' },
    { key: 'sheet', header: 'Sheet', value: (r) => r.sourceSheet ?? '—' },
    {
      key: 'cell',
      header: 'Row / Cell',
      value: (r) => r.sourceCell ?? (r.sourceRow ? `Row ${r.sourceRow}` : '—'),
      render: (r) => (
        <span className="font-mono text-xs">
          {r.sourceCell ?? (r.sourceRow ? `Row ${r.sourceRow}` : '—')}
        </span>
      ),
    },
    {
      key: 'formula',
      header: 'Source Formula',
      value: (r) => r.sourceFormula ?? '',
      render: (r) =>
        r.sourceFormula ? (
          <span className="font-mono text-xs text-ink-secondary">={r.sourceFormula}</span>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
      defaultHidden: true,
    },
    {
      key: 'imported',
      header: 'Import Date',
      value: (r) => r.importedAt ?? '',
      render: (r) => formatDateTime(r.importedAt),
      defaultHidden: true,
    },
  ];

  return (
    <div>
      <p className="mb-3 text-sm text-ink-secondary">
        {data.label} — {recordCount} record{recordCount === 1 ? '' : 's'} totalling{' '}
        <span className="tnum font-medium text-ink">{formatTHB(data.total)}</span>
      </p>

      {/* The total above is every record's; the table is the largest few. Said
          plainly, because a table that foots to less than its own heading is
          read as a wrong number rather than as a shortened list. */}
      {data.truncated ? (
        <p className="mb-3 rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-ink-secondary">
          Showing the {data.rows.length} largest of {recordCount} records. The total above covers all
          of them; export to see every row.
        </p>
      ) : null}
      <DataTable
        rows={data.rows}
        columns={columns}
        pageSize={20}
        exportName="kpi-drilldown"
        initialSort={{ key: 'amount', direction: 'desc' }}
      />
    </div>
  );
}
