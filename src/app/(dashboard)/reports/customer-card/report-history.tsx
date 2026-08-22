'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';
import { formatDate, formatDateTime, formatTHB } from '@/lib/format/number';
import type { StoredReport } from '@/lib/db/repositories/customer-card-reports';

/**
 * Every report this company has produced.
 *
 * The figures are shown on the row rather than only inside the workbook, so a
 * question like "what was outstanding at the end of August" is answered from
 * the list without downloading anything.
 */
export function ReportHistory({
  reports,
  canDelete,
}: {
  reports: StoredReport[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (report: StoredReport) => {
    const ok = window.confirm(
      `Delete the ${report.projectLabel} report as at ${report.reportDate}? The workbook is removed with it.`,
    );
    if (!ok) return;

    setBusy(report.id);
    setError(null);

    try {
      const response = await fetch(`/api/reports/customer-card/${report.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'The report could not be deleted.');
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mt-4">
      <CardHeader
        title="Reports produced"
        subtitle={
          reports.length === 0
            ? undefined
            : `${reports.length} run${reports.length === 1 ? '' : 's'}, newest first`
        }
      />

      {error ? (
        <p className="mb-3 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}

      {reports.length === 0 ? (
        <EmptyState
          title="No reports yet"
          description="Upload a customer card above. Every run is kept here with its reconciliation, and the workbook can be downloaded again at any time."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
                <th className="py-2 pr-4 font-medium">As at</th>
                <th className="py-2 pr-4 font-medium">Project</th>
                <th className="py-2 pr-4 text-right font-medium">Units</th>
                <th className="py-2 pr-4 text-right font-medium">Paid</th>
                <th className="py-2 pr-4 text-right font-medium">Outstanding</th>
                <th className="py-2 pr-4 font-medium">Reconciliation</th>
                <th className="py-2 pr-4 font-medium">Run</th>
                <th className="py-2 font-medium">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4">
                    <Link
                      href={`/reports/customer-card/${report.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {formatDate(report.reportDate)}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-ink">{report.projectLabel}</td>
                  <td className="tnum py-2 pr-4 text-right text-ink">{report.units}</td>
                  <td className="tnum py-2 pr-4 text-right text-ink">{formatTHB(report.totalPaid)}</td>
                  <td className="tnum py-2 pr-4 text-right text-ink">
                    {formatTHB(report.totalOutstanding)}
                  </td>
                  <td className="py-2 pr-4">
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge tone="good">{report.okCount} OK</Badge>
                      {report.checkCount > 0 ? (
                        <Badge tone="warning">{report.checkCount} CHECK</Badge>
                      ) : null}
                      {report.errorCount > 0 ? (
                        <Badge tone="critical">{report.errorCount} ERROR</Badge>
                      ) : null}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-xs text-ink-secondary">
                    {formatDateTime(report.createdAt)}
                    {report.createdByName ? ` · ${report.createdByName}` : ''}
                  </td>
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <a
                        href={`/api/reports/customer-card/${report.id}`}
                        className="rounded-md border border-border-strong px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
                      >
                        Download
                      </a>
                      {canDelete ? (
                        <Button
                          size="sm"
                          onClick={() => void remove(report)}
                          disabled={busy === report.id}
                        >
                          {busy === report.id ? 'Deleting…' : 'Delete'}
                        </Button>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
