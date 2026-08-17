'use client';

import { CategoryBarChart, ReceivedDonut } from '@/components/charts';
import { DataTable, type Column } from '@/components/data-table';
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import type { DatasetSummary, ReceivableTableRow } from '@/lib/dashboard/queries';
import { formatPercent } from '@/lib/format/number';

export function ReceivableView({
  rows,
  summary,
}: {
  rows: ReceivableTableRow[];
  summary: DatasetSummary;
}) {
  const columns: Column<ReceivableTableRow>[] = [
    { key: 'project', header: 'Project', value: (r) => r.projectName ?? 'Unassigned' },
    { key: 'category', header: 'Type', value: (r) => r.category },
    { key: 'customer', header: 'Customer', value: (r) => r.customer ?? '—' },
    { key: 'unit', header: 'Unit', value: (r) => r.unit ?? '—' },
    { key: 'contractual', header: 'Contractual', numeric: true, value: (r) => r.contractual },
    { key: 'received', header: 'Received', numeric: true, value: (r) => r.received },
    { key: 'outstanding', header: 'Outstanding', numeric: true, value: (r) => r.outstanding },
    {
      key: 'percent',
      header: 'Collected %',
      value: (r) => r.percent,
      render: (r) => <span className="tnum">{r.percent === null ? '—' : formatPercent(r.percent, 1)}</span>,
    },
    { key: 'file', header: 'Source File', value: (r) => r.sourceFile ?? '—', defaultHidden: true },
    { key: 'sheet', header: 'Sheet', value: (r) => r.sourceSheet ?? '—', defaultHidden: true },
    {
      key: 'cell',
      header: 'Cell',
      value: (r) => r.sourceCell ?? '—',
      render: (r) => <span className="font-mono text-xs">{r.sourceCell ?? '—'}</span>,
      defaultHidden: true,
    },
  ];

  const hasData = summary.receivedTotal + summary.outstandingTotal > 0;

  return (
    <>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Received vs outstanding" subtitle="Collection rate across all contracts" />
          {hasData ? (
            <ReceivedDonut received={summary.receivedTotal} outstanding={summary.outstandingTotal} />
          ) : (
            <EmptyState title="No receivable records" description="Nothing to show for this period." />
          )}
        </Card>

        <Card>
          <CardHeader title="Outstanding by type" />
          {summary.receivableByCategory.length > 0 ? (
            <CategoryBarChart data={summary.receivableByCategory} horizontal />
          ) : (
            <EmptyState title="No receivable records" description="Nothing to show for this period." />
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Receivable detail"
          subtitle="Grouped by type, with subtotals and a grand total. Enable the source columns to see where each figure came from."
        />
        <DataTable
          rows={rows}
          columns={columns}
          groupBy="category"
          exportName="receivable-detail"
          emptyMessage="No receivable records were imported for this period."
        />
      </Card>
    </>
  );
}
