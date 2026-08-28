'use client';

import { DataTable, type Column } from '@/components/data-table';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { formatDate, formatTHB } from '@/lib/format/number';
import type { PayableTableRow } from '@/lib/dashboard/queries';
import type { MetricComparison } from '@/lib/types';

/** Later buckets are worse. The scale is the severity, not decoration. */
const TONE: Record<string, string> = {
  payable_aged_current: 'bg-good',
  payable_aged_1_30: 'bg-good/60',
  payable_aged_31_60: 'bg-warning',
  payable_aged_61_90: 'bg-warning',
  payable_aged_91_120: 'bg-critical/70',
  payable_aged_120_plus: 'bg-critical',
};

function lateness(days: number | null) {
  if (days === null) return <span className="text-ink-muted">no due date</span>;
  if (days <= 0) return <span className="text-ink-secondary">{-days}d to go</span>;
  if (days > 90) return <Badge tone="critical">{days}d late</Badge>;
  if (days > 30) return <Badge tone="warning">{days}d late</Badge>;
  return <Badge tone="neutral">{days}d late</Badge>;
}

export function PayableView({
  rows,
  buckets,
  overdue,
  undated,
  payable,
  reportDate,
}: {
  rows: PayableTableRow[];
  buckets: MetricComparison[];
  overdue: MetricComparison | null;
  undated: MetricComparison | null;
  payable: number | null;
  reportDate: string;
}) {
  const columns: Column<PayableTableRow>[] = [
    { key: 'vendor', header: 'Vendor', value: (r) => r.vendor ?? '—' },
    { key: 'invoiceNo', header: 'Invoice', value: (r) => r.invoiceNo ?? '—' },
    { key: 'project', header: 'Project', value: (r) => r.projectName ?? 'Unassigned', defaultHidden: true },
    { key: 'description', header: 'For', value: (r) => r.description ?? '—', defaultHidden: true },
    { key: 'invoiceDate', header: 'Invoiced', value: (r) => r.invoiceDate ?? '', render: (r) => (r.invoiceDate ? formatDate(r.invoiceDate) : '—') },
    { key: 'dueDate', header: 'Due', value: (r) => r.dueDate ?? '', render: (r) => (r.dueDate ? formatDate(r.dueDate) : '—') },
    { key: 'late', header: 'Age', value: (r) => r.daysPastDue ?? 0, render: (r) => lateness(r.daysPastDue) },
    { key: 'invoice', header: 'Invoice', numeric: true, value: (r) => r.invoice },
    { key: 'paid', header: 'Paid', numeric: true, value: (r) => r.paid },
    { key: 'outstanding', header: 'Outstanding', numeric: true, value: (r) => r.outstanding },
    { key: 'file', header: 'Source', value: (r) => r.sourceFile ?? '—', defaultHidden: true },
  ];

  if (rows.length === 0) {
    return (
      <Card className="mt-4">
        <CardHeader title="Vendor payables" />
        <EmptyState
          title="No payable ledger has been imported"
          description="Import an accounts-payable or vendor ageing sheet and this fills in. Until then, Accounts Payable reads zero and Total Owed carries only the construction certified but unpaid and the payments already committed — which is what the company owes, less whatever is sitting on a supplier invoice."
        />
      </Card>
    );
  }

  const bucketTotal = buckets.reduce((sum, b) => sum + (b.current ?? 0), 0) + (undated?.current ?? 0);
  const widest = Math.max(...buckets.map((b) => Math.abs(b.current ?? 0)), 1);
  const foots = payable === null || Math.abs(bucketTotal - payable) <= 1;

  return (
    <>
      <Card className="mt-4">
        <CardHeader
          title="Ageing"
          subtitle={`Measured against ${formatDate(reportDate)}, the date of this snapshot — not against today.`}
          action={
            overdue?.current ? (
              <div className="text-right">
                <div className="text-lg font-semibold tabular-nums text-critical">
                  {formatTHB(overdue.current)}
                </div>
                <div className="text-[11px] uppercase tracking-wide text-ink-muted">overdue</div>
              </div>
            ) : (
              <span className="text-sm text-good">Nothing is overdue</span>
            )
          }
        />

        <div className="space-y-2">
          {buckets.map((bucket) => {
            const value = bucket.current ?? 0;
            const share = (Math.abs(value) / widest) * 100;
            return (
              <div key={bucket.key} className="grid grid-cols-[7rem_1fr_9rem] items-center gap-3">
                <span className="text-sm text-ink-secondary">
                  {bucket.label.replace('Payable ', '')}
                </span>
                <div className="h-2.5 overflow-hidden rounded-sm bg-surface-sunken">
                  <div
                    className={`h-full rounded-sm ${TONE[bucket.key] ?? 'bg-accent'}`}
                    style={{ width: `${Math.max(share, value === 0 ? 0 : 1.5)}%` }}
                  />
                </div>
                <span className={`text-right text-sm font-medium tabular-nums ${value === 0 ? 'text-ink-muted' : 'text-ink'}`}>
                  {formatTHB(value)}
                </span>
              </div>
            );
          })}
        </div>

        <p className={`mt-4 border-t border-border pt-3 text-sm ${foots ? 'text-ink-secondary' : 'text-critical'}`}>
          {foots
            ? `Every bucket foots to the ${formatTHB(payable)} owed.`
            : `The buckets total ${formatTHB(bucketTotal)} against ${formatTHB(payable)} owed. Investigate before using.`}
        </p>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Vendor invoices"
          subtitle="Oldest debt first — a small invoice ninety days late costs more goodwill than a large one not yet due."
        />
        <DataTable rows={rows} columns={columns} exportName="accounts-payable" groupBy="vendor" />
      </Card>
    </>
  );
}
