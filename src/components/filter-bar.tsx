'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { formatDate } from '@/lib/format/number';
import type { Project } from '@/lib/types';
import type { SnapshotInfo } from '@/lib/db/repositories/snapshots';
import { Select } from './ui/controls';
import { Spinner } from './ui/controls';

/**
 * Global filters (requirement 21).
 *
 * State lives in the URL, so a filtered view is linkable, survives a refresh
 * and is what the export endpoints read — one source of truth rather than a
 * client store the server cannot see.
 */
export function FilterBar({
  snapshots,
  snapshot,
  previous,
  projects,
  projectId,
  company,
  companies,
}: {
  snapshots: SnapshotInfo[];
  snapshot: SnapshotInfo | null;
  previous: SnapshotInfo | null;
  projects: Project[];
  projectId: string | null;
  company: string | null;
  companies: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);

    // Changing company invalidates a project selection outside it.
    if (key === 'company') next.delete('projectId');

    startTransition(() => router.push(`${pathname}?${next}`));
  };

  const visibleProjects = company ? projects.filter((p) => p.company === company) : projects;

  return (
    <div className="no-print mb-6 flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
      <Select
        label="Report Date"
        value={snapshot?.id ?? ''}
        onChange={(e) => update('snapshotId', e.target.value)}
        disabled={snapshots.length === 0}
      >
        {snapshots.length === 0 ? <option value="">No data imported</option> : null}
        {snapshots.map((s) => (
          <option key={s.id} value={s.id}>
            {formatDate(s.reportDate)}
            {s.isCurrent ? '' : ' (superseded)'}
            {s.label ? ` — ${s.label}` : ''}
          </option>
        ))}
      </Select>

      <Select
        label="Compare With"
        value={previous?.id ?? ''}
        onChange={(e) => update('compareTo', e.target.value)}
      >
        <option value="">Previous upload</option>
        {snapshots
          .filter((s) => s.id !== snapshot?.id)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {formatDate(s.reportDate)}
              {s.label ? ` — ${s.label}` : ''}
            </option>
          ))}
      </Select>

      <Select label="Company" value={company ?? ''} onChange={(e) => update('company', e.target.value)}>
        <option value="">All Companies</option>
        {companies.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>

      <Select
        label="Project"
        value={projectId ?? ''}
        onChange={(e) => update('projectId', e.target.value)}
      >
        <option value="">All Projects</option>
        {visibleProjects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>

      {pending ? (
        <div className="pb-1.5">
          <Spinner />
        </div>
      ) : null}

      <div className="ml-auto pb-1.5 text-xs text-ink-muted">
        {snapshot ? (
          <>
            Showing <span className="font-medium text-ink-secondary">{formatDate(snapshot.reportDate)}</span>
            {previous ? (
              <> compared with <span className="font-medium text-ink-secondary">{formatDate(previous.reportDate)}</span></>
            ) : (
              <> — no earlier period to compare</>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
