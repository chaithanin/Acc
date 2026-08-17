import type { ReportType } from '@/config/detection-rules';
import type { CanonicalField } from '@/config/field-synonyms';
import type { TemplateMatchRules } from '@/config/templates';
import type { TemplateMapping } from '@/lib/mapping/template-matcher';
import { fromDbBool, getDb, newId, nowIso, parseJson, toDbBool } from '../index';

interface TemplateRow {
  id: string;
  name: string;
  report_type: string;
  project_id: string | null;
  description: string | null;
  match_rules_json: string;
  column_map_json: string | null;
  cell_map_json: string | null;
  priority: number;
  active: number;
}

function toTemplate(row: TemplateRow): TemplateMapping {
  return {
    id: row.id,
    name: row.name,
    reportType: row.report_type as ReportType,
    projectId: row.project_id,
    description: row.description,
    matchRules: parseJson<TemplateMatchRules>(row.match_rules_json, {}),
    columnMap: parseJson<Partial<Record<CanonicalField, string>>>(row.column_map_json, {}),
    cellMap: parseJson<Partial<Record<CanonicalField, string>>>(row.cell_map_json, {}),
    priority: row.priority,
    active: fromDbBool(row.active),
  };
}

export function listTemplates(): TemplateMapping[] {
  return getDb()
    .prepare<[], TemplateRow>('SELECT * FROM template_mappings ORDER BY priority, name')
    .all()
    .map(toTemplate);
}

export function getTemplate(id: string): TemplateMapping | null {
  const row = getDb()
    .prepare<[string], TemplateRow>('SELECT * FROM template_mappings WHERE id = ?')
    .get(id);
  return row ? toTemplate(row) : null;
}

export function createTemplate(input: {
  name: string;
  reportType: ReportType;
  projectId?: string | null;
  description?: string | null;
  matchRules: TemplateMatchRules;
  columnMap?: Partial<Record<CanonicalField, string>>;
  cellMap?: Partial<Record<CanonicalField, string>>;
  priority?: number;
}): TemplateMapping {
  const id = newId();
  const now = nowIso();

  getDb()
    .prepare(
      `INSERT INTO template_mappings
         (id, name, report_type, project_id, description, match_rules_json, column_map_json,
          cell_map_json, priority, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      id, input.name, input.reportType, input.projectId ?? null, input.description ?? null,
      JSON.stringify(input.matchRules), JSON.stringify(input.columnMap ?? {}),
      JSON.stringify(input.cellMap ?? {}), input.priority ?? 100, now, now,
    );

  return getTemplate(id)!;
}

export function updateTemplate(
  id: string,
  input: Partial<{
    name: string;
    reportType: ReportType;
    projectId: string | null;
    description: string | null;
    matchRules: TemplateMatchRules;
    columnMap: Partial<Record<CanonicalField, string>>;
    cellMap: Partial<Record<CanonicalField, string>>;
    priority: number;
    active: boolean;
  }>,
): TemplateMapping | null {
  const existing = getTemplate(id);
  if (!existing) return null;

  getDb()
    .prepare(
      `UPDATE template_mappings
          SET name = ?, report_type = ?, project_id = ?, description = ?, match_rules_json = ?,
              column_map_json = ?, cell_map_json = ?, priority = ?, active = ?, updated_at = ?
        WHERE id = ?`,
    )
    .run(
      input.name ?? existing.name,
      input.reportType ?? existing.reportType,
      input.projectId === undefined ? existing.projectId : input.projectId,
      input.description === undefined ? existing.description : input.description,
      JSON.stringify(input.matchRules ?? existing.matchRules),
      JSON.stringify(input.columnMap ?? existing.columnMap),
      JSON.stringify(input.cellMap ?? existing.cellMap),
      input.priority ?? existing.priority,
      toDbBool(input.active ?? existing.active),
      nowIso(),
      id,
    );

  return getTemplate(id);
}

export function deleteTemplate(id: string): void {
  getDb().prepare('DELETE FROM template_mappings WHERE id = ?').run(id);
}
