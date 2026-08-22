'use client';

import { useState } from 'react';
import { DataTable, type Column } from '@/components/data-table';
import { Card, CardHeader, cx } from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';
import type { CheckRow, ReportIssue } from '@/lib/reports/customer-card/types';

/**
 * The reconciliation, unit by unit — the same rows as the Data_Check sheet.
 *
 * Opens filtered to what did not reconcile. A list of 439 rows of which 428
 * say OK buries the eleven that matter, and those eleven are the reason
 * anybody opens this page.
 */
export function CheckTable({ checks, issues }: { checks: CheckRow[]; issues: ReportIssue[] }) {
  const [showAll, setShowAll] = useState(false);

  const flagged = checks.filter((c) => c.status !== 'OK');
  const rows = showAll ? checks : flagged;

  const columns: Column<CheckRow>[] = [
    { key: 'unit', header: 'Unit', value: (r) => r.unit },
    { key: 'contract', header: 'Contract No.', value: (r) => r.contractNo ?? '—' },
    { key: 'sale', header: 'Sale Price', numeric: true, value: (r) => r.salePrice },
    { key: 'plan', header: 'Plan Total', numeric: true, value: (r) => r.planTotal },
    { key: 'paid', header: 'Paid Total', numeric: true, value: (r) => r.paidTotal },
    {
      key: 'source',
      header: 'Outstanding (card)',
      numeric: true,
      value: (r) => r.outstandingSource ?? 0,
    },
    {
      key: 'calculated',
      header: 'Outstanding (calculated)',
      numeric: true,
      value: (r) => r.outstandingCalculated,
    },
    { key: 'difference', header: 'Difference', numeric: true, value: (r) => r.difference ?? 0 },
    {
      key: 'status',
      header: 'Status',
      value: (r) => r.status,
      render: (r) => (
        <span
          className={cx(
            'rounded px-1.5 py-0.5 text-[11px] font-medium',
            r.status === 'ERROR'
              ? 'bg-critical/15 text-critical'
              : r.status === 'CHECK'
                ? 'bg-warning/15 text-warning'
                : 'bg-good/15 text-good',
          )}
        >
          {r.status}
        </span>
      ),
    },
    { key: 'note', header: 'Note', value: (r) => r.note },
  ];

  return (
    <>
      <Card>
        <CardHeader
          title="Reconciliation by unit"
          subtitle={
            showAll
              ? `All ${checks.length} units`
              : flagged.length === 0
                ? 'Every unit reconciled'
                : `${flagged.length} of ${checks.length} units need a look`
          }
          action={
            <Button size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Only what needs a look' : `Show all ${checks.length}`}
            </Button>
          }
        />
        <DataTable
          rows={rows}
          columns={columns}
          pageSize={25}
          exportName="customer-card-check"
          initialSort={{ key: 'unit', direction: 'asc' }}
          emptyMessage="Every unit reconciled against the card."
        />
      </Card>

      {issues.length > 0 ? (
        <Card className="mt-4">
          <CardHeader
            title="Data quality"
            subtitle={`${issues.length} thing${issues.length === 1 ? '' : 's'} the run found in the card`}
          />
          <ul className="space-y-2 text-sm">
            {issues.slice(0, 200).map((issue, index) => (
              <li
                key={`${issue.code}-${index}`}
                className="flex gap-3 border-b border-border pb-2 last:border-0"
              >
                <span
                  className={cx(
                    'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                    issue.severity === 'error'
                      ? 'bg-critical/15 text-critical'
                      : issue.severity === 'warning'
                        ? 'bg-warning/15 text-warning'
                        : 'bg-surface-sunken text-ink-muted',
                  )}
                >
                  {issue.severity}
                </span>
                <span className="text-ink-secondary">
                  {issue.unit ? <span className="font-medium text-ink">{issue.unit} — </span> : null}
                  {issue.message}
                  {issue.sourceRow ? (
                    <span className="text-ink-muted"> (source row {issue.sourceRow})</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {issues.length > 200 ? (
            <p className="mt-3 text-xs text-ink-muted">
              Showing the first 200 of {issues.length}. The rest are on the Data_Check sheet of the
              workbook.
            </p>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
