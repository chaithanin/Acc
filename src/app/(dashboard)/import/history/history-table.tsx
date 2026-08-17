'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Modal, Spinner } from '@/components/ui/controls';
import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import type { ImportSummary } from '@/lib/db/repositories/imports';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format/number';

export function HistoryTable({
  imports,
  canManage,
}: {
  imports: ImportSummary[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRollback, setConfirmRollback] = useState<ImportSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const act = async (importId: string, action: 'rollback' | 'recalculate') => {
    setBusyId(importId);
    setMessage(null);
    try {
      const response = await fetch(`/api/imports/${importId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error ?? 'That action failed.');
      } else if (action === 'recalculate') {
        setMessage(`Recalculated ${data.metrics} metrics and ${data.validations} reconciliation rules.`);
      } else {
        setMessage('The import was rolled back and the previous snapshot restored.');
      }
      router.refresh();
    } catch (err) {
      setMessage(`That action failed: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
      setConfirmRollback(null);
    }
  };

  if (imports.length === 0) {
    return (
      <EmptyState
        title="Nothing has been imported yet"
        description="Once you import a workbook it will appear here, where you can compare it, recalculate it or roll it back."
        action={
          <Link
            href="/import"
            className="inline-flex rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Go to Data Import
          </Link>
        }
      />
    );
  }

  return (
    <>
      {message ? (
        <p className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent">
          {message}
        </p>
      ) : null}

      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-surface-sunken">
              <tr>
                {['Report Date', 'Imported', 'By', 'Projects', 'Files', 'Records', 'Status', 'Actions'].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-semibold text-ink-secondary"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {imports.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <p className="font-medium text-ink">{formatDate(row.reportDate)}</p>
                    {row.label ? <p className="text-xs text-ink-muted">{row.label}</p> : null}
                  </td>
                  <td className="px-3 py-2 text-ink-secondary">{formatDateTime(row.createdAt)}</td>
                  <td className="px-3 py-2 text-ink-secondary">{row.uploadedBy ?? '—'}</td>
                  <td className="px-3 py-2 text-ink-secondary">
                    {row.projects.length > 0 ? row.projects.join(', ') : '—'}
                  </td>
                  <td className="tnum px-3 py-2 text-ink-secondary">{row.fileCount}</td>
                  <td className="tnum px-3 py-2 text-ink-secondary">{formatNumber(row.rowCount)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {row.status === 'rolled_back' ? (
                        <Badge tone="neutral">Rolled back</Badge>
                      ) : row.isCurrent ? (
                        <Badge tone="good" icon={<span aria-hidden>●</span>}>
                          Live
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Superseded</Badge>
                      )}
                      {row.errorCount > 0 ? (
                        <Badge tone="critical" icon={<span aria-hidden>▲</span>}>
                          {row.errorCount}
                        </Badge>
                      ) : null}
                      {row.warningCount > 0 ? (
                        <Badge tone="warning" icon={<span aria-hidden>◆</span>}>
                          {row.warningCount}
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {busyId === row.id ? (
                      <Spinner />
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {row.snapshotId ? (
                          <>
                            <Link
                              href={`/?snapshotId=${row.snapshotId}`}
                              className="rounded-md border border-border-strong px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
                            >
                              View
                            </Link>
                            <Link
                              href={`/inspector?importId=${row.id}`}
                              className="rounded-md border border-border-strong px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover"
                            >
                              Inspect
                            </Link>
                          </>
                        ) : null}
                        {canManage && row.status !== 'rolled_back' ? (
                          <>
                            <Button size="sm" onClick={() => act(row.id, 'recalculate')}>
                              Recalculate
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => setConfirmRollback(row)}>
                              Roll back
                            </Button>
                          </>
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={confirmRollback !== null}
        onClose={() => setConfirmRollback(null)}
        title="Roll this import back?"
        subtitle="This removes its snapshot and every figure derived from it."
      >
        <p className="text-sm text-ink-secondary">
          The import for <strong className="text-ink">{formatDate(confirmRollback?.reportDate ?? '')}</strong>{' '}
          will be marked as rolled back and its records deleted. The most recent surviving snapshot for
          that report date becomes live again. The original uploaded files are kept.
        </p>
        <p className="mt-3 text-sm text-ink-secondary">This cannot be undone.</p>

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirmRollback(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => confirmRollback && act(confirmRollback.id, 'rollback')}
          >
            Roll back
          </Button>
        </div>
      </Modal>
    </>
  );
}
