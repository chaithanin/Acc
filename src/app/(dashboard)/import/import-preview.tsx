'use client';

import { useMemo, useState } from 'react';
import { REPORT_TYPE_LABELS, type ReportType } from '@/config/detection-rules';
import { Button, Modal, Select, TextInput } from '@/components/ui/controls';
import { Badge, Card, CardHeader, cx } from '@/components/ui/primitives';
import { formatDateTime, formatFileSize, formatNumber } from '@/lib/format/number';
import type {
  ConfirmPayload,
  FileOverridePayload,
  PreviewFile,
  PreviewResponse,
  PreviewSheet,
} from './types';

/**
 * Import preview (requirement 14).
 *
 * Shows what the importer decided for every file and sheet, and lets the user
 * correct the project, report date, sheet type or inclusion before anything is
 * written. Corrections are re-applied by re-parsing, so they genuinely change
 * the imported data rather than just relabelling it.
 */
export function ImportPreview({
  preview,
  reportDate,
  onReportDateChange,
  onConfirm,
  onCancel,
  busy,
}: {
  preview: PreviewResponse;
  reportDate: string;
  onReportDateChange: (value: string) => void;
  onConfirm: (payload: ConfirmPayload) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [label, setLabel] = useState('');
  const [overrides, setOverrides] = useState<Record<string, FileOverridePayload>>({});
  const [inspecting, setInspecting] = useState<PreviewFile | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(preview.duplicates.length > 0);
  const [mode, setMode] = useState<'new' | 'replace'>('new');

  const setProject = (fileName: string, projectId: string) => {
    setOverrides((prev) => ({
      ...prev,
      [fileName]: { ...prev[fileName], fileName, projectId: projectId || null },
    }));
  };

  const setSheetType = (fileName: string, sheetName: string, reportType: ReportType | '') => {
    setOverrides((prev) => {
      const file = prev[fileName] ?? { fileName };
      const sheets = [...(file.sheets ?? [])];
      const index = sheets.findIndex((s) => s.sheetName === sheetName);
      const next = {
        ...(index >= 0 ? sheets[index] : { sheetName }),
        reportType: reportType || undefined,
      };
      if (index >= 0) sheets[index] = next;
      else sheets.push(next);
      return { ...prev, [fileName]: { ...file, fileName, sheets } };
    });
  };

  const setSheetIncluded = (fileName: string, sheetName: string, include: boolean) => {
    setOverrides((prev) => {
      const file = prev[fileName] ?? { fileName };
      const sheets = [...(file.sheets ?? [])];
      const index = sheets.findIndex((s) => s.sheetName === sheetName);
      const next = { ...(index >= 0 ? sheets[index] : { sheetName }), include };
      if (index >= 0) sheets[index] = next;
      else sheets.push(next);
      return { ...prev, [fileName]: { ...file, fileName, sheets } };
    });
  };

  const setSheetProject = (fileName: string, sheetName: string, projectId: string) => {
    setOverrides((prev) => {
      const file = prev[fileName] ?? { fileName };
      const sheets = [...(file.sheets ?? [])];
      const index = sheets.findIndex((s) => s.sheetName === sheetName);
      // '' means "follow the file", which is not the same as choosing no
      // company — the first inherits, the second overrides with nothing.
      const next = {
        ...(index >= 0 ? sheets[index] : { sheetName }),
        projectId: projectId === '' ? undefined : projectId,
      };
      if (index >= 0) sheets[index] = next;
      else sheets.push(next);
      return { ...prev, [fileName]: { ...file, fileName, sheets } };
    });
  };

  /**
   * Sheets the importer read and understood that yielded nothing.
   *
   * Gathered across every file and shown before the table, because one line
   * buried among a file's warnings is exactly how a missing sheet gets
   * confirmed into the dashboard.
   */
  const emptySheets = preview.files.flatMap((file) =>
    file.sheets
      .filter((sheet) => sheet.parsedCount === 0 && sheet.rowCount > 0)
      .map((sheet) => ({ ...sheet, fileName: file.fileName })),
  );

  const unassigned = preview.files.filter(
    (f) => !f.project.projectId && overrides[f.fileName]?.projectId == null,
  );

  const totals = useMemo(() => {
    const parsed = preview.files.filter((f) => f.status === 'parsed');
    return {
      files: preview.files.length,
      rows: parsed.reduce((sum, f) => sum + f.rowCount, 0),
      warnings: parsed.reduce((sum, f) => sum + f.warningCount, 0),
      failed: preview.files.filter((f) => f.status === 'failed').length,
    };
  }, [preview.files]);

  return (
    <>
      <Card>
        <CardHeader
          title="Import preview"
          subtitle="Check what was detected, correct anything wrong, then confirm. Nothing has been saved yet."
          action={
            <div className="flex gap-2">
              <Button onClick={onCancel} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={busy || totals.files === totals.failed}
                onClick={() => onConfirm({ label, mode, overrides: Object.values(overrides) })}
              >
                Confirm import
              </Button>
            </div>
          }
        />

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <TextInput
            label="Report date"
            type="date"
            value={reportDate}
            onChange={(e) => onReportDateChange(e.target.value)}
          />
          <TextInput
            label="Label (optional)"
            placeholder="e.g. August close"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Select
            label="If this period already exists"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'new' | 'replace')}
          >
            <option value="new">Import as a new version</option>
            <option value="replace">Replace the existing snapshot</option>
          </Select>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <Badge tone="info">{totals.files} files</Badge>
          <Badge tone="neutral">{formatNumber(totals.rows)} records</Badge>
          {totals.warnings > 0 ? (
            <Badge tone="warning" icon={<span aria-hidden>◆</span>}>
              {totals.warnings} warnings
            </Badge>
          ) : null}
          {totals.failed > 0 ? (
            <Badge tone="critical" icon={<span aria-hidden>▲</span>}>
              {totals.failed} unreadable
            </Badge>
          ) : null}
          {unassigned.length > 0 ? (
            <Badge tone="warning" icon={<span aria-hidden>◆</span>}>
              {unassigned.length} without a project
            </Badge>
          ) : null}
        </div>

        {emptySheets.length > 0 ? (
          <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <p className="font-medium text-ink">
              <span aria-hidden>◆</span> {emptySheets.length}{' '}
              {emptySheets.length === 1 ? 'sheet was' : 'sheets were'} read but produced no records
            </p>
            <p className="mt-1 text-ink-secondary">
              Nothing from these reaches the dashboard. That is the failure most likely to pass
              unnoticed — the import succeeds and figures are quietly missing — so check the report
              type and mapped columns under Sheets before confirming.
            </p>
            <ul className="mt-1.5 space-y-0.5 text-ink-secondary">
              {emptySheets.map((s) => (
                <li key={`${s.fileName}-${s.sheetName}`}>
                  <span className="font-medium text-ink">{s.sheetName}</span> — {s.rowCount} rows,
                  read as {s.reportTypeLabel} · {s.fileName}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {preview.rejected.length > 0 ? (
          <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            <p className="font-medium text-ink">Some uploads were not accepted</p>
            <ul className="mt-1 space-y-0.5 text-ink-secondary">
              {preview.rejected.map((r) => (
                <li key={r.fileName}>
                  {r.fileName} — {r.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
          <table className="w-full min-w-max text-sm">
            <thead className="bg-surface-sunken">
              <tr>
                {['File', 'Type', 'Detected Project', 'Detected Report', 'Report Date', 'Sheets', 'Rows', 'Status', ''].map(
                  (header) => (
                    <th
                      key={header}
                      className="whitespace-nowrap border-b border-border px-3 py-2 text-left text-xs font-semibold text-ink-secondary"
                    >
                      {header}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {preview.files.map((file) => {
                const override = overrides[file.fileName];
                const projectValue =
                  override?.projectId !== undefined
                    ? override.projectId ?? ''
                    : file.project.projectId ?? '';

                return (
                  <tr key={file.fileName} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <p className="font-medium text-ink">{file.fileName}</p>
                      <p className="text-xs text-ink-muted">
                        {formatFileSize(file.size)}
                        {file.containerFile ? ` · from ${file.containerFile}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2 uppercase text-ink-secondary">{file.fileType}</td>
                    <td className="px-3 py-2">
                      <Select
                        value={projectValue}
                        onChange={(e) => setProject(file.fileName, e.target.value)}
                        className="min-w-48"
                      >
                        <option value="">Unassigned</option>
                        {preview.projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                      {file.project.matchedAlias ? (
                        <p className="mt-1 text-[11px] text-ink-muted">
                          matched “{file.project.matchedAlias}” in {file.project.matchedIn}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">{file.reportTypeLabel}</td>
                    <td className="px-3 py-2 text-ink-secondary">{file.reportDate}</td>
                    <td className="tnum px-3 py-2 text-ink-secondary">{file.sheetCount}</td>
                    <td className="tnum px-3 py-2 text-ink-secondary">{formatNumber(file.rowCount)}</td>
                    <td className="px-3 py-2">
                      {file.status === 'failed' ? (
                        <Badge tone="critical" icon={<span aria-hidden>▲</span>}>
                          Unreadable
                        </Badge>
                      ) : file.errorCount > 0 ? (
                        <Badge tone="critical" icon={<span aria-hidden>▲</span>}>
                          {file.errorCount} errors
                        </Badge>
                      ) : file.warningCount > 0 ? (
                        <Badge tone="warning" icon={<span aria-hidden>◆</span>}>
                          {file.warningCount} warnings
                        </Badge>
                      ) : (
                        <Badge tone="good" icon={<span aria-hidden>●</span>}>
                          Ready
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Button size="sm" onClick={() => setInspecting(file)}>
                        Sheets
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {preview.files.some((f) => f.status === 'failed') ? (
          <div className="mt-3 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-ink">
            <p className="font-medium">Unreadable files will be recorded but contribute no data.</p>
            <ul className="mt-1 space-y-0.5 text-ink-secondary">
              {preview.files
                .filter((f) => f.status === 'failed')
                .map((f) => (
                  <li key={f.fileName}>
                    {f.fileName} — {f.error}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </Card>

      <Modal
        open={inspecting !== null}
        onClose={() => setInspecting(null)}
        title={inspecting?.fileName ?? ''}
        subtitle="What was detected in each sheet, and how to change it"
        wide
      >
        {inspecting ? (
          <SheetList
            file={inspecting}
            override={overrides[inspecting.fileName]}
            onTypeChange={(sheet, type) => setSheetType(inspecting.fileName, sheet, type)}
            onIncludeChange={(sheet, include) =>
              setSheetIncluded(inspecting.fileName, sheet, include)
            }
            projects={preview.projects}
            onProjectChange={(sheet, projectId) =>
              setSheetProject(inspecting.fileName, sheet, projectId)
            }
          />
        ) : null}
      </Modal>

      <Modal
        open={duplicateOpen}
        onClose={() => setDuplicateOpen(false)}
        title="These files may already have been imported"
        subtitle="Matched on file contents, or on the same report date, project and report type"
      >
        <ul className="space-y-2 text-sm">
          {preview.duplicates.map((d) => (
            <li key={d.fileName} className="rounded-md border border-border px-3 py-2">
              <p className="font-medium text-ink">{d.fileName}</p>
              <p className="mt-0.5 text-xs text-ink-secondary">
                Previously imported {formatDateTime(d.importedAt)} for report date {d.reportDate}
                {d.projectName ? ` · ${d.projectName}` : ''}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={onCancel}>Cancel the import</Button>
          <Button
            onClick={() => {
              setMode('replace');
              setDuplicateOpen(false);
            }}
          >
            Replace the existing snapshot
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setMode('new');
              setDuplicateOpen(false);
            }}
          >
            Import as a new version
          </Button>
        </div>
      </Modal>
    </>
  );
}

function SheetList({
  file,
  override,
  onTypeChange,
  onIncludeChange,
  projects,
  onProjectChange,
}: {
  file: PreviewFile;
  override: FileOverridePayload | undefined;
  onTypeChange: (sheetName: string, type: ReportType | '') => void;
  onIncludeChange: (sheetName: string, include: boolean) => void;
  projects: { id: string; name: string }[];
  onProjectChange: (sheetName: string, projectId: string) => void;
}) {
  return (
    <div className="space-y-3">
      {file.sheets.map((sheet) => {
        const sheetOverride = override?.sheets?.find((s) => s.sheetName === sheet.sheetName);
        const included = sheetOverride?.include ?? true;

        return (
          <div
            key={sheet.sheetName}
            className={cx(
              'rounded-md border px-3 py-3',
              included ? 'border-border' : 'border-dashed border-border-strong opacity-60',
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">{sheet.sheetName}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {sheet.rowCount} rows · {sheet.parsedCount} imported ·{' '}
                  {sheet.headerRow === null ? 'no header row found' : `header on row ${sheet.headerRow + 1}`}
                  {sheet.templateName ? ` · template: ${sheet.templateName}` : ''}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {sheet.parsedCount === 0 && sheet.rowCount > 0 ? (
                  <Badge tone="warning" icon={<span aria-hidden>◆</span>}>
                    No records
                  </Badge>
                ) : null}
                <ConfidenceBadge confidence={sheet.confidence} />
                <label className="flex items-center gap-1.5 text-xs text-ink-secondary">
                  <input
                    type="checkbox"
                    checked={included}
                    onChange={(e) => onIncludeChange(sheet.sheetName, e.target.checked)}
                  />
                  Import
                </label>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Select
                label="Report type"
                value={sheetOverride?.reportType ?? sheet.reportType}
                onChange={(e) => onTypeChange(sheet.sheetName, e.target.value as ReportType)}
              >
                {Object.entries(REPORT_TYPE_LABELS).map(([value, labelText]) => (
                  <option key={value} value={value}>
                    {labelText}
                  </option>
                ))}
              </Select>

              <Select
                label="Company"
                value={sheetOverride?.projectId ?? ''}
                onChange={(e) => onProjectChange(sheet.sheetName, e.target.value)}
              >
                <option value="">Same as the file</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>

            <p className="mt-1.5 text-xs text-ink-muted">
              Set a company here when one workbook covers several — a cash-flow file with a sheet
              per company, under names that do not say which.
            </p>

            {sheet.columns.length > 0 ? (
              <div className="mt-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                  Mapped columns
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {sheet.columns.map((column) => (
                    <span
                      key={`${column.field}-${column.columnIndex}`}
                      className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[11px] text-ink-secondary"
                      title={`via ${column.via}`}
                    >
                      <span className="font-medium text-ink">{column.field}</span> ← {column.header}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-ink-muted">
                No columns were mapped. Choose a report type above, or add the header spellings under
                Settings → Template Mapping.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 0.7) {
    return (
      <Badge tone="good" icon={<span aria-hidden>●</span>}>
        High confidence
      </Badge>
    );
  }
  if (confidence >= 0.4) {
    return (
      <Badge tone="warning" icon={<span aria-hidden>◆</span>}>
        Check this
      </Badge>
    );
  }
  return <Badge tone="neutral">Not recognised</Badge>;
}

export type { PreviewSheet };
