import type { ReportType } from '@/config/detection-rules';
import type { CanonicalField } from '@/config/field-synonyms';
import type { TemplateMatchRules } from '@/config/templates';
import { containsPhrase } from '@/lib/detect/normalize-text';
import { cellText, getCell } from '@/lib/excel/cells';
import type { RawSheet } from '@/lib/excel/types';
import type { ColumnMapping, SheetDetection } from '@/lib/types';

/**
 * Template application — level 3 of the mapping strategy (requirement 25).
 *
 * Precedence, strongest first:
 *   1. Manual overrides chosen by the user in the preview screen.
 *   2. Header detection (what the sheet actually says).
 *   3. Template column hints, for headers detection could not resolve.
 *   4. Template cell addresses, as a last-resort fallback for known layouts.
 *
 * A template therefore never overrides evidence found in the file itself.
 */

export interface TemplateMapping {
  id: string;
  name: string;
  reportType: ReportType;
  projectId: string | null;
  description: string | null;
  matchRules: TemplateMatchRules;
  columnMap: Partial<Record<CanonicalField, string>>;
  cellMap: Partial<Record<CanonicalField, string>>;
  priority: number;
  active: boolean;
}

export function matchTemplate(
  templates: TemplateMapping[],
  fileName: string,
  sheet: RawSheet,
  detection: SheetDetection,
): TemplateMapping | null {
  const candidates = templates
    .filter((t) => t.active)
    .filter((t) => matches(t.matchRules, fileName, sheet.name, detection.headers))
    // A template whose report type agrees with detection is preferred.
    .sort((a, b) => {
      const aAgrees = a.reportType === detection.reportType ? 1 : 0;
      const bAgrees = b.reportType === detection.reportType ? 1 : 0;
      if (aAgrees !== bAgrees) return bAgrees - aAgrees;
      return a.priority - b.priority;
    });

  return candidates[0] ?? null;
}

function matches(
  rules: TemplateMatchRules,
  fileName: string,
  sheetName: string,
  headers: string[],
): boolean {
  // Required headers are a gate: if the sheet lacks them, nothing else matters.
  const headersOk =
    !rules.requiredHeaders?.length ||
    rules.requiredHeaders.every((required) => headers.some((h) => containsPhrase(h, required)));
  if (!headersOk) return false;

  const hasFileRules = !!rules.fileNamePatterns?.length;
  const hasSheetRules = !!rules.sheetNamePatterns?.length;

  const fileOk = hasFileRules && rules.fileNamePatterns!.some((p) => containsPhrase(fileName, p));
  const sheetOk = hasSheetRules && rules.sheetNamePatterns!.some((p) => containsPhrase(sheetName, p));

  // With both kinds of rule, either route is enough — a report often names the
  // project in the file name but not the sheet name, or the other way round.
  if (hasFileRules && hasSheetRules) return fileOk || sheetOk;
  if (hasFileRules) return fileOk;
  if (hasSheetRules) return sheetOk;

  // A template with only header requirements matches on those alone.
  return true;
}

/**
 * Applies a template's hints to a detection, returning a NEW detection.
 * Existing header-derived columns are preserved untouched.
 */
export function applyTemplate(
  detection: SheetDetection,
  template: TemplateMapping,
  sheet: RawSheet,
): SheetDetection {
  const columns: ColumnMapping[] = [...detection.columns];
  const mappedFields = new Set(columns.map((c) => c.field));
  const usedColumns = new Set(columns.map((c) => c.columnIndex));

  // (3) Column hints — bind a field by finding its header text in the sheet.
  for (const [field, headerLabel] of Object.entries(template.columnMap) as [CanonicalField, string][]) {
    if (mappedFields.has(field) || !headerLabel) continue;
    const columnIndex = findColumnByHeader(sheet, detection.headerRow, headerLabel, usedColumns);
    if (columnIndex === null) continue;

    columns.push({ field, columnIndex, header: headerLabel, via: 'template', score: 0.6 });
    mappedFields.add(field);
    usedColumns.add(columnIndex);
  }

  // (4) Cell fallbacks are recorded but do not become columns — they are
  // single-value bindings consumed by the key/value pass.
  return {
    ...detection,
    columns: columns.sort((a, b) => a.columnIndex - b.columnIndex),
    templateId: template.id,
    templateName: template.name,
    // A template match is corroborating evidence, so confidence rises, but a
    // template can never overrule a confident header-based classification.
    reportType: detection.reportType === 'unknown' ? template.reportType : detection.reportType,
    confidence: Math.min(1, detection.confidence + 0.15),
  };
}

function findColumnByHeader(
  sheet: RawSheet,
  headerRow: number | null,
  label: string,
  used: Set<number>,
): number | null {
  if (headerRow === null) return null;
  for (let c = 0; c < sheet.colCount; c += 1) {
    if (used.has(c)) continue;
    const text = cellText(getCell(sheet, headerRow, c));
    if (text && containsPhrase(text, label)) return c;
  }
  return null;
}

/** Applies user-chosen overrides from the preview screen. Highest precedence. */
export function applyManualColumns(
  detection: SheetDetection,
  overrides: { field: CanonicalField; columnIndex: number }[],
  sheet: RawSheet,
): SheetDetection {
  if (overrides.length === 0) return detection;

  // Drop any auto-mapping that collides with a manual choice, by field or column.
  const overriddenFields = new Set(overrides.map((o) => o.field));
  const overriddenColumns = new Set(overrides.map((o) => o.columnIndex));

  const kept = detection.columns.filter(
    (c) => !overriddenFields.has(c.field) && !overriddenColumns.has(c.columnIndex),
  );

  const manual: ColumnMapping[] = overrides.map((o) => ({
    field: o.field,
    columnIndex: o.columnIndex,
    header: cellText(getCell(sheet, detection.headerRow ?? 0, o.columnIndex)) || `Column ${o.columnIndex + 1}`,
    via: 'manual',
    score: 1,
  }));

  return {
    ...detection,
    columns: [...kept, ...manual].sort((a, b) => a.columnIndex - b.columnIndex),
  };
}

/** Resolves a template cell address like "D17" into a numeric value. */
export function readTemplateCell(sheet: RawSheet, address: string): number | null {
  const parsed = /^([A-Za-z]+)(\d+)$/.exec(address.trim());
  if (!parsed) return null;

  let col = 0;
  for (const ch of parsed[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  col -= 1;

  const row = Number(parsed[2]) - 1;
  const cell = getCell(sheet, row - sheet.originRow, col - sheet.originCol);
  return cell && typeof cell.v === 'number' ? cell.v : null;
}
