import type { ReportType } from '@/config/detection-rules';
import type { CanonicalField } from '@/config/field-synonyms';
import type { TemplateMatchRules } from '@/config/templates';
import type { TemplateMapping } from '@/lib/mapping/template-matcher';
import { fromDbBool, getDb, newId, nowIso, parseJson, toDbBool } from '../index';

/**
 * Template mappings.
 *
 * A template with no company is one of the shipped defaults and is shared by
 * every company. A template a company created carries its id and is invisible
 * to the others.
 *
 * Sharing is what makes enabling and disabling awkward: a company switching
 * off a shared default would switch it off for all six. That choice is
 * recorded per company in `template_company_state` instead, so the default
 * itself is never edited by one company on another's behalf.
 */

interface TemplateRow {
  id: string;
  name: string;
  report_type: string;
  company_id: string | null;
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
    companyId: row.company_id,
  };
}

/**
 * Every template, ignoring companies.
 *
 * Only for seeding and for the migration, which run before any session exists.
 * Anything serving a request wants `listTemplatesForCompany`.
 */
export function listTemplates(): TemplateMapping[] {
  return getDb()
    .prepare<[], TemplateRow>('SELECT * FROM template_mappings ORDER BY priority, name')
    .all()
    .map(toTemplate);
}

/**
 * The templates one company sees: the shared defaults plus its own.
 *
 * `active` is the effective value — this company's choice for a shared
 * template where it has made one, and the template's own flag otherwise.
 */
export function listTemplatesForCompany(companyId: string): TemplateMapping[] {
  return getDb()
    .prepare<[string, string], TemplateRow & { company_active: number | null }>(
      `SELECT t.*, s.active AS company_active
         FROM template_mappings t
         LEFT JOIN template_company_state s
                ON s.template_id = t.id AND s.company_id = ?
        WHERE t.company_id IS NULL OR t.company_id = ?
        ORDER BY t.priority, t.name`,
    )
    .all(companyId, companyId)
    .map((row) => ({
      ...toTemplate(row),
      active: row.company_active === null ? fromDbBool(row.active) : fromDbBool(row.company_active),
    }));
}

export function getTemplate(id: string): TemplateMapping | null {
  const row = getDb()
    .prepare<[string], TemplateRow>('SELECT * FROM template_mappings WHERE id = ?')
    .get(id);
  return row ? toTemplate(row) : null;
}

/**
 * Turns a template on or off for one company.
 *
 * Its own template is switched on the template row. A shared default is left
 * alone and the choice is recorded against the company, so the other five keep
 * whatever they had. Returns false when the template is not one this company
 * can see at all.
 */
export function setTemplateActiveForCompany(
  companyId: string,
  templateId: string,
  active: boolean,
): boolean {
  const db = getDb();
  const template = getTemplate(templateId);
  if (!template) return false;
  if (template.companyId && template.companyId !== companyId) return false;

  const now = nowIso();

  if (template.companyId === companyId) {
    db.prepare('UPDATE template_mappings SET active = ?, updated_at = ? WHERE id = ?').run(
      toDbBool(active), now, templateId,
    );
    return true;
  }

  db.prepare(
    `INSERT INTO template_company_state (id, template_id, company_id, active, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (template_id, company_id)
     DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at`,
  ).run(newId(), templateId, companyId, toDbBool(active), now);

  return true;
}

export function createTemplate(input: {
  name: string;
  reportType: ReportType;
  /** Omitted only by the seed, whose templates are shared by every company. */
  companyId?: string | null;
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
         (id, name, report_type, company_id, project_id, description, match_rules_json,
          column_map_json, cell_map_json, priority, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      id, input.name, input.reportType, input.companyId ?? null,
      input.projectId ?? null, input.description ?? null,
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
