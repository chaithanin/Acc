'use client';

import { DataTable, type Column } from '@/components/data-table';
import { Badge } from '@/components/ui/primitives';

export interface ValidationRow {
  rule: string;
  scope: string;
  project: string | null;
  expected: number | null;
  imported: number | null;
  difference: number | null;
  status: 'pass' | 'warning' | 'error' | 'skipped';
  message: string;
}

export function ValidationTable({ rows }: { rows: ValidationRow[] }) {
  const columns: Column<ValidationRow>[] = [
    {
      key: 'status',
      header: 'Status',
      value: (r) => r.status,
      render: (r) => <StatusBadge status={r.status} />,
      width: '120px',
    },
    { key: 'rule', header: 'Rule', value: (r) => r.rule },
    { key: 'scope', header: 'Scope', value: (r) => r.scope },
    { key: 'project', header: 'Project', value: (r) => r.project ?? 'All projects' },
    { key: 'expected', header: 'Expected', numeric: true, value: (r) => r.expected },
    { key: 'imported', header: 'Imported', numeric: true, value: (r) => r.imported },
    { key: 'difference', header: 'Difference', numeric: true, value: (r) => r.difference },
    { key: 'message', header: 'Detail', value: (r) => r.message },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      exportName="reconciliation"
      pageSize={30}
      // Failures first: the point of the page is what is wrong.
      initialSort={{ key: 'difference', direction: 'desc' }}
    />
  );
}

function StatusBadge({ status }: { status: ValidationRow['status'] }) {
  if (status === 'error') {
    return (
      <Badge tone="critical" icon={<span aria-hidden>▲</span>}>
        Failed
      </Badge>
    );
  }
  if (status === 'warning') {
    return (
      <Badge tone="warning" icon={<span aria-hidden>◆</span>}>
        Warning
      </Badge>
    );
  }
  if (status === 'skipped') {
    return <Badge tone="neutral">Not applicable</Badge>;
  }
  return (
    <Badge tone="good" icon={<span aria-hidden>●</span>}>
      Reconciled
    </Badge>
  );
}
