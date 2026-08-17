import { redirect } from 'next/navigation';
import { PageHeader, EmptyState, Card, CardHeader, Badge } from '@/components/ui/primitives';
import { can, currentUser } from '@/lib/auth';
import { getDb, parseJson } from '@/lib/db';
import { getImportFiles, getImportIssues, listImports } from '@/lib/db/repositories/imports';
import { InspectorView } from './inspector-view';
import type { ColumnMapping } from '@/lib/types';

/**
 * Data Inspector (requirement 34).
 *
 * A developer-facing view of every layer, in order: file → sheet → detected
 * headers → parsed records → calculated metrics → validation errors. When a
 * number looks wrong, this is where you find out which layer it went wrong in.
 */
export default async function InspectorPage({
  searchParams,
}: {
  searchParams: Promise<{ importId?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!can(user, 'import:run')) redirect('/');

  const { importId } = await searchParams;
  const imports = listImports(50);
  const selected = imports.find((i) => i.id === importId) ?? imports[0];

  if (!selected) {
    return (
      <>
        <PageHeader title="Data Inspector" description="Inspect what the importer read, layer by layer." />
        <EmptyState
          title="Nothing to inspect"
          description="Import a workbook first; every layer of the parse is then visible here."
        />
      </>
    );
  }

  const db = getDb();
  const files = getImportFiles(selected.id);

  const sheets = db
    .prepare<[string], {
      import_file_id: string; sheet_name: string; sheet_index: number; report_type: string;
      confidence: number; header_row: number | null; column_map_json: string | null;
      detected_headers_json: string | null; scores_json: string | null;
      row_count: number; parsed_count: number;
    }>(
      `SELECT import_file_id, sheet_name, sheet_index, report_type, confidence, header_row,
              column_map_json, detected_headers_json, scores_json, row_count, parsed_count
         FROM sheet_detections WHERE import_id = ? ORDER BY sheet_index`,
    )
    .all(selected.id);

  const metrics = selected.snapshotId
    ? db
        .prepare<[string], { metric_key: string; label: string; section: string; value: number | null; formula: string | null; project_id: string | null }>(
          `SELECT metric_key, label, section, value, formula, project_id
             FROM calculated_metrics WHERE snapshot_id = ? AND project_id IS NULL
             ORDER BY section, metric_key`,
        )
        .all(selected.snapshotId)
    : [];

  const issues = getImportIssues(selected.id);

  const rawRows = db
    .prepare<[string], { import_file_id: string; sheet_name: string; row_number: number; cells_json: string }>(
      `SELECT import_file_id, sheet_name, row_number, cells_json
         FROM raw_rows WHERE import_id = ? ORDER BY sheet_name, row_number LIMIT 400`,
    )
    .all(selected.id);

  return (
    <>
      <PageHeader
        title="Data Inspector"
        description="Every layer of the import, from the raw grid through to the calculated metrics."
        action={
          <div className="flex gap-2">
            <Badge tone="neutral">{files.length} files</Badge>
            <Badge tone="neutral">{sheets.length} sheets</Badge>
            <Badge tone="neutral">{metrics.length} metrics</Badge>
          </div>
        }
      />

      <Card className="mb-4">
        <CardHeader title="Import" subtitle="Choose which import to inspect" />
        <div className="flex flex-wrap gap-1.5">
          {imports.map((row) => (
            <a
              key={row.id}
              href={`/inspector?importId=${row.id}`}
              className={
                row.id === selected.id
                  ? 'rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent'
                  : 'rounded-md border border-border px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-hover'
              }
            >
              {row.reportDate}
              {row.label ? ` — ${row.label}` : ''}
            </a>
          ))}
        </div>
      </Card>

      <InspectorView
        files={files.map((f) => ({
          id: f.id,
          fileName: f.file_name,
          containerFile: f.container_file,
          fileType: f.file_type,
          fileHash: f.file_hash,
          fileSize: f.file_size,
          reportType: f.report_type,
          reportDate: f.report_date,
          projectName: f.project_name,
          sheetCount: f.sheet_count,
          rowCount: f.row_count,
          status: f.status,
          error: f.error_message,
        }))}
        sheets={sheets.map((s) => ({
          fileId: s.import_file_id,
          sheetName: s.sheet_name,
          sheetIndex: s.sheet_index,
          reportType: s.report_type,
          confidence: s.confidence,
          headerRow: s.header_row,
          headers: parseJson<string[]>(s.detected_headers_json, []),
          columns: parseJson<ColumnMapping[]>(s.column_map_json, []),
          scores: parseJson<{ type: string; score: number }[]>(s.scores_json, []),
          rowCount: s.row_count,
          parsedCount: s.parsed_count,
        }))}
        rawRows={rawRows.map((r) => ({
          fileId: r.import_file_id,
          sheetName: r.sheet_name,
          rowNumber: r.row_number,
          cells: parseJson<string[]>(r.cells_json, []),
        }))}
        metrics={metrics.map((m) => ({
          key: m.metric_key,
          label: m.label,
          section: m.section,
          value: m.value,
          formula: m.formula,
        }))}
        issues={issues.map((i) => ({
          severity: i.severity,
          code: i.code,
          message: i.message,
          file: i.source_file,
          sheet: i.source_sheet,
          row: i.source_row,
          cell: i.source_cell,
        }))}
      />
    </>
  );
}
