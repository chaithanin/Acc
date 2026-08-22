import { redirect } from 'next/navigation';
import { PageHeader, EmptyState, Card, CardHeader, Badge } from '@/components/ui/primitives';
import { activeCompany, can, currentUser } from '@/lib/auth';
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

  const company = await activeCompany();
  if (!company) redirect('/companies');

  // `importId` arrives from the query string, so it is looked up in this
  // company's own list rather than fetched directly. An id from elsewhere
  // simply is not in the list, and the page falls back to the newest import
  // this company does own.
  const { importId } = await searchParams;
  const imports = listImports(company.id, 50);
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
  const files = getImportFiles(company.id, selected.id);

  const sheets = db
    .prepare<[string, string], {
      import_file_id: string; sheet_name: string; sheet_index: number; report_type: string;
      confidence: number; header_row: number | null; column_map_json: string | null;
      detected_headers_json: string | null; scores_json: string | null;
      row_count: number; parsed_count: number;
    }>(
      `SELECT d.import_file_id, d.sheet_name, d.sheet_index, d.report_type, d.confidence, d.header_row,
              d.column_map_json, d.detected_headers_json, d.scores_json, d.row_count, d.parsed_count
         FROM sheet_detections d
         JOIN imports i ON i.id = d.import_id
        WHERE d.import_id = ? AND i.company_id = ?
        ORDER BY d.sheet_index`,
    )
    .all(selected.id, company.id);

  const metrics = selected.snapshotId
    ? db
        .prepare<[string, string], { metric_key: string; label: string; section: string; value: number | null; formula: string | null; project_id: string | null }>(
          `SELECT metric_key, label, section, value, formula, project_id
             FROM calculated_metrics
            WHERE snapshot_id = ? AND company_id = ? AND project_id IS NULL
            ORDER BY section, metric_key`,
        )
        .all(selected.snapshotId, company.id)
    : [];

  const issues = getImportIssues(company.id, selected.id);

  const rawRows = db
    .prepare<[string, string], { import_file_id: string; sheet_name: string; row_number: number; cells_json: string }>(
      `SELECT r.import_file_id, r.sheet_name, r.row_number, r.cells_json
         FROM raw_rows r
         JOIN imports i ON i.id = r.import_id
        WHERE r.import_id = ? AND i.company_id = ?
        ORDER BY r.sheet_name, r.row_number LIMIT 400`,
    )
    .all(selected.id, company.id);

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
