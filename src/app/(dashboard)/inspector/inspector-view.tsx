'use client';

import { useState } from 'react';
import { Card, CardHeader, Badge, EmptyState, cx } from '@/components/ui/primitives';
import { formatFileSize, formatNumber, formatTHB } from '@/lib/format/number';
import type { ColumnMapping } from '@/lib/types';

interface InspectorFile {
  id: string;
  fileName: string;
  containerFile: string | null;
  fileType: string;
  fileHash: string;
  fileSize: number;
  reportType: string | null;
  reportDate: string | null;
  projectName: string | null;
  sheetCount: number;
  rowCount: number;
  status: string;
  error: string | null;
}

interface InspectorSheet {
  fileId: string;
  sheetName: string;
  sheetIndex: number;
  reportType: string;
  confidence: number;
  headerRow: number | null;
  headers: string[];
  columns: ColumnMapping[];
  scores: { type: string; score: number }[];
  rowCount: number;
  parsedCount: number;
}

interface RawRow {
  fileId: string;
  sheetName: string;
  rowNumber: number;
  cells: string[];
}

interface InspectorMetric {
  key: string;
  label: string;
  section: string;
  value: number | null;
  formula: string | null;
}

interface InspectorIssue {
  severity: string;
  code: string;
  message: string;
  file: string | null;
  sheet: string | null;
  row: number | null;
  cell: string | null;
}

type Tab = 'files' | 'sheets' | 'raw' | 'metrics' | 'issues';

const TABS: { key: Tab; label: string }[] = [
  { key: 'files', label: 'Files' },
  { key: 'sheets', label: 'Sheets & headers' },
  { key: 'raw', label: 'Raw rows' },
  { key: 'metrics', label: 'Calculated metrics' },
  { key: 'issues', label: 'Issues' },
];

export function InspectorView({
  files,
  sheets,
  rawRows,
  metrics,
  issues,
}: {
  files: InspectorFile[];
  sheets: InspectorSheet[];
  rawRows: RawRow[];
  metrics: InspectorMetric[];
  issues: InspectorIssue[];
}) {
  const [tab, setTab] = useState<Tab>('files');
  const [selectedFile, setSelectedFile] = useState<string | null>(files[0]?.id ?? null);

  const fileSheets = sheets.filter((s) => !selectedFile || s.fileId === selectedFile);
  const fileRows = rawRows.filter((r) => !selectedFile || r.fileId === selectedFile);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cx(
              'rounded-md border px-3 py-1.5 text-sm',
              tab === t.key
                ? 'border-accent/40 bg-accent-soft font-medium text-accent'
                : 'border-border text-ink-secondary hover:bg-surface-hover',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'metrics' && tab !== 'issues' && files.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedFile(null)}
            className={cx(
              'rounded-md border px-2.5 py-1 text-xs',
              selectedFile === null ? 'border-accent/40 bg-accent-soft text-accent' : 'border-border text-ink-secondary',
            )}
          >
            All files
          </button>
          {files.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelectedFile(f.id)}
              className={cx(
                'rounded-md border px-2.5 py-1 text-xs',
                selectedFile === f.id
                  ? 'border-accent/40 bg-accent-soft text-accent'
                  : 'border-border text-ink-secondary hover:bg-surface-hover',
              )}
            >
              {f.fileName}
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'files' ? <FilesTab files={files} /> : null}
      {tab === 'sheets' ? <SheetsTab sheets={fileSheets} /> : null}
      {tab === 'raw' ? <RawTab rows={fileRows} /> : null}
      {tab === 'metrics' ? <MetricsTab metrics={metrics} /> : null}
      {tab === 'issues' ? <IssuesTab issues={issues} /> : null}
    </>
  );
}

