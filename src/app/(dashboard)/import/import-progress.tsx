'use client';

import { cx } from '@/components/ui/primitives';

/** Import progress display (requirement 3). */

export type Stage =
  | 'uploading'
  | 'reading_workbook'
  | 'detecting_sheets'
  | 'mapping_data'
  | 'calculating'
  | 'validating'
  | 'completed';

export const STAGES: { key: Stage; label: string; detail: string }[] = [
  { key: 'uploading', label: 'Uploading', detail: 'files are copied to the server, unchanged' },
  { key: 'reading_workbook', label: 'Reading workbook', detail: 'ZIPs are expanded and each workbook is opened' },
  { key: 'detecting_sheets', label: 'Detecting sheets', detail: 'sheet types and the project are identified' },
  { key: 'mapping_data', label: 'Mapping data', detail: 'headers are matched to fields and rows are read' },
  { key: 'calculating', label: 'Calculating', detail: 'every KPI is computed from the records' },
  { key: 'validating', label: 'Validating', detail: 'reconciliation rules are run' },
  { key: 'completed', label: 'Completed', detail: 'the snapshot is saved and comparable' },
];

export function ImportProgress({ current }: { current: Stage }) {
  const currentIndex = STAGES.findIndex((s) => s.key === current);

  return (
    <ol className="flex flex-wrap gap-x-2 gap-y-2">
      {STAGES.map((stage, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;

        return (
          <li
            key={stage.key}
            className={cx(
              'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
              done && 'border-good/30 bg-good/10 text-good',
              active && 'border-accent/40 bg-accent-soft text-accent',
              !done && !active && 'border-border text-ink-muted',
            )}
          >
            <span aria-hidden>{done ? '✓' : active ? '●' : '○'}</span>
            {stage.label}
          </li>
        );
      })}
    </ol>
  );
}
