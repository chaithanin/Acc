'use client';

import { DataTable, type Column } from '@/components/data-table';
import { Badge } from '@/components/ui/primitives';

export interface IssueRow {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  file: string | null;
  sheet: string | null;
  row: number | null;
  cell: string | null;
}

/** Import problems, pinned to the exact file, sheet, row and cell. */
export function IssueTable({ rows }: { rows: IssueRow[] }) {
  const columns: Column<IssueRow>[] = [
    {
      key: 'severity',
      header: 'Severity',
      value: (r) => r.severity,
      render: (r) => <SeverityBadge severity={r.severity} />,
      width: '110px',
    },
    { key: 'code', header: 'Code', value: (r) => r.code },
    { key: 'file', header: 'File', value: (r) => r.file ?? '—' },
    { key: 'sheet', header: 'Sheet', value: (r) => r.sheet ?? '—' },
    {
      key: 'location',
      header: 'Row / Cell',
      value: (r) => r.cell ?? (r.row !== null ? `Row ${r.row}` : ''),
      render: (r) => (
        <span className="font-mono text-xs">
          {r.cell ?? (r.row !== null ? `Row ${r.row}` : '—')}
        </span>
      ),
    },
    { key: 'message', header: 'Detail', value: (r) => r.message },
  ];

  return <DataTable rows={rows} columns={columns} exportName="import-issues" pageSize={30} />;
}

function SeverityBadge({ severity }: { severity: IssueRow['severity'] }) {
  if (severity === 'error') {
    return (
      <Badge tone="critical" icon={<span aria-hidden>▲</span>}>
        Error
      </Badge>
    );
  }
  if (severity === 'warning') {
    return (
      <Badge tone="warning" icon={<span aria-hidden>◆</span>}>
        Warning
      </Badge>
    );
  }
  return <Badge tone="info">Info</Badge>;
}