function FilesTab({ files }: { files: InspectorFile[] }) {
  return (
    <div className="space-y-3">
      {files.map((file) => (
        <Card key={file.id}>
          <CardHeader
            title={file.fileName}
            subtitle={`${file.fileType.toUpperCase()} · ${formatFileSize(file.fileSize)}${
              file.containerFile ? ` · extracted from ${file.containerFile}` : ''
            }`}
            action={
              file.status === 'failed' ? (
                <Badge tone="critical" icon={<span aria-hidden>▲</span>}>
                  Failed
                </Badge>
              ) : (
                <Badge tone="good" icon={<span aria-hidden>●</span>}>
                  Parsed
                </Badge>
              )
            }
          />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Field label="Project" value={file.projectName ?? 'Unassigned'} />
            <Field label="Report type" value={file.reportType ?? '—'} />
            <Field label="Report date" value={file.reportDate ?? '—'} />
            <Field label="Sheets" value={String(file.sheetCount)} />
            <Field label="Records imported" value={formatNumber(file.rowCount)} />
            <Field label="SHA-256" value={file.fileHash.slice(0, 16)} mono />
          </dl>
          {file.error ? (
            <p className="mt-3 rounded-md border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical">
              {file.error}
            </p>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function SheetsTab({ sheets }: { sheets: InspectorSheet[] }) {
  if (sheets.length === 0) {
    return <EmptyState title="No sheets recorded" description="This import produced no sheet detections." />;
  }

  return (
    <div className="space-y-3">
      {sheets.map((sheet) => (
        <Card key={`${sheet.fileId}-${sheet.sheetName}`}>
          <CardHeader
            title={sheet.sheetName}
            subtitle={`Detected as ${sheet.reportType} · ${sheet.rowCount} rows · ${sheet.parsedCount} records imported`}
            action={<Badge tone="neutral">confidence {sheet.confidence.toFixed(2)}</Badge>}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                Detected headers {sheet.headerRow !== null ? `(row ${sheet.headerRow + 1})` : '(none found)'}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {sheet.headers.length > 0 ? (
                  sheet.headers.map((header, index) => (
                    <span
                      key={`${header}-${index}`}
                      className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[11px] text-ink-secondary"
                    >
                      {header}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-ink-muted">None</span>
                )}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                Column mapping
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {sheet.columns.length > 0 ? (
                  sheet.columns.map((column) => (
                    <span
                      key={`${column.field}-${column.columnIndex}`}
                      className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[11px] text-ink-secondary"
                    >
                      <span className="font-medium text-ink">{column.field}</span> ← col{' '}
                      {column.columnIndex + 1} “{column.header}” ({column.via}, {column.score})
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-ink-muted">Nothing mapped</span>
                )}
              </div>
            </div>
          </div>

          {sheet.scores.length > 0 ? (
            <div className="mt-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                Classification scores
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {sheet.scores.map((score) => (
                  <span
                    key={score.type}
                    className="tnum rounded border border-border px-1.5 py-0.5 text-[11px] text-ink-secondary"
                  >
                    {score.type}: {score.score}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function RawTab({ rows }: { rows: RawRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No raw rows stored"
        description="Raw rows are sampled for inspection rather than stored in full."
      />
    );
  }

  const bySheet = new Map<string, RawRow[]>();
  for (const row of rows) {
    bySheet.set(row.sheetName, [...(bySheet.get(row.sheetName) ?? []), row]);
  }

  return (
    <div className="space-y-3">
      {[...bySheet.entries()].map(([sheetName, sheetRows]) => (
        <Card key={sheetName} padded={false}>
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">{sheetName}</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Showing the first {sheetRows.length} non-empty rows as read from the file
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-xs">
              <tbody>
                {sheetRows.map((row) => (
                  <tr key={row.rowNumber} className="border-b border-border last:border-0">
                    <td className="tnum sticky left-0 bg-surface-sunken px-2 py-1 text-ink-muted">
                      {row.rowNumber}
                    </td>
                    {row.cells.map((cell, index) => (
                      <td key={index} className="max-w-64 truncate px-2 py-1 text-ink-secondary">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}

function MetricsTab({ metrics }: { metrics: InspectorMetric[] }) {
  if (metrics.length === 0) {
    return <EmptyState title="No metrics" description="This import produced no calculated metrics." />;
  }

  const bySection = new Map<string, InspectorMetric[]>();
  for (const metric of metrics) {
    bySection.set(metric.section, [...(bySection.get(metric.section) ?? []), metric]);
  }

  return (
    <div className="space-y-3">
      {[...bySection.entries()].map(([section, items]) => (
        <Card key={section}>
          <CardHeader title={section} subtitle="Group-wide values, with the formula each was derived from" />
          <table className="w-full text-sm">
            <tbody>
              {items.map((metric) => (
                <tr key={metric.key} className="border-b border-border last:border-0">
                  <td className="py-2 pr-4">
                    <p className="font-medium text-ink">{metric.label}</p>
                    <p className="font-mono text-[11px] text-ink-muted">{metric.key}</p>
                  </td>
                  <td className="py-2 pr-4 text-xs text-ink-secondary">{metric.formula ?? '—'}</td>
                  <td className="tnum py-2 text-right font-medium text-ink">
                    {formatTHB(metric.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

function IssuesTab({ issues }: { issues: InspectorIssue[] }) {
  if (issues.length === 0) {
    return <EmptyState title="No issues" description="Every sheet, row and cell was read cleanly." />;
  }

  return (
    <Card padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-surface-sunken">
            <tr>
              {['Severity', 'Code', 'File', 'Sheet', 'Row / Cell', 'Detail'].map((h) => (
                <th key={h} className="border-b border-border px-3 py-2 text-left text-xs font-semibold text-ink-secondary">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {issues.map((issue, index) => (
              <tr key={index} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <Badge
                    tone={issue.severity === 'error' ? 'critical' : issue.severity === 'warning' ? 'warning' : 'info'}
                  >
                    {issue.severity}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-ink-secondary">{issue.code}</td>
                <td className="px-3 py-2 text-ink-secondary">{issue.file ?? '—'}</td>
                <td className="px-3 py-2 text-ink-secondary">{issue.sheet ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-ink-secondary">
                  {issue.cell ?? (issue.row !== null ? `Row ${issue.row}` : '—')}
                </td>
                <td className="px-3 py-2 text-ink-secondary">{issue.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-muted">{label}</dt>
      <dd className={cx('mt-0.5 text-ink', mono && 'font-mono text-xs')}>{value}</dd>
    </div>
  );
}
